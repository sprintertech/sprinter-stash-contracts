// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {LiquidityHub} from "../LiquidityHub.sol";
import {TestUSDC} from "../testing/TestUSDC.sol";
import {TestWETH} from "../testing/TestWETH.sol";
import {TestLiquidityPool} from "../testing/TestLiquidityPool.sol";
import {TestERC20Token} from "@crytic/properties/contracts/ERC4626/util/TestERC20Token.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract EchidnaLiquidityHub {

    TestUSDC public liquidityToken;
    TestERC20Token public shares;
    LiquidityHub public hub;
    TestLiquidityPool public pool;

    error RequireFailed();

    constructor() {
        shares = new TestERC20Token("Test Token", "TT", 18);
        liquidityToken = new TestUSDC();

        pool = new TestLiquidityPool(liquidityToken, address(this), address(new TestWETH()));

        // Impl
        LiquidityHub hubImpl = new LiquidityHub(address(shares), address(pool));
        // Proxy 
        ERC1967Proxy hubProxy = new ERC1967Proxy(address(hubImpl), "");
        hub = LiquidityHub(address(hubProxy));
        hub.initialize(
            liquidityToken,
            address(this),
            address(this),
            address(this),
            address(this),
            type(uint256).max / 10 ** 14);
        pool.grantRole(pool.LIQUIDITY_ADMIN_ROLE(), address(hub));

        address sender = address(0x10000);
        liquidityToken.mint(sender, 10 ** 16);
        hub.grantRole(hub.ASSETS_ADJUST_ROLE(), address(this));
        hub.grantRole(hub.DEPOSIT_PROFIT_ROLE(), address(this));
    }

    function deposit(uint256 amountDeposit) public {
        liquidityToken.approve(address(hub), amountDeposit);
        hub.deposit(amountDeposit, address(this));
    }

    function mint(uint256 amountMint) public {
        uint256 amountToApprove = hub.previewMint(amountMint);
        liquidityToken.approve(address(hub), amountToApprove);
        hub.mint(amountMint, address(this));
    }

    function withdraw(uint256 amount) public {
        hub.withdraw(amount, address(this), address(this));
    }

    function redeem(uint256 amount) public {
        hub.redeem(amount, address(this), address(this));
    }

    function adjustTotalAssets(uint256 amount, bool isIncrease) public {
        hub.adjustTotalAssets(amount, isIncrease);
    }

    function depositProfit(uint256 amount) public {
        liquidityToken.mint(address(this), amount);
        liquidityToken.approve(address(hub), amount);
        hub.depositProfit(amount);
    }

    // totalAssets should increase during deposit
    function testDeposit(uint256 amount) public {
        // Preconditions
        uint256 assets = hub.totalAssets();
        require(amount > assets / 10 ** 12, RequireFailed());
        uint256 depositedBefore = hub.totalAssets();
        hub.setAssetsLimit(depositedBefore + amount);
        uint256 previewShares = hub.previewDeposit(amount);
        require(previewShares > 0, RequireFailed());
        uint256 sharesBefore = shares.balanceOf(address(this));

        // Action
        liquidityToken.mint(address(this), amount);
        liquidityToken.approve(address(hub), amount);
        bool success;
        try hub.deposit(amount, address(this)) {
            success = true;
        } catch {
            success = false;
        }

        // Postcondition
        uint256 depositedAfter = hub.totalAssets();
        uint256 sharesAfter = shares.balanceOf(address(this));
        assert(success);
        assert(depositedAfter == depositedBefore + amount);
        assert(sharesAfter > sharesBefore);
    }

    // totalAssets should not exceed assetsLimit during deposit
    function testAssetsLimitDeposit(uint256 amount) public {
        // Preconditions
        require(amount > 2, RequireFailed());
        uint256 depositedBefore = hub.totalAssets();
        hub.setAssetsLimit(depositedBefore + amount - 1);

        // Action
        liquidityToken.approve(address(hub), amount);
        bool success;
        try hub.deposit(amount, address(this)) {
            success = true;
        } catch {
            success = false;
        }

        // Postcondition: check that the deposit fails
        assert(!success);
    }

    // withdraw() should be successful
    function testWithdraw(uint256 amount) public {
        // Preconditions
        require(amount > 0, RequireFailed());
        // require(shares.balanceOf(address(this)) >= amount);
        liquidityToken.mint(address(this), amount);
        liquidityToken.approve(address(hub), amount);
        uint256 previewShares = hub.previewDeposit(amount);
        require(previewShares > 0, RequireFailed());
        hub.deposit(amount, address(this));
        uint256 balanceTokenBefore = liquidityToken.balanceOf(address(this));
        uint256 balanceSharesBefore = shares.balanceOf(address(this));
    
        // Action
        bool success;
        try hub.withdraw(amount, address(this), address(this)) {
            success = true;
        } catch {
            success = false;
        }

        // Postcondition
        assert(success);
        uint256 balanceTokenAfter = liquidityToken.balanceOf(address(this));
        uint256 balanceSharesAfter = shares.balanceOf(address(this));
        assert(balanceTokenAfter == balanceTokenBefore + amount);
        assert(balanceSharesAfter < balanceSharesBefore);
    }

    // redeem() should be successful
    function testRedeem(uint256 amount) public {
        // Preconditions
        uint256 assets = hub.totalAssets();
        require(assets > 0, RequireFailed());
        require((amount > assets / 10 ** 12) && (amount > 1), RequireFailed());
        uint256 previewShares = hub.previewDeposit(amount);
        require(previewShares > 0, RequireFailed());
        uint256 balanceSharesBeforeDeposit = shares.balanceOf(address(this));
        liquidityToken.mint(address(this), amount);
        liquidityToken.approve(address(hub), amount);
        hub.deposit(amount, address(this));
        uint256 balanceTokenBeforeRedeem = liquidityToken.balanceOf(address(this));
        uint256 balanceSharesAfterDeposit = shares.balanceOf(address(this));
        uint256 sharesEmitted = balanceSharesAfterDeposit - balanceSharesBeforeDeposit;
    
        // Action
        bool success;
        try hub.redeem(sharesEmitted, address(this), address(this)) {
            success = true;
        } catch {
            success = false;
        }

        // Postcondition
        uint256 balanceTokenAfter = liquidityToken.balanceOf(address(this));
        uint256 balanceSharesAfter = shares.balanceOf(address(this));
        assert(success);
        assert(balanceSharesAfter == balanceSharesBeforeDeposit);
        assert(balanceTokenAfter > balanceTokenBeforeRedeem);
    }
}
