// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IRoute} from "./IRoute.sol";

interface IRebalancer is IRoute {
    function initiateRebalance(
        uint256 amount,
        address sourcePool,
        address destinationPool,
        Domain destinationDomain,
        Provider provider,
        bytes calldata extraData
    ) external payable;

    function processRebalance(
        address destinationPool,
        Provider provider,
        bytes calldata extraData
    ) external;
}
