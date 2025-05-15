// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ICCTPTokenMessenger, ICCTPMessageTransmitter} from "../interfaces/ICCTP.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRoute} from ".././interfaces/IRoute.sol";

contract CCTPAdapter is IRoute {
    using SafeERC20 for IERC20;

    error ProcessFailed();
    error UnsupportedDomain();

    function initiateTransferCCTP(
        ICCTPTokenMessenger messenger,
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain
    ) internal {
        token.forceApprove(address(messenger), amount);
        messenger.depositForBurnWithCaller(
            amount,
            domainCCTP(destinationDomain),
            _addressToBytes32(address(destinationPool)),
            address(token),
            _addressToBytes32(address(this))
        );
    }
   
    function processTransferCCTP(
        ICCTPMessageTransmitter messageTransmitter,
        IERC20 token,
        address destinationPool,
        bytes calldata extraData
    ) internal returns (uint256) {
        uint256 balanceBefore = token.balanceOf(address(destinationPool));

        (bytes memory message, bytes memory attestation) = abi.decode(extraData, (bytes, bytes));
        bool success = messageTransmitter.receiveMessage(message, attestation);
        require(success, ProcessFailed());

        uint256 balanceAfter = token.balanceOf(address(destinationPool));
        require(balanceAfter > balanceBefore, ProcessFailed());
        uint256 amount = balanceAfter - balanceBefore;
        return amount;
    }

     function domainCCTP(Domain destinationDomain) public pure virtual returns (uint32) {
        if (destinationDomain == Domain.ETHEREUM) {
            return 0;
        } else
        if (destinationDomain == Domain.AVALANCHE) {
            return 1;
        } else
        if (destinationDomain == Domain.OP_MAINNET) {
            return 2;
        } else
        if (destinationDomain == Domain.ARBITRUM_ONE) {
            return 3;
        } else
        if (destinationDomain == Domain.BASE) {
            return 6;
        } else
        if (destinationDomain == Domain.POLYGON_MAINNET) {
            return 7;
        } else {
            revert UnsupportedDomain();
        }
    }

    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
