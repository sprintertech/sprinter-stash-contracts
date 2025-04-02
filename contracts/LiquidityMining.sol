// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Staking contract locks the stake according to the configured/specified tier parameters.
/// Each tier specifies a lock period in seconds and a multiplier that is used to mint score to the staker.
/// The score is represented as an ERC20 token which this contract is itself.
/// Each stake, even by the same user, is treated independently.
/// Rewards are minted immediately upon staking because user cannot unstake early.
/// The multiplier is specified in units of 0.01, eg. 150 will result in a 1.5x of staked amount as score.
/// The owner can disable the future staking, without the ability to enable it again, which does not affect
/// existing stakes.
/// @author Oleksii Matiiasevych <oleksii@chainsafe.io>
contract LiquidityMining is ERC20, Ownable {
    using SafeERC20 for IERC20;

    uint32 public constant MULTIPLIER_PRECISION = 1000000000;
    IERC20 public immutable STAKING_TOKEN;

    struct Tier {
        uint32 period;
        uint32 multiplier;
    }

    struct Stake {
        uint256 amount;
        uint32 period;
        uint32 until;
        uint32 multiplier;
    }

    bool public miningAllowed;
    Tier[] public tiers;
    mapping(address user => Stake[]) public stakes;

    event DisableMining();
    event StakeLocked(
        address from,
        address to,
        uint256 amount,
        uint32 until,
        uint256 addedScore
    );
    event StakeUnlocked(
        address from,
        address to,
        uint256 amount
    );

    error ZeroAddress();
    error EmptyInput();
    error ZeroPeriod();
    error ZeroMultiplier();
    error DecreasingPeriod();
    error AlreadyDisabled();
    error MiningDisabled();
    error ZeroAmount();
    error Locked();
    error InvalidTierId();

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        address stakingToken,
        Tier[] memory tiers_
    )
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        require(stakingToken != address(0), ZeroAddress());
        STAKING_TOKEN = IERC20(stakingToken);
        miningAllowed = true;
        require(tiers_.length > 0, EmptyInput());
        for (uint256 i = 0; i < tiers_.length; ++i) {
            require(tiers_[i].period > 0, ZeroPeriod());
            require(tiers_[i].multiplier > 0, ZeroMultiplier());
            if (i > 0) {
                require(tiers_[i].period > tiers_[i - 1].period, DecreasingPeriod());
            }
            tiers.push(tiers_[i]);
        }
    }

    function getStakes(address user) public view returns(Stake[] memory) {
        return stakes[user];
    }

    function stake(address to, uint256 amount, uint256 tierId) public {
        STAKING_TOKEN.safeTransferFrom(_msgSender(), address(this), amount);
        _stake(_msgSender(), to, amount, tierId);
    }

    function stakeWithPermit(
        address to,
        uint256 amount,
        uint256 tierId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(address(STAKING_TOKEN)).permit(
            _msgSender(),
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        );
        stake(to, amount, tierId);
    }

    function unstake(uint256 id, address to) external {
        uint256 amount = _unstake(_msgSender(), id, to);
        STAKING_TOKEN.safeTransfer(to, amount);
    }

    function disableMining() external onlyOwner() {
        require(miningAllowed, AlreadyDisabled());
        miningAllowed = false;
        emit DisableMining();
    }

    function _stake(address from, address to, uint256 amount, uint256 tierId) internal {
        require(tierId < tiers.length, InvalidTierId());
        require(amount > 0, ZeroAmount());
        require(miningAllowed, MiningDisabled());
        Stake memory currentStake;
        Tier memory tier = tiers[tierId];
        currentStake.amount = amount;
        currentStake.period = tier.period;
        currentStake.until = timeNow() + tier.period;
        currentStake.multiplier = tier.multiplier;
        stakes[to].push(currentStake);
        uint256 addedScore =
            currentStake.amount * uint256(tier.multiplier) /
            uint256(MULTIPLIER_PRECISION);
        _mint(to, addedScore);

        emit StakeLocked(from, to, amount, currentStake.until, addedScore);
    }

    function _unstake(address from, uint256 id, address to) internal returns (uint256) {
        Stake memory currentStake = stakes[from][id];
        require(currentStake.amount > 0, ZeroAmount());
        require(reached(currentStake.until), Locked());
        delete stakes[from][id];

        emit StakeUnlocked(from, to, currentStake.amount);

        return currentStake.amount;
    }

    function burn(uint256 value) public virtual {
        _burn(_msgSender(), value);
    }

    function timeNow() internal view returns (uint32) {
        return uint32(block.timestamp);
    }

    function reached(uint32 timestamp) internal view returns (bool) {
        return timeNow() >= timestamp;
    }
}
