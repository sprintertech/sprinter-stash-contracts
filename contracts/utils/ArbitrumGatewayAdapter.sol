// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IArbitrumGatewayRouter} from ".././interfaces/IArbitrumGatewayRouter.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

abstract contract ArbitrumGatewayAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    IArbitrumGatewayRouter immutable public ARBITRUM_GATEWAY_ROUTER;

    event ArbitrumERC20TransferInitiated(bytes gatewayData);

    constructor(
        address arbitrumGatewayRouter
    ) {
        // No check for address(0) to allow deployment on chains where Arbitrum Bridge is not available
        ARBITRUM_GATEWAY_ROUTER = IArbitrumGatewayRouter(arbitrumGatewayRouter);
    }

    function initiateTransferArbitrum(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData,
        Domain localDomain,
        mapping(bytes32 => BitMaps.BitMap) storage outputTokens
    ) internal {
        // We are only interested in fast L1->L2 bridging, because the reverse is slow.
        require(localDomain == Domain.ETHEREUM, UnsupportedDomain());
        require(destinationDomain == Domain.ARBITRUM_ONE, UnsupportedDomain());
        IArbitrumGatewayRouter router = ARBITRUM_GATEWAY_ROUTER;
        require(address(router) != address(0), ZeroAddress());
        (address outputToken, uint256 maxGas, uint256 gasPriceBid, bytes memory data) =
            abi.decode(extraData, (address, uint256, uint256, bytes));

        _validateOutputToken(_addressToBytes32(outputToken), destinationDomain, outputTokens);
        // Get output token from the gateway
        address gatewayOutputToken = router.calculateL2TokenAddress(address(token));
        // Check that output tokens match
        require(gatewayOutputToken == outputToken, InvalidOutputToken());
        address gateway = router.getGateway(address(token));
        token.forceApprove(gateway, amount);
        bytes memory gatewayData = router.outboundTransfer{value: msg.value}(
            address(token),
            destinationPool,
            amount,
            maxGas,
            gasPriceBid,
            data
        );
        emit ArbitrumERC20TransferInitiated(gatewayData);
    }
}
