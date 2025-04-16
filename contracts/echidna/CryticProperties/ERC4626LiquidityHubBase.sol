// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {CryticERC4626PropertyBase} from "@crytic/properties/contracts/ERC4626/ERC4626PropertyTests.sol";
import {TestShareToken} from "./TestShareToken.sol";

/// @notice This contract is used as a base contract for all 4626 property tests.
contract ERC4626LiquidityHubBase is CryticERC4626PropertyBase {
    TestShareToken public shares_;

    function initialize(
        TestShareToken _shares
    ) internal {
        shares_ = _shares;
    }
}