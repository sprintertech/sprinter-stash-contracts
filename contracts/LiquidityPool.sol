// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {LiquidityPoolBase} from "./LiquidityPoolBase.sol";

/// @notice Concrete, upgradeable liquidity pool with the standard single-asset borrow/repay logic.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
contract LiquidityPool is LiquidityPoolBase {
    constructor(address liquidityToken, address wrappedNativeToken)
        LiquidityPoolBase(liquidityToken, wrappedNativeToken) {}

    function initialize(
        address admin,
        address mpcAddress_,
        address signerAddress_
    ) external initializer {
        _initializeBase(admin, mpcAddress_, signerAddress_);
    }
}
