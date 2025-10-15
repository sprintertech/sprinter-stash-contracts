// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {LiquidityPool} from "../LiquidityPool.sol";
import {TestUSDC} from "../testing/TestUSDC.sol";
import {TestWETH} from "../testing/TestWETH.sol";

contract EchidnaLiquidityPool {

    TestUSDC public liquidityToken;
    LiquidityPool public pool;

    error RequireFailed();

    constructor() {
        liquidityToken = new TestUSDC();
        liquidityToken.mint(address(this), 1e18);

        pool = new LiquidityPool(
            address(liquidityToken),
            address(this),
            address(this),
            address(new TestWETH()),
            address(this)
        );
        bytes32 liquidityAdminRole = "LIQUIDITY_ADMIN_ROLE";
        bytes32 withdrawProfitRole = "WITHDRAW_PROFIT_ROLE";
        pool.grantRole(liquidityAdminRole, address(this));
        pool.grantRole(withdrawProfitRole, address(this));
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
        require(amount > 0, RequireFailed());

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
        require(amount > 0, RequireFailed());

        // Action
        liquidityToken.transfer(address(pool), amount);
        bool success;
        try pool.deposit(amount) {
            success = true;
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
        require(depositedBefore > 0, RequireFailed());
        require(depositedBefore >= amountToWithdraw, RequireFailed());
        require(amountToWithdraw > 0, RequireFailed());
        require(liquidityToken.balanceOf(address(pool)) > depositedBefore, RequireFailed());

        // Action
        pool.withdraw(address(this), amountToWithdraw);

        // Postcondition
        uint256 depositedAfter = pool.totalDeposited();
        assert(depositedAfter + amountToWithdraw == depositedBefore);
    }

    // Liquidity should not be withdrawn as profit
    function testWithdrawProfit() public {
        // Preconditions
        uint256 balanceBefore = liquidityToken.balanceOf(address(pool));
        uint256 depositedBefore = pool.totalDeposited();
        require(balanceBefore >= depositedBefore, RequireFailed());
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
        require(amount > 0, RequireFailed());

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
