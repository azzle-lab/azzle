// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CrowdfundModule} from "./CrowdfundModule.sol";
import {ISafeMinimal} from "./ISafeMinimal.sol";

/// @notice Safe module guard. The crowdfund module may only add one owner at the next quorum,
/// remove one owner at the next quorum, or pay a transfer the module just recorded.
contract CrowdfundGuard {
    /// @dev `type(IModuleGuard).interfaceId` in Safe 1.5.
    bytes4 internal constant MODULE_GUARD_ID = 0x58401ed8;
    bytes4 internal constant ERC165_ID = 0x01ffc9a7;
    bytes4 internal constant ADD_OWNER = bytes4(keccak256("addOwnerWithThreshold(address,uint256)"));
    bytes4 internal constant REMOVE_OWNER = bytes4(keccak256("removeOwner(address,address,uint256)"));
    bytes4 internal constant TRANSFER = bytes4(keccak256("transfer(address,uint256)"));

    CrowdfundModule public immutable module;
    address public immutable azl;
    address public safe;

    error NotFactory();
    error BoundAlready();
    error NotBound();
    error Blocked();

    constructor(address module_, address azl_) {
        if (module_ == address(0) || azl_ == address(0)) revert NotBound();
        module = CrowdfundModule(module_);
        azl = azl_;
    }

    function bind(address safe_) external {
        if (msg.sender != module.factory()) revert NotFactory();
        if (safe != address(0)) revert BoundAlready();
        if (safe_.code.length == 0) revert NotBound();
        safe = safe_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == MODULE_GUARD_ID || interfaceId == ERC165_ID;
    }

    function checkModuleTransaction(
        address to,
        uint256 value,
        bytes memory data,
        ISafeMinimal.Operation operation,
        address callerModule
    ) external view returns (bytes32) {
        if (msg.sender != safe || callerModule != address(module) || value != 0 || operation != ISafeMinimal.Operation.Call)
        {
            revert Blocked();
        }
        if (data.length < 4) revert Blocked();
        bytes4 selector = _selector(data);

        if (selector == ADD_OWNER) {
            if (to != safe || data.length != 68) revert Blocked();
            (address owner, uint256 threshold) = _addressUint(data);
            (address pendingOwner, uint256 pendingThreshold, bool active) = module.pendingAdd();
            uint256 owners = ISafeMinimal(safe).getOwners().length;
            if (!active || owner != pendingOwner || threshold != pendingThreshold || owners >= module.MAX_OWNERS()) {
                revert Blocked();
            }
            if (threshold != module.quorum(owners + 1) || module.locked()) revert Blocked();
        } else if (selector == REMOVE_OWNER) {
            if (to != safe || data.length != 100) revert Blocked();
            (address prev, address owner, uint256 threshold) = _addressAddressUint(data);
            (address pendingPrev, address pendingOwner, uint256 pendingThreshold, bool active) = module.pendingRemove();
            uint256 owners = ISafeMinimal(safe).getOwners().length;
            if (!active || prev != pendingPrev || owner != pendingOwner || threshold != pendingThreshold || owners < 2) {
                revert Blocked();
            }
            if (threshold != module.quorum(owners - 1) || module.locked()) revert Blocked();
        } else if (selector == TRANSFER) {
            if (to != azl || data.length != 68) revert Blocked();
            (address payee, uint256 amount) = _addressUint(data);
            (address pendingPayee, uint256 pendingAmount, bool active) = module.pendingPay();
            if (!active || payee != pendingPayee || amount != pendingAmount || amount == 0) revert Blocked();
        } else {
            revert Blocked();
        }

        return keccak256(abi.encode(to, value, data, operation, callerModule));
    }

    function checkAfterModuleExecution(bytes32, bool success) external view {
        if (msg.sender != safe || !success) revert Blocked();
    }

    function _selector(bytes memory data) private pure returns (bytes4 selector) {
        assembly {
            selector := mload(add(data, 32))
        }
    }

    function _addressUint(bytes memory data) private pure returns (address a, uint256 b) {
        assembly {
            a := mload(add(data, 36))
            b := mload(add(data, 68))
        }
    }

    function _addressAddressUint(bytes memory data) private pure returns (address a, address b, uint256 c) {
        assembly {
            a := mload(add(data, 36))
            b := mload(add(data, 68))
            c := mload(add(data, 100))
        }
    }
}
