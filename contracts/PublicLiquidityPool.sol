// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ERC4626, ERC20, Math} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {LiquidityPool} from "./LiquidityPool.sol";

/// @title A version of the liquidity pool contract that supports direct liquidity provision for third parties.
/// Borrowing is managed in the same way as in the base contract, though profits are accounted for differently.
/// Fee is always accounted in the liquidity token (e.g. USDC) and could be a flat rate or a percentage of the
/// borrowed amount whichever is higher. Fee does not change the borrowed amount, instead it is applied on top
/// of it and is assumed to be repayed eventually. Before fee is distributed to the depositors, the protocol
/// fee is taken based on the protocol rate.
/// The total assets counter cannot be increased by a donation, making inflation by users impossible.
/// Borrow many is not supported for this pool because only a single asset can be borrowed.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract PublicLiquidityPool is LiquidityPool, ERC4626 {
    using Math for uint256;
    using SafeCast for uint256;

    uint256 private constant RATE_DENOMINATOR = 10000;
    bytes32 private constant FEE_SETTER_ROLE = "FEE_SETTER_ROLE";

    struct Fee {
        uint128 flat;
        uint16 rate;
        uint16 protocolRate;
    }

    // Balance of the assets in the pool with fees, after all repayments will be done.
    uint128 private _virtualBalance;
    uint128 public protocolFee;
    Fee public feeConfig;

    event FeeConfigSet(Fee feeConfig);

    error TargetCallDataTooShort();
    error InvalidFillAmount();
    error InvalidFeeRate();
    error InvalidProtocolFeeRate();

    constructor(
        address liquidityToken,
        address admin,
        address mpcAddress_,
        address wrappedNativeToken,
        address signerAddress_,
        string memory name_,
        string memory symbol_,
        Fee memory feeConfig_
    )
        LiquidityPool(liquidityToken, admin, mpcAddress_, wrappedNativeToken, signerAddress_)
        ERC4626(IERC20(liquidityToken))
        ERC20(name_, symbol_)
    {
        _setFeeConfig(feeConfig_);
    }

    function setFeeConfig(Fee memory feeConfig_) external onlyRole(FEE_SETTER_ROLE) {
        _setFeeConfig(feeConfig_);
    }

    // Note, a malicious actor could frontrun the permit() call in separate transaction, which will
    // make this transaction revert. It is an unlikely possibility because there is no gain in it.
    // If such frontrun did happen, a user can proceed with a simple deposit() as the allowance would
    // already be given.
    function depositWithPermit(
        uint256 assets,
        address receiver,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(address(ASSETS)).permit(
            _msgSender(),
            address(this),
            assets,
            deadline,
            v,
            r,
            s
        );
        deposit(assets, receiver);
    }

    function deposit(uint256) external pure override(LiquidityPool) {
        revert NotImplemented();
    }

    function depositWithPull(uint256) external pure override(LiquidityPool) {
        revert NotImplemented();
    }

    function withdraw(address, uint256) external pure override(LiquidityPool) {
        revert NotImplemented();
    }

    function totalDeposited() external view virtual override returns (uint256) {
        return _virtualBalance;
    }

    function totalAssets() public view virtual override returns (uint256) {
        return _virtualBalance - protocolFee;
    }

    function _setFeeConfig(Fee memory feeConfig_) internal {
        require(feeConfig_.rate <= RATE_DENOMINATOR, InvalidFeeRate());
        require(feeConfig_.protocolRate <= RATE_DENOMINATOR, InvalidProtocolFeeRate());
        feeConfig = feeConfig_;

        emit FeeConfigSet(feeConfig_);
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        (uint256 supplyShares, uint256 supplyAssets) = _getTotalsForConversion();
        return assets.mulDiv(supplyShares, supplyAssets, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
        (uint256 supplyShares, uint256 supplyAssets) = _getTotalsForConversion();
        return shares.mulDiv(supplyAssets, supplyShares, rounding);
    }

    function _getTotalsForConversion() internal view returns (uint256, uint256) {
        uint256 supplyShares = totalSupply();
        uint256 supplyAssets = totalAssets();
        if (supplyShares == 0) {
            supplyShares = 10 ** _decimalsOffset();
        }
        if (supplyAssets == 0) {
            supplyAssets = 1;
        }
        return (supplyShares, supplyAssets);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        require(receiver != address(0), ZeroAddress());
        super._deposit(caller, receiver, assets, shares);
        _virtualBalance = (uint256(_virtualBalance) + assets).toUint128();
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override whenNotPaused() {
        require(receiver != address(0), ZeroAddress());
        _virtualBalance = (uint256(_virtualBalance) - assets).toUint128();
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _withdrawProfitLogic(IERC20 token) internal override returns (uint256) {
        uint256 totalBalance = token.balanceOf(address(this));
        if (token == ASSETS) {
            uint256 profit = protocolFee;
            protocolFee = 0;
            if (totalBalance > _virtualBalance) {
                // In case there are donations sent to the pool.
                profit += totalBalance - _virtualBalance;
            }
            return profit;
        }
        return totalBalance;
    }

    function _borrowLogic(address borrowToken, uint256 amount, bytes memory context)
        internal override returns (bytes memory)
    {
        Fee memory config = feeConfig;
        uint256 totalFee = Math.max(config.flat, amount.mulDiv(config.rate, RATE_DENOMINATOR, Math.Rounding.Ceil));
        if (totalFee > 0) {
            uint256 protocolFeeIncrease = totalFee.mulDiv(config.protocolRate, RATE_DENOMINATOR, Math.Rounding.Ceil);
            protocolFee = (uint256(protocolFee) + protocolFeeIncrease).toUint128();
            _virtualBalance = (uint256(_virtualBalance) + totalFee).toUint128();
        }
        return super._borrowLogic(borrowToken, amount, context);
    }

    /// @dev Borrow many is not supported for this pool because only a single asset can be borrowed.
    function _afterBorrowManyLogic(
        address[] memory /*borrowTokens*/,
        bytes memory /*context*/
    ) internal pure override {
        // Condition is needed to avoid Unreachable code warning in the LiquidityPool.
        if (true) {
            revert NotImplemented();
        }
    }
}
