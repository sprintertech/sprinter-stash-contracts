// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

library ERC7201Helper {
    error InvalidStorageSlot(string namespace);

    function validateStorageLocation(bytes32 actual, string memory namespace) internal pure {
        bytes32 expected = getStorageLocation(bytes(namespace));
        require(actual == expected, InvalidStorageSlot(namespace));
    }

    function getStorageLocation(bytes memory namespace) internal pure returns(bytes32) {
        return keccak256(abi.encode(uint256(keccak256(namespace)) - 1)) & ~bytes32(uint256(0xff));
    }
}
