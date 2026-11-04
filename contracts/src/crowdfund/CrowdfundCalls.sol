// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Calldata for the Safe transactions that move a campaign through V2.
/// @dev `operation` 0 is a call. `operation` 1 is a delegatecall. Funding uses Safe's
/// `MultiSendCallOnly` so the approve and the registry call are one signed transaction.
library CrowdfundCalls {
    struct SafeCall {
        address to;
        uint8 operation;
        bytes data;
    }

    function post(address taskRegistry, uint256 totalAmount, uint64 deadline) internal pure returns (SafeCall memory) {
        return SafeCall({
            to: taskRegistry,
            operation: 0,
            data: abi.encodeWithSignature("post(uint256,uint64)", totalAmount, deadline)
        });
    }

    function fund(
        address multiSendCallOnly,
        address azl,
        address escrowVault,
        address taskRegistry,
        uint256 taskId,
        uint256 amount
    ) internal pure returns (SafeCall memory) {
        bytes memory packed = abi.encodePacked(
            _inner(azl, abi.encodeWithSignature("approve(address,uint256)", escrowVault, amount)),
            _inner(taskRegistry, abi.encodeWithSignature("fund(uint256,uint256)", taskId, amount)),
            _inner(azl, abi.encodeWithSignature("approve(address,uint256)", escrowVault, uint256(0)))
        );
        return SafeCall({
            to: multiSendCallOnly,
            operation: 1,
            data: abi.encodeWithSignature("multiSend(bytes)", packed)
        });
    }

    function release(address taskRegistry, uint256 taskId, uint256 amount) internal pure returns (SafeCall memory) {
        return SafeCall({
            to: taskRegistry,
            operation: 0,
            data: abi.encodeWithSignature("release(uint256,uint256)", taskId, amount)
        });
    }

    function complete(address taskRegistry, uint256 taskId) internal pure returns (SafeCall memory) {
        return SafeCall({
            to: taskRegistry,
            operation: 0,
            data: abi.encodeWithSignature("complete(uint256)", taskId)
        });
    }

    function cancel(address taskRegistry, uint256 taskId) internal pure returns (SafeCall memory) {
        return SafeCall({
            to: taskRegistry,
            operation: 0,
            data: abi.encodeWithSignature("cancel(uint256)", taskId)
        });
    }

    function openDispute(address taskRegistry, uint256 taskId, bytes32 evidenceHash)
        internal
        pure
        returns (SafeCall memory)
    {
        return SafeCall({
            to: taskRegistry,
            operation: 0,
            data: abi.encodeWithSignature("openDispute(uint256,bytes32)", taskId, evidenceHash)
        });
    }

    function _inner(address to, bytes memory data) private pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), to, uint256(0), uint256(data.length), data);
    }
}
