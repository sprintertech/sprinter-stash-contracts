// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IArbitrumGatewayRouter} from "../interfaces/IArbitrumGatewayRouter.sol";

contract TestArbitrumGatewayRouter is IArbitrumGatewayRouter {

    address public immutable LOCAL_TOKEN;
    address public immutable L2_TOKEN;

    error InvalidToken();
    error SimulatedRevert();

    constructor(address _localtoken, address _l2token) {
        LOCAL_TOKEN = _localtoken;
        L2_TOKEN = _l2token;
    }

    function calculateL2TokenAddress(address) external view override returns (address) {
        return L2_TOKEN;
    }

    function getGateway(address) external view returns (address gateway) {
        return address(this);
    }

    function outboundTransfer(
        address _token,
        address _to,
        uint256 _amount,
        uint256,
        uint256,
        bytes calldata
    ) external payable returns (bytes memory) {
        require(_token == LOCAL_TOKEN, InvalidToken());
        require(_amount != 2000, SimulatedRevert());
        SafeERC20.safeTransferFrom(IERC20(LOCAL_TOKEN), msg.sender, address(this), _amount);
        emit TransferRouted(LOCAL_TOKEN, msg.sender, _to, address(this));
        return "GATEWAY_DATA";
    }
}
