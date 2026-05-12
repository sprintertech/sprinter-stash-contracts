// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Test4626} from "./Test4626.sol";

/// @dev Test vault implementing ERC-7540 async redemption (requestRedeem).
/// Requests become claimable immediately for testing.
contract Test7540 is Test4626 {
    using Math for uint256;
    using SafeERC20 for IERC20;

    mapping(address owner => uint256 claimable) public claimable;
    uint256 public totalClaimable;

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

    function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256 requestId) {
        require(controller == owner, InvalidController());
        requestId = 0;
        uint256 assets = super.previewRedeem(shares);
        totalClaimable += assets;
        claimable[owner] += assets;
        _burn(owner, shares);
        return requestId;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return super.previewWithdraw(maxWithdraw(owner));
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return claimable[owner];
    }

    function previewRedeem(uint256 /* shares */) public pure override returns (uint256) {
        if (true) {
            revert NotImplemented();
        }
        return 0;
    }

    function previewWithdraw(uint256 /* assets */) public pure override returns (uint256) {
        if (true) {
            revert NotImplemented();
        }
        return 0;
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        require(msg.sender == owner, InvalidOwner());
        require(shares <= maxRedeem(owner), InsufficientShares());
        assets = super.previewRedeem(shares);
        totalClaimable -= assets;
        claimable[owner] -= assets;
        IERC20(asset()).safeTransfer(receiver, assets);
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        require(msg.sender == owner, InvalidOwner());
        require(assets <= maxWithdraw(owner), InsufficientShares());
        shares = super.previewWithdraw(assets);
        totalClaimable -= assets;
        claimable[owner] -= assets;
        IERC20(asset()).safeTransfer(receiver, assets);
        return shares;
    }
}