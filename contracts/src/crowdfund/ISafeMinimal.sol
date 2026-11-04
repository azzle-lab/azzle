// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The Safe surface a crowdfund campaign uses.
/// @dev Selectors match Safe 1.5. `Call` is 0 and `DelegateCall` is 1, same as Safe's `Enum.Operation`.
interface ISafeMinimal {
    enum Operation {
        Call,
        DelegateCall
    }

    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;

    function enableModule(address module) external;

    function setModuleGuard(address moduleGuard) external;

    function isModuleEnabled(address module) external view returns (bool);

    function execTransactionFromModule(address to, uint256 value, bytes calldata data, Operation operation)
        external
        returns (bool success);

    function execTransactionFromModuleReturnData(address to, uint256 value, bytes calldata data, Operation operation)
        external
        returns (bool success, bytes memory returnData);

    function addOwnerWithThreshold(address owner, uint256 threshold) external;

    function removeOwner(address prevOwner, address owner, uint256 threshold) external;

    function isOwner(address owner) external view returns (bool);

    function getOwners() external view returns (address[] memory);

    function getThreshold() external view returns (uint256);

    function nonce() external view returns (uint256);

    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce_
    ) external view returns (bytes32);

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);
}

interface ISafeProxyFactory {
    function createProxyWithNonceL2(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}
