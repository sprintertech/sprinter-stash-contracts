// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {LiquidityMining} from "../LiquidityMining.sol";
/// ERC20
import {TestUSDC} from "../testing/TestUSDC.sol";

contract EchidnaLiquidityMining {

    TestUSDC stakingToken;
    LiquidityMining mining;
    LiquidityMining.Tier[] public tiers;

    constructor() {
        stakingToken = new TestUSDC();
        stakingToken.mint(address(this), 1e18);

        tiers.push(LiquidityMining.Tier(30, 100_0000000));
        tiers.push(LiquidityMining.Tier(60, 150_0000000));
        tiers.push(LiquidityMining.Tier(120, 200_0000000));

        mining = new LiquidityMining(
            "SprinterLiquidityMining",
            "Spr",
            address(this),
            address(stakingToken),
            tiers
        );
    }

    // Should mint correct amount
    function testStake(uint256 stakingAmount) public {
        // Preconditions
        stakingToken.approve(address(mining), stakingAmount);
        uint256 balanceBefore = mining.balanceOf(address(this));

        // Action
        mining.stake(address(this), stakingAmount, 0);

        // Postcondition
        uint256 balanceAfter = mining.balanceOf(address(this));
        assert(balanceAfter == balanceBefore + stakingAmount * tiers[0].multiplier / mining.MULTIPLIER_PRECISION());
    }
}