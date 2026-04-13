// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFeeAdapterV2, IEverclearV2} from "../interfaces/IEverclear.sol";

contract TestEverclearFeeAdapter is IFeeAdapterV2 {
    using SafeERC20 for IERC20;

    function newIntent(
        uint32[] memory,
        bytes32,
        address _inputAsset,
        bytes32,
        uint256 _amount,
        uint256,
        uint48,
        bytes calldata,
        FeeParams calldata
    ) external payable override returns (bytes32, IEverclearV2.Intent memory) {
        IERC20(_inputAsset).safeTransferFrom(msg.sender, address(this), _amount);
        emit IntentWithFeesAdded(bytes32(0), bytes32(0), 0, 0);
        return (bytes32(0), IEverclearV2.Intent(
            bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            0, 0, 0, 0, 0, 0, new uint32[](0), ""
        ));
    }
}
