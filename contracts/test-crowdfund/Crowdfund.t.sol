// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CompatibilityFallbackHandler} from "@safe/handler/CompatibilityFallbackHandler.sol";
import {MultiSendCallOnly} from "@safe/libraries/MultiSendCallOnly.sol";
import {SafeProxyFactory} from "@safe/proxies/SafeProxyFactory.sol";
import {SafeL2} from "@safe/SafeL2.sol";
import {CrowdfundCalls} from "../src/crowdfund/CrowdfundCalls.sol";
import {CrowdfundFactory} from "../src/crowdfund/CrowdfundFactory.sol";
import {CrowdfundGuard} from "../src/crowdfund/CrowdfundGuard.sol";
import {CrowdfundModule} from "../src/crowdfund/CrowdfundModule.sol";
import {ISafeMinimal} from "../src/crowdfund/ISafeMinimal.sol";

contract TestAzl {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockEscrow {
    function pull(address token, address from, uint256 amount) external {
        TestAzl(token).transferFrom(from, address(this), amount);
    }
}

contract MockRegistry {
    TestAzl public token;
    MockEscrow public escrow;
    address public poster;
    uint256 public total;
    uint256 public fundedAmount;
    uint8 public state;

    constructor(TestAzl token_, MockEscrow escrow_) {
        token = token_;
        escrow = escrow_;
    }

    function ping() external {}

    function tasks(uint256)
        external
        view
        returns (address, address, uint256, uint256, uint256, uint64, uint64, uint64, uint8)
    {
        return (poster, address(0), total, fundedAmount, 0, 0, 0, 0, state);
    }

    function fund(uint256, uint256 amount) external {
        escrow.pull(address(token), msg.sender, amount);
        poster = msg.sender;
        total = amount;
        fundedAmount = amount;
        state = 3;
    }

    function set(address poster_, uint256 total_, uint256 funded_, uint8 state_) external {
        poster = poster_;
        total = total_;
        fundedAmount = funded_;
        state = state_;
    }
}

contract CrowdfundTest is Test {
    uint256 internal constant OPENER_KEY = 1;
    uint8 internal constant CANCELLED = 6;

    TestAzl internal azl;
    MockEscrow internal escrow;
    MockRegistry internal registry;
    CrowdfundFactory internal factory;
    MultiSendCallOnly internal multiSend;
    address internal opener;

    function setUp() public {
        opener = vm.addr(OPENER_KEY);
        azl = new TestAzl();
        escrow = new MockEscrow();
        registry = new MockRegistry(azl, escrow);
        multiSend = new MultiSendCallOnly();
        factory = new CrowdfundFactory(
            address(new SafeProxyFactory()),
            address(new SafeL2()),
            address(new CompatibilityFallbackHandler()),
            address(azl),
            address(registry)
        );
    }

    function testQuorumScheduleThroughTwoHundred() public {
        (, CrowdfundModule module,) = _campaign(1, 1);
        uint256[10] memory first = [uint256(1), 2, 2, 3, 3, 4, 5, 5, 6, 6];
        for (uint256 n = 1; n <= 200; ++n) {
            uint256 k = module.quorum(n);
            assertEq(k, (3 * n + 4) / 5);
            if (n <= 10) assertEq(k, first[n - 1]);
            if (n == 1) continue;
            uint256 prev = module.quorum(n - 1);
            if (n % 5 == 0 || n % 5 == 3) assertEq(k, prev);
            else assertEq(k, prev + 1);
        }
        assertEq(module.quorum(200), 120);
    }

    function testCreateStartsAtOneOfOne() public {
        (ISafeMinimal safe, CrowdfundModule module,) = _campaign(100 ether, 1 ether);
        address[] memory owners = safe.getOwners();
        assertEq(owners.length, 1);
        assertEq(owners[0], opener);
        assertEq(safe.getThreshold(), 1);
        assertTrue(safe.isModuleEnabled(address(module)));
        assertEq(module.quorum(1), 1);
    }

    function testJoinsFollowTheSchedule() public {
        (ISafeMinimal safe, CrowdfundModule module,) = _campaign(10 ether, 1 ether);
        _join(module, 11, 1 ether);
        assertEq(safe.getOwners().length, 2);
        assertEq(safe.getThreshold(), 2);
        _join(module, 12, 1 ether);
        assertEq(safe.getOwners().length, 3);
        assertEq(safe.getThreshold(), 2);
        _join(module, 13, 1 ether);
        assertEq(safe.getThreshold(), 3);
        assertEq(azl.balanceOf(address(safe)), 3 ether);
    }

    function testLeaveBeforeLockReturnsAzlAndLowersThreshold() public {
        (ISafeMinimal safe, CrowdfundModule module,) = _campaign(10 ether, 1 ether);
        address alice = _join(module, 11, 1 ether);
        address bob = _join(module, 12, 1 ether);
        assertEq(safe.getThreshold(), 2);
        vm.prank(bob);
        module.leave();
        assertFalse(safe.isOwner(bob));
        assertEq(azl.balanceOf(bob), 1 ether);
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners().length, 2);
        assertTrue(safe.isOwner(alice));
    }

    function testTwoOfTwoRejectsASingleSignature() public {
        (ISafeMinimal safe, CrowdfundModule module,) = _campaign(10 ether, 1 ether);
        uint256 aliceKey = 11;
        _join(module, aliceKey, 1 ether);
        assertEq(safe.getThreshold(), 2);

        CrowdfundCalls.SafeCall memory call_ = CrowdfundCalls.SafeCall({
            to: address(registry),
            operation: 0,
            data: abi.encodeWithSignature("ping()")
        });
        uint256[] memory one = new uint256[](1);
        one[0] = OPENER_KEY;
        bytes memory sig = _signatures(_txHash(safe, call_), one);
        vm.expectRevert(bytes("GS020"));
        _submit(safe, call_, sig);

        uint256[] memory both = new uint256[](2);
        both[0] = OPENER_KEY;
        both[1] = aliceKey;
        assertTrue(_exec(safe, call_, both));
    }

    function testFundBatchPullsAzlAndLockFreezesJoins() public {
        (ISafeMinimal safe, CrowdfundModule module,) = _campaign(5 ether, 5 ether);
        vm.startPrank(opener);
        azl.mint(opener, 5 ether);
        azl.approve(address(module), 5 ether);
        module.contribute(5 ether);
        vm.stopPrank();

        CrowdfundCalls.SafeCall memory call_ = CrowdfundCalls.fund(
            address(multiSend), address(azl), address(escrow), address(registry), 7, 5 ether
        );
        uint256[] memory keys = new uint256[](1);
        keys[0] = OPENER_KEY;
        assertTrue(_exec(safe, call_, keys));

        assertEq(azl.balanceOf(address(safe)), 0);
        assertEq(azl.balanceOf(address(escrow)), 5 ether);
        assertEq(azl.allowance(address(safe), address(escrow)), 0);

        module.syncFunded(7);
        assertTrue(module.locked());
        azl.mint(vm.addr(11), 1 ether);
        vm.startPrank(vm.addr(11));
        azl.approve(address(module), 1 ether);
        vm.expectRevert(CrowdfundModule.LockedMembership.selector);
        module.join(1 ether);
        vm.stopPrank();
    }

    function testRefundIsClaimedProRata() public {
        (ISafeMinimal safe, CrowdfundModule module,) = _campaign(10 ether, 1 ether);
        address alice = _join(module, 11, 2 ether);
        address bob = _join(module, 12, 8 ether);
        registry.set(address(safe), 10 ether, 10 ether, CANCELLED);
        module.syncFunded(4);
        assertEq(module.totalRefund(), 10 ether);
        vm.prank(alice);
        module.claim();
        vm.prank(bob);
        module.claim();
        assertEq(azl.balanceOf(alice), 2 ether);
        assertEq(azl.balanceOf(bob), 8 ether);
        assertEq(azl.balanceOf(address(safe)), 0);
    }

    function testGuardBlocksATransferTheModuleDidNotRecord() public {
        (ISafeMinimal safe,, CrowdfundGuard guard) = _campaign(10 ether, 1 ether);
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", address(0xBEEF), 1);
        vm.expectRevert(CrowdfundGuard.Blocked.selector);
        this.probeGuard(guard, address(safe), data);
    }

    function testJoinThroughTwoHundredOwners() public {
        uint256 cap = 199;
        (ISafeMinimal safe, CrowdfundModule module,) = _campaign(cap + 1, 1);
        for (uint256 i = 1; i <= cap; ++i) {
            _join(module, 1000 + i, 1);
            assertEq(safe.getThreshold(), module.quorum(i + 1));
        }
        assertEq(safe.getOwners().length, 200);
        assertEq(safe.getThreshold(), 120);
        address extra = vm.addr(9999);
        azl.mint(extra, 1);
        vm.startPrank(extra);
        azl.approve(address(module), 1);
        vm.expectRevert(CrowdfundModule.OwnerCap.selector);
        module.join(1);
        vm.stopPrank();
    }

    function probeGuard(CrowdfundGuard guard, address safe, bytes calldata data) external {
        vm.prank(safe);
        guard.checkModuleTransaction(address(azl), 0, data, ISafeMinimal.Operation.Call, address(guard.module()));
    }

    function _campaign(uint256 total, uint256 minJoin)
        internal
        returns (ISafeMinimal safe, CrowdfundModule module, CrowdfundGuard guard)
    {
        (address safe_, address module_, address guard_) = factory.create(opener, total, minJoin, 1);
        safe = ISafeMinimal(safe_);
        module = CrowdfundModule(module_);
        guard = CrowdfundGuard(guard_);
    }

    function _join(CrowdfundModule module, uint256 key, uint256 amount) internal returns (address who) {
        who = vm.addr(key);
        azl.mint(who, amount);
        vm.startPrank(who);
        azl.approve(address(module), amount);
        module.join(amount);
        vm.stopPrank();
    }

    function _txHash(ISafeMinimal safe, CrowdfundCalls.SafeCall memory call_) internal view returns (bytes32) {
        return safe.getTransactionHash(
            call_.to,
            0,
            call_.data,
            ISafeMinimal.Operation(call_.operation),
            0,
            0,
            0,
            address(0),
            address(0),
            safe.nonce()
        );
    }

    function _submit(ISafeMinimal safe, CrowdfundCalls.SafeCall memory call_, bytes memory signatures) internal returns (bool) {
        return safe.execTransaction(
            call_.to,
            0,
            call_.data,
            ISafeMinimal.Operation(call_.operation),
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            signatures
        );
    }

    function _exec(ISafeMinimal safe, CrowdfundCalls.SafeCall memory call_, uint256[] memory keys) internal returns (bool) {
        bytes32 hash = _txHash(safe, call_);
        return _submit(safe, call_, _signatures(hash, keys));
    }

    function _signatures(bytes32 hash, uint256[] memory keys) internal pure returns (bytes memory packed) {
        uint256 n = keys.length;
        address[] memory signers = new address[](n);
        bytes[] memory sigs = new bytes[](n);
        for (uint256 i = 0; i < n; ++i) {
            signers[i] = vm.addr(keys[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], hash);
            sigs[i] = abi.encodePacked(r, s, v);
        }
        for (uint256 i = 1; i < n; ++i) {
            address keyA = signers[i];
            bytes memory keyS = sigs[i];
            uint256 j = i;
            while (j > 0 && signers[j - 1] > keyA) {
                signers[j] = signers[j - 1];
                sigs[j] = sigs[j - 1];
                --j;
            }
            signers[j] = keyA;
            sigs[j] = keyS;
        }
        for (uint256 i = 0; i < n; ++i) {
            packed = bytes.concat(packed, sigs[i]);
        }
    }

}
