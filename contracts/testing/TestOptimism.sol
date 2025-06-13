// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOptimismStandardBridge} from "../interfaces/IOptimism.sol";

contract TestOptimismStandardBridge is IOptimismStandardBridge {
    function bridgeERC20To(
        address _localToken,
        address _remoteToken,
        address _to,
        uint256 _amount,
        uint32 _minGasLimit,
        bytes calldata _extraData
    ) external override {
        require(
            _localToken != _remoteToken,
            "StandardBridge: wrong remote token for Optimism Mintable ERC20 local token"
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

    function toBytes32(address _address) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_address)));
    }
}
