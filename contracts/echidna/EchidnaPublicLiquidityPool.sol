// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {PropertiesAsserts} from "@crytic/properties/contracts/util/PropertiesHelper.sol";
import {PublicLiquidityPool} from "../PublicLiquidityPool.sol";
import {TestUSDC} from "../testing/TestUSDC.sol";
import {TestWETH} from "../testing/TestWETH.sol";

contract EchidnaPublicLiquidityPool is PropertiesAsserts {
    TestUSDC public liquidityToken;
    TestWETH public weth;
    PublicLiquidityPool public pool;

    bytes32 private constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 private constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";
    bytes32 private constant FEE_SETTER_ROLE = "FEE_SETTER_ROLE";
    bytes32 private constant PAUSER_ROLE = "PAUSER_ROLE";

    error RequireFailed();

    constructor() {
        liquidityToken = new TestUSDC();
        weth = new TestWETH();

        // Mint plenty of tokens to this contract (Echidna sender)
        liquidityToken.mint(address(this), type(uint128).max);

        pool = new PublicLiquidityPool(
            address(liquidityToken),
            address(this),      // admin
            0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65,      // mpcAddress
            address(weth),
            address(this),
            "Test Pool",
            "TPOOL",
            1000 // 10% protocol fee
        );

        // Grant needed roles
        pool.grantRole(LIQUIDITY_ADMIN_ROLE, address(this));
        pool.grantRole(WITHDRAW_PROFIT_ROLE, address(this));
        pool.grantRole(FEE_SETTER_ROLE, address(this));
        pool.grantRole(PAUSER_ROLE, address(this));

        // Initial deposit so borrow can work
        liquidityToken.approve(address(pool), type(uint128).max);
        pool.deposit(1e24, address(this));
    }

    function deposit(uint256 assets) public {
        assets = clampBetween(assets, 1, 1e24);
        liquidityToken.approve(address(pool), assets);
        pool.deposit(assets, address(this)); // ERC4626 deposit
    }

    function withdraw(uint256 assets) public {
        uint256 maxA = pool.maxWithdraw(address(this));
        if (maxA == 0) return;
        assets = clampBetween(assets, 1, maxA);
        pool.withdraw(assets, address(this), address(this));
    }

    function withdrawProfit() public {
        require(pool.protocolFee() > 0, RequireFailed());
        address[] memory tokens = new address[](1);
        tokens[0] = address(liquidityToken);
        pool.withdrawProfit(tokens, address(this));
    }

    function redeem(uint256 shares) public {
        uint256 maxS = pool.maxRedeem(address(this));
        if (maxS == 0) return;
        shares = clampBetween(shares, 1, maxS);
        pool.redeem(shares, address(this), address(this));
    }

    /// @notice Wrapper for borrow that uses pre-computed signature
    function borrow() public {
        uint256 amount = 3000000;
        uint256 amountToReceive = 2000000;

        // Target call data to call fulfillSkip() on this contract
        bytes memory targetCallData1 = abi.encodeWithSelector(this.fulfillSkip.selector);
        bytes memory targetCallData = abi.encodePacked(targetCallData1, amountToReceive);

        uint256 nonce = 0;
        uint256 deadline = 2000000000;

        bytes memory signature = bytes.concat(
            hex"cc4c2b36043bfadbfe43e27efc5dd370a770cc906fd6c6ef1ad569b7cbb082bd",
            hex"3fa65af9793a4b7439faba84c12fa927b2b1e20e26f883020e1ae534118a17a51b"
        );

        // Call borrow - may revert
        try pool.borrow(
            address(liquidityToken),
            amount,
            address(this),
            targetCallData,
            nonce,
            deadline,
            signature
        ) {
            liquidityToken.transferFrom(address(pool), address(this), amountToReceive);
        } catch {
            return;
        }
    }

    function fulfillSkip() external {
        return;
    }

    // Direct donation (transfer tokens without calling pool functions)
    function donate(uint256 amount) public {
        amount = clampBetween(amount, 1, 1e24);
        liquidityToken.transfer(address(pool), amount);
    }

    // === Donation invariants ===

    /// totalDeposited is virtualBalance, always equals totalAssets + protocolFee.
    function totalDeposited_eq_assets_plus_fee() public {
        assertEq(
            pool.totalDeposited(), pool.totalAssets() + pool.protocolFee(),
            "totalDeposited != totalAssets + protocolFee"
        );
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
        assertEq(
            pool.previewDeposit(assets), pool.convertToShares(assets),
            "previewDeposit != convertToShares"
        );
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
        uint256 assets = 1e18; // sample amount
        uint256 shares = pool.convertToShares(assets);
        uint256 assetsBack = pool.convertToAssets(shares);
        emit LogUint256("totalSupply", pool.totalSupply());
        emit LogUint256("totalAssets", pool.totalAssets());
        emit LogUint256("balanceOf", liquidityToken.balanceOf(address(pool)));
        emit LogUint256("protocolFee", pool.protocolFee());
        assertGte(assetsBack + 5e6, assets, "roundtrip_assets: assetsBack + 5e6 < assets");
        assertLte(assetsBack, assets + 5e6, "roundtrip_assets: assetsBack > assets + 5e6");
    }

    // === Max functions / pause invariants ===

    function maxWithdraw_equals_convertToAssets_maxRedeem() public {
        assertGte(
            pool.maxWithdraw(address(this)) + 1, pool.convertToAssets(pool.maxRedeem(address(this))),
            "maxWithdraw != convertToAssets(maxRedeem)"
        );
        assertLte(
            pool.maxWithdraw(address(this)), pool.convertToAssets(pool.maxRedeem(address(this)) + 1),
            "maxWithdraw != convertToAssets(maxRedeem)"
        );
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
        assertGte(pool.totalDeposited(), pool.protocolFee(), "totalDeposited < protocolFee");
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

    /// Total deposited and accumulated protocol fee decrease after profit withdrawal.
    function totalDeposited_protocolFee_decreases_after_withdrawProfit() public {
        uint256 beforeTD = pool.totalDeposited();
        uint256 beforePF = pool.protocolFee();
        if (beforeTD == 0) {
            deposit(1e18);
            beforeTD = pool.totalDeposited();
        }
        if (beforePF == 0) {
            borrow();
            beforeTD = pool.totalDeposited();
            beforePF = pool.protocolFee();
        }
        require(pool.protocolFee() > 0, RequireFailed());
        address[] memory tokens = new address[](1);
        tokens[0] = address(liquidityToken);
        pool.withdrawProfit(tokens, address(this));
        uint256 afterTD = pool.totalDeposited();
        uint256 afterPF = pool.protocolFee();
        assertLt(afterPF, beforePF, "protocolFee did not decrease after withdrawProfit");
        assertLt(afterTD, beforeTD, "totalDeposited did not decrease after withdrawProfit");
    }

    // === Helpers ===
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
