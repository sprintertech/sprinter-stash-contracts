// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {LiquidityPool} from "../LiquidityPool.sol";
import {TestUSDC} from "../testing/TestUSDC.sol";

contract EchidnaLiquidityPool {

    TestUSDC liquidityToken;
    LiquidityPool pool;

    constructor() {
        liquidityToken = new TestUSDC();
        liquidityToken.mint(address(this), 1e18);

        pool = new LiquidityPool(address(liquidityToken), address(this), address(this));
        pool.grantRole(pool.LIQUIDITY_ADMIN_ROLE(), address(this));
        pool.grantRole(pool.WITHDRAW_PROFIT_ROLE(), address(this));
    }

    function deposit(uint256 amountDeposit) public {
        liquidityToken.approve(address(pool), amountDeposit);
        pool.depositWithPull(amountDeposit);
    }

    function addProfit(uint256 amount) public {
        liquidityToken.transfer(address(pool), amount);
    }

    // totalDeposited should increase during deposit with pull
    function testDepositWithPull(uint256 amount) public {
        // Preconditions
        uint256 depositedBefore = pool.totalDeposited();
        require(amount > 0);

        // Action
        liquidityToken.approve(address(pool), amount);
        pool.depositWithPull(amount);

        // Postcondition
        uint256 depositedAfter = pool.totalDeposited();
        assert(depositedAfter > depositedBefore);
    }

    // totalDeposited should increase during deposit
    function testDeposit(uint256 amount) public {
        // Preconditions
        uint256 depositedBefore = pool.totalDeposited();
        require(amount > 0);

        // Action
        liquidityToken.transfer(address(pool), amount);
        bool success = true;
        try pool.deposit(amount) {
        } catch {
            success = false;
        }

        // Postcondition
        uint256 depositedAfter = pool.totalDeposited();
        assert(success);
        assert(depositedAfter > depositedBefore);
    }

    // Profit should not be withdrawn as liquidity
    function testWithdrawal(uint256 amountToWithdraw) public {
        // Preconditions
        uint256 depositedBefore = pool.totalDeposited();
        require(depositedBefore > 0);
        require(depositedBefore >= amountToWithdraw);
        require(amountToWithdraw > 0);
        require(liquidityToken.balanceOf(address(pool)) > depositedBefore);

        // Action
        pool.withdraw(address(this), amountToWithdraw);

        // Postcondition
        uint256 depositedAfter = pool.totalDeposited();
        assert(depositedAfter + amountToWithdraw == depositedBefore);
    }

    // Liquidity should not be withdrawn as profit
    function testWithdrawProfit(uint256 amountProfit) public {
        // Preconditions
        uint256 balanceBefore = liquidityToken.balanceOf(address(pool));
        uint256 depositedBefore = pool.totalDeposited();
        require(balanceBefore >= depositedBefore);
        // require(balanceBefore - depositedBefore >= amountProfit);

        // Action
        address[] memory tokens = new address[](1);
        tokens[0] = address(liquidityToken);
        pool.withdrawProfit(tokens, address(this));

        // Postcondition
        uint256 depositedAfter = pool.totalDeposited();
        assert(depositedAfter == depositedBefore);
    }

    // Deposit and subsequent withdrawal should result in the same balanceAfter
    function testBalance(uint256 amount) public {
        // Preconditions
        uint256 balanceBefore = liquidityToken.balanceOf(address(pool));
        uint256 depositedBefore = pool.totalDeposited();
        require(amount > 0);

        // Action
        liquidityToken.approve(address(pool), amount);
        pool.depositWithPull(amount);
        pool.withdraw(address(this), amount);

        // Postcondition
        uint256 depositedAfter = pool.totalDeposited();
        uint256 balanceAfter = liquidityToken.balanceOf(address(pool));
        assert(depositedAfter == depositedBefore);
        assert(balanceAfter == balanceBefore);
    }
}