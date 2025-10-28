// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface ISigner {
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue);
}
