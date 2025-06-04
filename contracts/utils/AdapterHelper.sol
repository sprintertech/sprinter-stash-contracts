// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

contract AdapterHelper {
    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
