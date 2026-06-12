// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IManagedToken} from "./IManagedToken.sol";

interface ILiquidityHub {
    function SHARES() external view returns (IManagedToken);
    function totalRedeemRequest() external view returns (uint256);
    function setOperator(address operator, bool approved) external;
    function isOperator(address owner, address operator) external view returns (bool);
    function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256 requestId);
    function requestRedeemSetOperator(uint256 shares, address controller) external returns (uint256 requestId);
    function claimableRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares);
    function pendingRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares);
    function fulfilRedeem(address[] calldata receivers) external;
}
