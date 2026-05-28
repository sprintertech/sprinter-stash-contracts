// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Test4626} from "./Test4626.sol";

/// @dev Test vault implementing ERC-7540 async redemption (requestRedeem).
/// Requests become claimable immediately for testing.
contract TestRoyco is Test4626 {
    using Math for uint256;
    using SafeERC20 for IERC20;

    uint256 public totalClaimable;
    address public claimReceiver;

    error InvalidController();
    error InvalidOwner();
    error InsufficientShares();
    error NotImplemented();

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_
    ) Test4626(asset_, name_, symbol_) {
    }

    function totalAssets() public view override returns (uint256) {
        return super.totalAssets() - totalClaimable;
    }

    function claimWithdrawal(uint256[] calldata) public returns (uint256 shares) {
        IERC20(asset()).transfer(claimReceiver, totalClaimable);
        return 0;
    }

    // solhint-disable-next-line no-empty-blocks
    function cancelRequest(uint256 /*epochID*/) external {}

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        shares = super.previewWithdraw(assets);
        totalClaimable += assets;
        claimReceiver = receiver;
        _burn(owner, shares);
        return shares;
    }
}