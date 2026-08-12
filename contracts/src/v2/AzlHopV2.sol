// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAzlHopGateway {
    function fundWithEth(uint256 minAzlOut, uint256 deadline)
        external
        payable
        returns (uint256 azlReceived);
}

interface IAzlHopWeth is IERC20 {
    function withdraw(uint256 amount) external;
}

interface IAzlHopPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IAzlHopUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Stateless delegatecall module for AZL -> ETH -> existing V2 collateral intake.
/// @dev This module is intended for a Kernel account execution context. It snapshots the
///      account's native balance, swaps AZL to WETH through the fixed Base V4 pool, unwraps
///      WETH, then calls the existing gateway while `msg.sender` remains the user account.
contract AzlHopV2 {
    using SafeERC20 for IERC20;

    address public immutable moduleAddress;
    address public immutable gateway;

    IERC20 public constant AZL = IERC20(0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3);
    IAzlHopWeth public constant WETH = IAzlHopWeth(0x4200000000000000000000000000000000000006);
    IAzlHopUniversalRouter public constant UNIVERSAL_ROUTER =
        IAzlHopUniversalRouter(0x6fF5693b99212Da76ad316178A184AB56D299b43);
    IAzlHopPermit2 public constant PERMIT2 =
        IAzlHopPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    address public constant HOOK = 0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544;

    uint24 public constant POOL_FEE = 0x800000;
    int24 public constant TICK_SPACING = 200;
    uint256 public constant MAX_DEADLINE_WINDOW = 10 minutes;

    bytes1 private constant V4_SWAP = 0x10;
    bytes1 private constant SWAP_EXACT_IN_SINGLE = 0x06;
    bytes1 private constant SETTLE_ALL = 0x0c;
    bytes1 private constant TAKE_ALL = 0x0f;

    error DirectCall();
    error InvalidAmount();
    error InvalidDeadline();
    error NativeBalanceMismatch();
    error EthTransferFailed();

    event DepositedUsingAzl(
        address indexed account,
        uint256 azlInput,
        uint256 ethOutput,
        uint256 azlCredited,
        uint256 deadline
    );

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    constructor(address _gateway) {
        require(_gateway.code.length != 0, "AzlHopV2: gateway");
        moduleAddress = address(this);
        gateway = _gateway;
    }

    /// @notice Swaps the caller-account's AZL and deposits the resulting ETH as collateral.
    /// @dev Must be invoked by a Kernel delegatecall. The module itself never custody-holds
    ///      user funds and direct calls are rejected.
    function depositUsingAzl(
        uint256 exactAzlIn,
        uint256 minWethOut,
        uint256 minAzlOut,
        uint256 deadline
    ) external returns (uint256 azlCredited) {
        if (address(this) == moduleAddress) revert DirectCall();
        if (exactAzlIn == 0 || minWethOut == 0 || minAzlOut == 0) revert InvalidAmount();
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) {
            revert InvalidDeadline();
        }

        uint256 ethBefore = address(this).balance;
        uint256 wethBefore = WETH.balanceOf(address(this));

        AZL.forceApprove(address(PERMIT2), exactAzlIn);
        PERMIT2.approve(address(AZL), address(UNIVERSAL_ROUTER), uint160(exactAzlIn), uint48(deadline));

        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            PoolKey({
                currency0: address(WETH),
                currency1: address(AZL),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: HOOK
            }),
            false,
            uint128(exactAzlIn),
            uint128(minWethOut),
            bytes("")
        );
        params[1] = abi.encode(address(AZL), exactAzlIn);
        params[2] = abi.encode(address(WETH), minWethOut);

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        UNIVERSAL_ROUTER.execute(abi.encodePacked(V4_SWAP), inputs, deadline);

        PERMIT2.approve(address(AZL), address(UNIVERSAL_ROUTER), 0, 0);
        AZL.forceApprove(address(PERMIT2), 0);

        uint256 wethReceived = WETH.balanceOf(address(this)) - wethBefore;
        if (wethReceived < minWethOut) revert NativeBalanceMismatch();
        WETH.withdraw(wethReceived);

        uint256 ethOut = address(this).balance - ethBefore;
        if (ethOut == 0) revert NativeBalanceMismatch();
        azlCredited = IAzlHopGateway(gateway).fundWithEth{value: ethOut}(minAzlOut, deadline);

        emit DepositedUsingAzl(address(this), exactAzlIn, ethOut, azlCredited, deadline);
    }

    /// @notice Sends native ETH received by this delegatecall back to the account context.
    receive() external payable {}
}
