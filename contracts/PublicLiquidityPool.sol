// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626, ERC20, Math} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {LiquidityPool} from "./LiquidityPool.sol";

/// @title A version of the liquidity pool contract that supports direct liquidity provision for third parties.
/// Borrowing is managed in the same way as in the base contract, though profits are accounted for differently.
/// Fee is always accounted in the liquidity token (e.g. USDC) and is derived from the target call data, whcih
/// is expected to contain the fill amount as a second ABI encoded parameter. Borrow amount minus the fill amount
/// gives the fee. Before fee is distributed to the depositors, the protocol fee is taken based on the rate.
/// The total assets counter cannot be increased by a donation, making inflation by users impossible.
/// Borrow many is not supported for this pool because only a single asset can be borrowed.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract PublicLiquidityPool is LiquidityPool, ERC4626 {
    using Math for uint256;
    using SafeCast for uint256;

    uint256 private constant MULTIPLIER = 10000;
    bytes32 private constant FEE_SETTER_ROLE = "FEE_SETTER_ROLE";

    uint128 public eventualAssets;
    uint112 public protocolFee;
    uint16 public protocolFeeRate;

    event ProtocolFeeRateSet(uint16 protocolFeeRate);

    error TargetCallDataTooShort();
    error InvalidFillAmount();
    error InvalidProtocolFeeRate();

    constructor(
        address liquidityToken,
        address admin,
        address mpcAddress_,
        address wrappedNativeToken,
        address signerAddress_,
        string memory name_,
        string memory symbol_,
        uint16 protocolFeeRate_
    )
        LiquidityPool(liquidityToken, admin, mpcAddress_, wrappedNativeToken, signerAddress_)
        ERC4626(IERC20(liquidityToken))
        ERC20(name_, symbol_)
    {
        _setProtocolFeeRate(protocolFeeRate_);
    }

    function setProtocolFeeRate(uint16 protocolFeeRate_) external onlyRole(FEE_SETTER_ROLE) {
        _setProtocolFeeRate(protocolFeeRate_);
    }

    function totalAssets() public view virtual override returns (uint256) {
        return eventualAssets;
    }

    function _setProtocolFeeRate(uint16 protocolFeeRate_) internal {
        require(protocolFeeRate_ <= MULTIPLIER, InvalidProtocolFeeRate());
        protocolFeeRate = protocolFeeRate_;

        emit ProtocolFeeRateSet(protocolFeeRate_);
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view virtual override returns (uint256) {
        (uint256 supplyShares, uint256 supplyAssets) = _getTotalsForConversion();
        return assets.mulDiv(supplyShares, supplyAssets, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view virtual override returns (uint256) {
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

    function deposit(uint256) external pure override {
        revert NotImplemented();
    }

    function depositWithPull(uint256) external pure override {
        revert NotImplemented();
    }

    function withdraw(address, uint256) external pure override {
        revert NotImplemented();
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        super._deposit(caller, receiver, assets, shares);
        eventualAssets = (uint256(eventualAssets) + assets).toUint128();
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        super._withdraw(caller, receiver, owner, assets, shares);
        eventualAssets = (uint256(eventualAssets) - assets).toUint128();
    }

    function _withdrawProfitLogic(IERC20 token) internal override returns (uint256) {
        if (token == ASSETS) {
            uint256 profit = protocolFee;
            protocolFee = 0;
            return profit;
        }
        return token.balanceOf(address(this));
    }

    function _processBorrowAmount(uint256 amount, bytes calldata targetCallData)
        internal override returns (uint256)
    {
        require(targetCallData.length >= 68, TargetCallDataTooShort());
        uint256 fillAmount = abi.decode(targetCallData[36:], (uint256));
        require(fillAmount <= amount, InvalidFillAmount());
        uint256 totalFee = amount - fillAmount;
        if (totalFee > 0) {
            uint256 protocolFeeIncrease = totalFee.mulDiv(protocolFeeRate, MULTIPLIER, Math.Rounding.Ceil);
            protocolFee = (uint256(protocolFee) + protocolFeeIncrease).toUint112();
            eventualAssets = (uint256(eventualAssets) + (totalFee - protocolFeeIncrease)).toUint128();
        }
        return fillAmount;
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
