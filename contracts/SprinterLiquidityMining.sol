// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {
    LiquidityMining,
    SafeERC20,
    IERC20,
    IERC20Permit
} from "./LiquidityMining.sol";
import {ILiquidityHub} from "./interfaces/ILiquidityHub.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title Modified version of the LiquidityMining contract, with the following differences:
/// 1. The score tokens can only be minted. No transfers or burns. Used for convinient show on explorers.
/// 2. Supports deposit into the connected liquidity hub with a subsequent stake in the same transaction.
/// 3. Supports above scenario with permit of liquidity hub's underlying asset.
/// 4. Supports unstake with a subsequent withdraw from the connected liquidity hub.
/// @author Oleksii Matiiasevych <oleksii@chainsafe.io>
contract SprinterLiquidityMining is LiquidityMining {
    using SafeERC20 for IERC20;

    ILiquidityHub public immutable LIQUIDITY_HUB;

    error NotImplemented();

    constructor(address owner_, address liquidityHub, Tier[] memory tiers_)
        LiquidityMining(
            "Sprinter USDC LP Score",
            "sprUSDC-LP-Score",
            owner_,
            address(ILiquidityHub(liquidityHub).SHARES()),
            tiers_
        )
    {
        LIQUIDITY_HUB = ILiquidityHub(liquidityHub);
    }

    function depositAndStake(address to, uint256 amount, uint256 tierId) public {
        address from = _msgSender();
        IERC4626 liquidityHub = IERC4626(address(LIQUIDITY_HUB));
        IERC20 asset = IERC20(liquidityHub.asset());
        asset.safeTransferFrom(from, address(this), amount);
        asset.approve(address(liquidityHub), amount);
        uint256 shares = liquidityHub.deposit(amount, address(this));
        _stake(from, to, shares, tierId);
    }

    function depositAndStakeWithPermit(
        address to,
        uint256 amount,
        uint256 tierId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(IERC4626(address(LIQUIDITY_HUB)).asset()).permit(
            _msgSender(),
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        );
        depositAndStake(to, amount, tierId);
    }

    function unstakeAndWithdraw(uint256 id, address to) external {
        uint256 shares = _unstake(_msgSender(), id, address(this));
        IERC4626(address(LIQUIDITY_HUB)).redeem(shares, to, address(this));
    }

    function burn(uint256) public pure override {
        revert NotImplemented();
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert NotImplemented();
    }

    function allowance(address, address) public pure override returns (uint256) {
        // Silences the unreachable code warning from ERC20._spendAllowance().
        return 0;
    }

    function approve(address, uint256) public pure override returns (bool) {
        revert NotImplemented();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert NotImplemented();
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        require(from == address(0), NotImplemented());
        super._update(from, to, value);
    }
}
