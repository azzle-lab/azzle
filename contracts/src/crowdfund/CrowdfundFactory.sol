// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CrowdfundBootstrap} from "./CrowdfundBootstrap.sol";
import {CrowdfundGuard} from "./CrowdfundGuard.sol";
import {CrowdfundModule} from "./CrowdfundModule.sol";
import {ISafeMinimal, ISafeProxyFactory} from "./ISafeMinimal.sol";

/// @notice Deploys a 1-of-1 Safe and enables that campaign's module and guard in the setup transaction.
/// @dev Pass Safe's proxy factory, the L2 singleton, and Safe's compatibility fallback handler.
/// Do not hardcode those addresses. Read them from Safe's deployment for the target chain.
contract CrowdfundFactory {
    address public immutable proxyFactory;
    address public immutable singleton;
    address public immutable fallbackHandler;
    address public immutable azl;
    address public immutable registry;
    CrowdfundBootstrap public immutable bootstrap;

    event CampaignCreated(
        address indexed safe,
        address indexed module,
        address guard,
        address indexed opener,
        uint256 totalAmount,
        uint256 minJoin,
        uint256 saltNonce
    );

    error BadConfig();

    constructor(address proxyFactory_, address singleton_, address fallbackHandler_, address azl_, address registry_) {
        if (
            proxyFactory_.code.length == 0 || singleton_.code.length == 0 || fallbackHandler_.code.length == 0
                || azl_.code.length == 0 || registry_.code.length == 0
        ) revert BadConfig();
        proxyFactory = proxyFactory_;
        singleton = singleton_;
        fallbackHandler = fallbackHandler_;
        azl = azl_;
        registry = registry_;
        bootstrap = new CrowdfundBootstrap();
    }

    function create(address opener, uint256 totalAmount, uint256 minJoin, uint256 saltNonce)
        external
        returns (address safe, address module, address guard)
    {
        module = address(new CrowdfundModule(azl, registry, address(this), totalAmount, minJoin, opener));
        guard = address(new CrowdfundGuard(module, azl));

        address[] memory owners = new address[](1);
        owners[0] = opener;
        bytes memory initializer = abi.encodeCall(
            ISafeMinimal.setup,
            (
                owners,
                1,
                address(bootstrap),
                abi.encodeCall(CrowdfundBootstrap.enable, (module, guard)),
                fallbackHandler,
                address(0),
                0,
                payable(address(0))
            )
        );
        safe = ISafeProxyFactory(proxyFactory).createProxyWithNonceL2(singleton, initializer, saltNonce);
        CrowdfundModule(module).bind(safe);
        CrowdfundGuard(guard).bind(safe);
        emit CampaignCreated(safe, module, guard, opener, totalAmount, minJoin, saltNonce);
    }
}
