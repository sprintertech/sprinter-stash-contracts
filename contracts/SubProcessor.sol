// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title SubProcessor is a helper contract that provides isolation for unwinds/swaps of assets.
/// @author Sprinter
/// @notice Owner can execute arbitrary calls (e.g. swap/unwind);
/// any ASSET balance left after process() is sent to the owner.
contract SubProcessor {
    using SafeERC20 for IERC20;
    
    IERC20 public immutable ASSET;
    address public immutable OWNER;

    struct Call {
        address payable target;
        uint256 value;
        bytes data;
    }

    error ZeroAddress();
    error OnlyOwner();

    constructor(
        address asset
    ) {
        require(asset != address(0), ZeroAddress());
        ASSET = IERC20(asset);
        OWNER = msg.sender;
    }

    receive() external payable {}
    
    function process(
        Call[] calldata calls
    ) external {
        require(msg.sender == OWNER, OnlyOwner());
        for (uint256 i = 0; i < calls.length; i++) {
            Address.functionCallWithValue(calls[i].target, calls[i].data, calls[i].value);
        }
        uint256 assets = ASSET.balanceOf(address(this));
        if (assets > 0) {
            ASSET.safeTransfer(OWNER, assets);
        }
    }
}
