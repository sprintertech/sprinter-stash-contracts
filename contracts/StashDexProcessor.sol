// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Processor} from "./Processor.sol";

/// @title StashDexProcessor — extends Processor with oracle-required constructor validation.
/// @author Sprinter
contract StashDexProcessor is Processor {
    constructor(address asset, address receiver, address oracle) Processor(asset, receiver, oracle) {
        require(oracle != address(0), ZeroAddress());
    }
}
