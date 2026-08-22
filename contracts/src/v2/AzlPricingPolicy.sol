// SPDX-License-Identifier: MIT

//########################################################################################
//########################################################################################
//########################################################################################
//########################################################################################
//########################################.      .########################################
//######################################-          .######################################
//#####################################.            .#####################################
//###############################.+###.              .####-.##############################
//##############################.  ##.                .##-  -#############################
//################################+#.                  .####-#############################
//############################-####.                    .-################################
//##########################-#####.                     .######-##########################
//###############################.          .##-       .+ .######+-#######################
//######################   #####.           ####+     --   .#####   ######################
//##########################+##.          .######- .--      .##+##########################
//############################.           #######+.          .############################
//#############444###########.          .#######.##-          .###########111#############
//##########################.          .#######-####-          .##########################
//#########################.          .-.###.   -##+.-          .#########################
//########################.          .#####.     ######          .########################
//#######################.          .######-    .#######          .#######################
//######################-          .#############+#######          .######################
//#####################.          .######+################          .#####################
//####################-          .#####-############+######          .####################
//###################.          .#####################-#####          .###################
//##################-          .##.  .################-  .###          .##################
//##################         .######+###################+#####.         #GENTIC#LABOR#####
//########################################################################################
//#################AZZLE.ORG##############################################################
//#################SMART#CONTRACT#SUITE###################################################
//##########################. .. .########################################################
//##################..-##..#####. ########################################################
//###################..#. #####. #########################################################
//####################   ####. .##########################################################
//#####################.+###......########################################################
//########################################################################################
//########################################################################################

pragma solidity ^0.8.24;

import {IAzlUsdOracle} from "./interfaces/IAzlUsdOracle.sol";
import {IAzlV2Policy} from "./interfaces/IAzlV2Policy.sol";

/// @notice Immutable USD policy targets converted to AZL only before a new V2 liability is created.
/// @dev Named constants document the live **standard** market. Deployed instances quote from
///      constructor immutables so a second market can reuse this bytecode with different USD6 targets.
contract AzlPricingPolicy is IAzlV2Policy {
    uint256 public constant ENTRY_DEPOSIT_USD6 = 25_000_000;
    uint256 public constant LIVE_TASK_RESERVE_USD6 = 8_000_000;
    uint256 public constant ACCESS_FEE_USD6 = 5_000_000;
    uint256 public constant EXIT_PARTY_COMP_USD6 = 2_500_000;
    uint256 public constant EXIT_PROTOCOL_SHARE_USD6 = 2_500_000;

    IAzlUsdOracle public immutable oracle;
    uint256 public immutable entryDepositUsd6;
    uint256 public immutable liveTaskReserveUsd6;
    uint256 public immutable accessFeeUsd6;
    uint256 public immutable exitCompensationUsd6;
    uint256 public immutable exitProtocolShareUsd6;

    constructor(
        address _oracle,
        uint256 _entryDepositUsd6,
        uint256 _liveTaskReserveUsd6,
        uint256 _accessFeeUsd6,
        uint256 _exitCompensationUsd6,
        uint256 _exitProtocolShareUsd6
    ) {
        require(
            _oracle.code.length != 0 && _entryDepositUsd6 > 0 && _liveTaskReserveUsd6 > 0 && _accessFeeUsd6 > 0
                && _exitCompensationUsd6 > 0 && _exitProtocolShareUsd6 > 0,
            "AzlPolicy: oracle"
        );
        oracle = IAzlUsdOracle(_oracle);
        entryDepositUsd6 = _entryDepositUsd6;
        liveTaskReserveUsd6 = _liveTaskReserveUsd6;
        accessFeeUsd6 = _accessFeeUsd6;
        exitCompensationUsd6 = _exitCompensationUsd6;
        exitProtocolShareUsd6 = _exitProtocolShareUsd6;
    }

    /// @notice Produces one internally consistent quote from a single oracle observation.
    function quoteTask() external view returns (TaskQuote memory quote) {
        uint256 azlPerUsd6 = oracle.quoteAzlForUsd(1_000_000);
        require(azlPerUsd6 > 0, "AzlPolicy: quote");
        quote = TaskQuote({
            entryDeposit: _scale(entryDepositUsd6, azlPerUsd6),
            liveTaskReserve: _scale(liveTaskReserveUsd6, azlPerUsd6),
            accessFee: _scale(accessFeeUsd6, azlPerUsd6),
            exitCompensation: _scale(exitCompensationUsd6, azlPerUsd6),
            exitProtocolShare: _scale(exitProtocolShareUsd6, azlPerUsd6)
        });
    }

    function entryDepositAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(entryDepositUsd6);
    }

    function liveTaskReserveAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(liveTaskReserveUsd6);
    }

    function accessFeeAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(accessFeeUsd6);
    }

    function exitCompensationAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(exitCompensationUsd6);
    }

    function exitProtocolShareAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(exitProtocolShareUsd6);
    }

    function _scale(uint256 usd6, uint256 azlPerUsd6) private pure returns (uint256) {
        return (usd6 * azlPerUsd6 + 1_000_000 - 1) / 1_000_000;
    }
}
