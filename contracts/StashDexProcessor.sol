// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Processor} from "./Processor.sol";
import {IStashDex} from "./interfaces/IStashDex.sol";

/// @title StashDexProcessor — extends Processor to repay StashDex debt after each transfer.
/// @notice RECEIVER must be a StashDex contract. After forwarding TARGET_ASSET to StashDex,
///         repay() is called so StashDex immediately settles its outstanding pool debt.
/// @author Sprinter
contract StashDexProcessor is Processor {
    constructor(address asset, address receiver, address oracle) Processor(asset, receiver, oracle) {
        require(oracle != address(0), ZeroAddress());
    }

    function _finalizeTransfer(uint256 amount) internal override {
        super._finalizeTransfer(amount);
        IStashDex(RECEIVER).repay(address(TARGET_ASSET));
    }
}
