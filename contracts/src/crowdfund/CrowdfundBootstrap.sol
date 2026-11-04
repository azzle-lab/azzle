// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISafeMinimal} from "./ISafeMinimal.sol";

/// @notice Delegatecall target for Safe `setup`. Enables the crowdfund module and its guard
/// in the same transaction that creates the 1-of-1 campaign.
/// @dev Safe runs this with `delegatecall`, so `address(this)` is the new Safe. The external
/// calls below run with the Safe as `msg.sender`, which is what `authorized` requires.
contract CrowdfundBootstrap {
    function enable(address module, address guard) external {
        ISafeMinimal safe = ISafeMinimal(address(this));
        safe.enableModule(module);
        safe.setModuleGuard(guard);
    }
}
