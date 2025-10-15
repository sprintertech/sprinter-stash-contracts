// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ISigner} from "../interfaces/ISigner.sol";

contract MockSignerTrue is ISigner{
    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 constant internal MAGICVALUE = 0x1626ba7e;

    function isValidSignature(bytes32, bytes calldata) external view override returns (bytes4) {
        return MAGICVALUE;
    }
}

contract MockSignerFalse is ISigner{
    function isValidSignature(bytes32, bytes calldata) external view override returns (bytes4) {
        return 0xffffffff;
    }
}
