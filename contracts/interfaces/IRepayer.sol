// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IRoute} from "./IRoute.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface IRepayer is IRoute {
    function initiateRepay(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        Provider provider,
        bytes calldata extraData
    ) external;

    function processRepay(
        address destinationPool,
        Provider provider,
        bytes calldata extraData
    ) external;
}
