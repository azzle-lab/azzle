// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISafeMinimal} from "./ISafeMinimal.sol";

/// @notice Membership module for one crowdfund Safe.
/// @dev The Safe holds the AZL and checks owner signatures. This module only adds or removes
/// an owner, and only pays a recorded share. The pass count is `(3 * owners + 4) / 5`.
contract CrowdfundModule is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_OWNERS = 200;
    address internal constant SENTINEL = address(0x1);
    /// @dev Matches `TaskRegistryV2.State`: CANCELLED = 6, RESOLVED = 7.
    uint8 internal constant STATE_CANCELLED = 6;
    uint8 internal constant STATE_RESOLVED = 7;

    struct PendingAdd {
        address owner;
        uint256 threshold;
        bool active;
    }

    struct PendingRemove {
        address prev;
        address owner;
        uint256 threshold;
        bool active;
    }

    struct PendingPay {
        address payee;
        uint256 amount;
        bool active;
    }

    IERC20 public immutable azl;
    address public immutable registry;
    address public immutable factory;
    uint256 public immutable totalAmount;
    uint256 public immutable minJoin;
    address public immutable opener;

    address public safe;
    uint256 public totalContribution;
    bool public locked;
    uint256 public boundTask;
    uint256 public shares;
    uint256 public totalRefund;

    mapping(address => uint256) public contribution;
    mapping(address => uint256) public claimed;

    PendingAdd public pendingAdd;
    PendingRemove public pendingRemove;
    PendingPay public pendingPay;

    event Bound(address indexed safe);
    event Joined(address indexed owner, uint256 amount, uint256 owners, uint256 threshold);
    event Contributed(address indexed owner, uint256 amount, uint256 totalContribution);
    event Left(address indexed owner, uint256 amount, uint256 owners, uint256 threshold);
    event Locked(uint256 indexed taskId, uint256 refundAlreadyHeld);
    event RefundRecognized(uint256 amount);
    event Claimed(address indexed owner, uint256 amount);

    error BadConfig();
    error NotFactory();
    error BoundAlready();
    error NotBound();
    error BadAmount();
    error Cap();
    error OwnerCap();
    error AlreadyOwner();
    error NotOwner();
    error SoleOwner();
    error LockedMembership();
    error NotPoster();
    error NotFullyFunded();
    error BalanceHeld();
    error AlreadyLocked();
    error WrongTask();
    error RefundAlreadySet();
    error NotTerminal();
    error NothingToClaim();
    error ModuleCallFailed();
    error TransferFailed();

    constructor(address azl_, address registry_, address factory_, uint256 totalAmount_, uint256 minJoin_, address opener_) {
        if (azl_ == address(0) || registry_ == address(0) || factory_ == address(0) || opener_ == address(0) || opener_ == SENTINEL)
        {
            revert BadConfig();
        }
        if (totalAmount_ == 0 || minJoin_ == 0 || minJoin_ > totalAmount_) revert BadAmount();
        azl = IERC20(azl_);
        registry = registry_;
        factory = factory_;
        totalAmount = totalAmount_;
        minJoin = minJoin_;
        opener = opener_;
    }

    /// @notice Pass count for `n` owners. `ceil(3n/5)`, capped at 200 owners.
    function quorum(uint256 n) public pure returns (uint256) {
        if (n == 0 || n > MAX_OWNERS) revert OwnerCap();
        return (3 * n + 4) / 5;
    }

    function bind(address safe_) external {
        if (msg.sender != factory) revert NotFactory();
        if (safe != address(0)) revert BoundAlready();
        if (safe_.code.length == 0) revert NotBound();
        safe = safe_;
        emit Bound(safe_);
    }

    /// @notice Pay AZL into the Safe and become an owner. The threshold updates in the same transaction.
    function join(uint256 amount) external nonReentrant {
        if (safe == address(0)) revert NotBound();
        if (locked) revert LockedMembership();
        ISafeMinimal account = ISafeMinimal(safe);
        if (account.isOwner(msg.sender)) revert AlreadyOwner();
        address[] memory owners = account.getOwners();
        if (owners.length >= MAX_OWNERS) revert OwnerCap();
        _take(amount, true);

        uint256 nextOwners = owners.length + 1;
        uint256 threshold = quorum(nextOwners);
        pendingAdd = PendingAdd(msg.sender, threshold, true);
        bool ok = account.execTransactionFromModule(
            safe,
            0,
            abi.encodeCall(ISafeMinimal.addOwnerWithThreshold, (msg.sender, threshold)),
            ISafeMinimal.Operation.Call
        );
        delete pendingAdd;
        if (!ok) revert ModuleCallFailed();
        emit Joined(msg.sender, amount, nextOwners, threshold);
    }

    /// @notice An existing owner adds AZL without changing the owner count.
    function contribute(uint256 amount) external nonReentrant {
        if (safe == address(0)) revert NotBound();
        if (locked) revert LockedMembership();
        if (!ISafeMinimal(safe).isOwner(msg.sender)) revert NotOwner();
        _take(amount, contribution[msg.sender] == 0);
        emit Contributed(msg.sender, amount, totalContribution);
    }

    /// @notice Drop out before the campaign locks. Returns that wallet's AZL and lowers the threshold.
    function leave() external nonReentrant {
        if (safe == address(0)) revert NotBound();
        if (locked) revert LockedMembership();
        ISafeMinimal account = ISafeMinimal(safe);
        if (!account.isOwner(msg.sender)) revert NotOwner();
        address[] memory owners = account.getOwners();
        if (owners.length < 2) revert SoleOwner();

        uint256 threshold = quorum(owners.length - 1);
        address prev = _previous(owners, msg.sender);
        pendingRemove = PendingRemove(prev, msg.sender, threshold, true);
        bool ok = account.execTransactionFromModule(
            safe,
            0,
            abi.encodeCall(ISafeMinimal.removeOwner, (prev, msg.sender, threshold)),
            ISafeMinimal.Operation.Call
        );
        delete pendingRemove;
        if (!ok) revert ModuleCallFailed();

        uint256 amount = contribution[msg.sender];
        if (amount > 0) {
            contribution[msg.sender] = 0;
            totalContribution -= amount;
            _pay(msg.sender, amount);
        }
        emit Left(msg.sender, amount, owners.length - 1, threshold);
    }

    /// @notice Freeze membership once this Safe's task is fully funded on the registry.
    /// If escrow already refunded, that balance becomes the claim pool.
    function syncFunded(uint256 taskId) external {
        if (safe == address(0)) revert NotBound();
        if (locked) revert AlreadyLocked();
        (address poster, uint256 taskTotal, uint256 taskFunded, uint8 state) = _task(taskId);
        if (poster != safe) revert NotPoster();
        if (taskTotal != totalAmount || taskFunded != totalAmount || totalContribution != totalAmount) revert NotFullyFunded();

        uint256 bal = azl.balanceOf(safe);
        if (state == STATE_CANCELLED || state == STATE_RESOLVED) {
            totalRefund = bal;
        } else if (bal != 0) {
            revert BalanceHeld();
        }

        locked = true;
        boundTask = taskId;
        shares = totalContribution;
        emit Locked(taskId, totalRefund);
    }

    /// @notice Record AZL escrow sent back to the Safe after cancel, expiry, or a resolved dispute.
    function syncRefund(uint256 taskId) external {
        if (!locked || taskId != boundTask) revert WrongTask();
        if (totalRefund != 0) revert RefundAlreadySet();
        (, , , uint8 state) = _task(taskId);
        if (state != STATE_CANCELLED && state != STATE_RESOLVED) revert NotTerminal();
        uint256 bal = azl.balanceOf(safe);
        if (bal == 0) revert NothingToClaim();
        totalRefund = bal;
        emit RefundRecognized(bal);
    }

    function claimable(address account) public view returns (uint256) {
        if (!locked || shares == 0 || totalRefund == 0) return 0;
        uint256 owed = contribution[account] * totalRefund / shares;
        uint256 already = claimed[account];
        return owed > already ? owed - already : 0;
    }

    function claim() external nonReentrant {
        uint256 owed = claimable(msg.sender);
        if (owed == 0) revert NothingToClaim();
        claimed[msg.sender] += owed;
        _pay(msg.sender, owed);
        emit Claimed(msg.sender, owed);
    }

    function _take(uint256 amount, bool enforceMin) internal {
        if (amount == 0 || (enforceMin && amount < minJoin)) revert BadAmount();
        if (totalContribution + amount > totalAmount) revert Cap();
        totalContribution += amount;
        contribution[msg.sender] += amount;
        azl.safeTransferFrom(msg.sender, safe, amount);
    }

    function _pay(address payee, uint256 amount) internal {
        pendingPay = PendingPay(payee, amount, true);
        (bool ok, bytes memory ret) = ISafeMinimal(safe).execTransactionFromModuleReturnData(
            address(azl),
            0,
            abi.encodeCall(IERC20.transfer, (payee, amount)),
            ISafeMinimal.Operation.Call
        );
        delete pendingPay;
        if (!ok || (ret.length != 0 && (ret.length != 32 || !abi.decode(ret, (bool))))) revert TransferFailed();
    }

    function _previous(address[] memory owners, address owner) internal pure returns (address prev) {
        prev = SENTINEL;
        uint256 len = owners.length;
        for (uint256 i = 0; i < len; ++i) {
            if (owners[i] == owner) return prev;
            prev = owners[i];
        }
        revert NotOwner();
    }

    function _task(uint256 taskId)
        internal
        view
        returns (address poster, uint256 taskTotal, uint256 taskFunded, uint8 state)
    {
        (poster,, taskTotal, taskFunded,,,,, state) = ITaskView(registry).tasks(taskId);
    }
}

interface ITaskView {
    function tasks(uint256 taskId)
        external
        view
        returns (
            address poster,
            address worker,
            uint256 totalAmount,
            uint256 funded,
            uint256 released,
            uint64 deadline,
            uint64 fundingDeadline,
            uint64 deliveredAt,
            uint8 state
        );
}
