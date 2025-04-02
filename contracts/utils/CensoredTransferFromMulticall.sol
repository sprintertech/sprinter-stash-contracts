// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract CensoredTransferFromMulticall {
    error InvalidLength();
    error CensoredTransferFrom();

    function multicall(address[] calldata tos, bytes[] calldata datas) external {
        uint256 len = tos.length;
        require(len == datas.length, InvalidLength());
        for (uint256 i = 0; i < len; ++i) {
            if (datas[i].length >= 36) {
                bytes4 callSelector = bytes4(datas[i][0:4]);
                if (callSelector == IERC20.transferFrom.selector) {
                    address from = abi.decode(datas[i][4:36], (address));
                    require(from == msg.sender, CensoredTransferFrom());
                }
            }
            address to = tos[i];
            bytes memory data = datas[i];
            Address.functionCall(to, data);
        }
    }
}
