// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import "@crytic/properties/contracts/util/PropertiesHelper.sol";
import {PublicLiquidityPool} from "../PublicLiquidityPool.sol";
import {TestUSDC} from "../testing/TestUSDC.sol";
import {TestWETH} from "../testing/TestWETH.sol";

contract EchidnaPublicLiquidityPool is PropertiesAsserts {
    TestUSDC public liquidityToken;
    TestWETH public weth;
    PublicLiquidityPool public pool;

    constructor() {
        liquidityToken = new TestUSDC();
        weth = new TestWETH();

        liquidityToken.mint(address(this), type(uint128).max);

        pool = new PublicLiquidityPool(
            address(liquidityToken),
            address(this),
            address(this),
            address(weth),
            address(this),
            "Test Pool",
            "TP",
            1000 // 10% protocol fee
        );

        // Grant roles
        bytes32 LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
        bytes32 WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";
        bytes32 FEE_SETTER_ROLE = "FEE_SETTER_ROLE";
        bytes32 PAUSER_ROLE = "PAUSER_ROLE";
        pool.grantRole(LIQUIDITY_ADMIN_ROLE, address(this));
        pool.grantRole(WITHDRAW_PROFIT_ROLE, address(this));
        pool.grantRole(FEE_SETTER_ROLE, address(this));
        pool.grantRole(PAUSER_ROLE, address(this));
    }

    function deposit(uint256 assets) public {
        assets = _bound(assets, 1, 1e24);
        liquidityToken.approve(address(pool), assets);
        pool.deposit(assets, address(this)); // ERC4626 deposit
    }

    function withdraw(uint256 assets) public {
        uint256 maxA = pool.maxWithdraw(address(this));
        if (maxA == 0) return;
        assets = _bound(assets, 1, maxA);
        pool.withdraw(assets, address(this), address(this));
    }

    function redeem(uint256 shares) public {
        uint256 maxS = pool.maxRedeem(address(this));
        if (maxS == 0) return;
        shares = _bound(shares, 1, maxS);
        pool.redeem(shares, address(this), address(this));
    }

    // Direct donation (transfer tokens without calling pool functions)
    function donate(uint256 amount) public {
        amount = _bound(amount, 1, 1e24);
        liquidityToken.transfer(address(pool), amount);
    }

    // === Donation invariants ===

    /// totalDeposited is virtualBalance, always equals totalAssets + protocolFee.
    function totalDeposited_eq_assets_plus_fee() public {
        assertEq(pool.totalDeposited(), pool.totalAssets() + pool.protocolFee(), "totalDeposited != totalAssets + protocolFee");
    }

    /// Direct donations must NOT change totalDeposited (virtual balance).
    function donation_does_not_change_totalDeposited() public {
        uint256 beforeTD = pool.totalDeposited();
        liquidityToken.transfer(address(pool), 1);
        uint256 afterTD = pool.totalDeposited();
        assertEq(afterTD, beforeTD, "donation changed totalDeposited");
    }

    /// Direct donations must NOT mint/burn shares (totalSupply unchanged).
    function donation_does_not_change_totalSupply() public {
        uint256 beforeTS = pool.totalSupply();
        liquidityToken.transfer(address(pool), 1);
        uint256 afterTS = pool.totalSupply();
        assertEq(afterTS, beforeTS, "donation changed totalSupply");
    }

    /// totalAssets should be unaffected by a pure donation (it tracks virtual balance minus fee).
    function donation_does_not_change_totalAssets() public {
        uint256 beforeTA = pool.totalAssets();
        liquidityToken.transfer(address(pool), 1);
        uint256 afterTA = pool.totalAssets();
        assertEq(afterTA, beforeTA, "donation changed totalAssets");
    }

    /// Protocol fee never exceeds virtual balance.
    function protocolFee_le_totalDeposited() public {
        assertLte(pool.protocolFee(), pool.totalDeposited(), "protocolFee > totalDeposited");
    }

    /// Protocol fee rate is always within denominator.
    function feeRate_le_denominator() public {
        assertLte(pool.protocolFeeRate(), 10000, "protocolFeeRate > 10000");
    }

    /// Storage bounds respected.
    function bounds() public {
        assertLte(pool.totalDeposited(), type(uint128).max, "totalDeposited exceeds uint128");
        assertLte(pool.protocolFee(), type(uint112).max, "protocolFee exceeds uint112");
    }

    // === ERC4626 conversion invariants (with 1-wei tolerance) ===

    function previewDeposit_matches_convertToShares() public {
        uint256 assets = 1e18; // sample amount
        assertEq(pool.previewDeposit(assets), pool.convertToShares(assets), "previewDeposit != convertToShares");
    }

    function previewRedeem_matches_convertToAssets() public {
        uint256 shares = pool.totalSupply() == 0 ? 1e18 : _min(pool.totalSupply(), 1e24);
        assertEq(pool.previewRedeem(shares), pool.convertToAssets(shares), "previewRedeem != convertToAssets");
    }

    function roundtrip_shares() public {
        if (pool.totalSupply() == 0) return;
        uint256 shares = _min(pool.totalSupply(), 1e24);
        uint256 assets = pool.convertToAssets(shares);
        uint256 sharesBack = pool.convertToShares(assets);
        assertGte(sharesBack + 1, shares, "roundtrip_shares: sharesBack + 1 < shares");
        assertLte(sharesBack, shares + 1, "roundtrip_shares: sharesBack > shares + 1");
    }

    function roundtrip_assets() public {
        uint256 assets = 1e18;
        uint256 shares = pool.convertToShares(assets);
        uint256 assetsBack = pool.convertToAssets(shares);
        assertGte(assetsBack + 1, assets, "roundtrip_assets: assetsBack + 1 < assets");
        assertLte(assetsBack, assets, "roundtrip_assets: assetsBack > assets");
    }

    // === Max functions / pause invariants ===

    function maxWithdraw_equals_convertToAssets_maxRedeem() public {
        assertEq(pool.maxWithdraw(address(this)), pool.convertToAssets(pool.maxRedeem(address(this))), "maxWithdraw != convertToAssets(maxRedeem)");
    }

    function maxWithdraw_le_assets_of_owner_when_not_paused() public {
        if (pool.paused()) return;
        assertLte(
            pool.maxWithdraw(address(this)),
            pool.convertToAssets(pool.balanceOf(address(this))),
            "maxWithdraw > assets of owner"
        );
    }

    function paused_blocks_withdrawals() public {
        bool wasPaused = pool.paused();
        if (!wasPaused) pool.pause();
        assertEq(pool.maxWithdraw(address(this)), 0, "maxWithdraw not zero when paused");
        assertEq(pool.maxRedeem(address(this)), 0, "maxRedeem not zero when paused");
        if (!wasPaused) pool.unpause();
    }

    // === Other invariants ===

    /// Total deposited never less than protocol fee.
    function totalDeposited_ge_protocolFee() public {
        assertLte(pool.totalDeposited(), pool.protocolFee(), "totalDeposited < protocolFee");
    }

    /// Total deposited decreases after withdrawal.
    function totalDeposited_decreases_after_withdrawal() public {
        uint256 maxA = pool.maxWithdraw(address(this));
        if (maxA == 0) return;
        uint256 beforeTD = pool.totalDeposited();
        pool.withdraw(1, address(this), address(this));
        uint256 afterTD = pool.totalDeposited();
        assertLt(afterTD, beforeTD, "totalDeposited did not decrease after withdrawal");
    }

    // === Helpers ===
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _bound(uint256 x, uint256 minVal, uint256 maxVal) internal pure returns (uint256) {
        if (x < minVal) return minVal;
        if (x > maxVal) return maxVal;
        return x;
    }
}
