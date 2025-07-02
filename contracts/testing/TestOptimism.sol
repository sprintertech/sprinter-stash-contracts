// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOptimismStandardBridge} from "../interfaces/IOptimism.sol";

contract TestOptimismStandardBridge is IOptimismStandardBridge {
    error OptimismBridgeWrongRemoteToken();
    error OptimismBridgeWrongMinGasLimit();

    function bridgeERC20To(
        address _localToken,
        address _remoteToken,
        address _to,
        uint256 _amount,
        uint32 /*_minGasLimit*/,
        bytes calldata _extraData
    ) external override {
        require(
            _localToken != _remoteToken,
            OptimismBridgeWrongRemoteToken()
        ); // To simulate revert.
        SafeERC20.safeTransferFrom(IERC20(_localToken), msg.sender, address(this), _amount);
        emit ERC20BridgeInitiated(
            _localToken,
            _remoteToken,
            address(this),
            _to,
            _amount,
            _extraData
        );
    }

    function bridgeETHTo(address _to, uint32 _minGasLimit, bytes calldata _extraData) external payable override {
        require(
            _minGasLimit > 0,
            OptimismBridgeWrongMinGasLimit()
        ); // To simulate revert.
        emit ETHBridgeInitiated(address(this), _to, msg.value, _extraData);
    }
}
