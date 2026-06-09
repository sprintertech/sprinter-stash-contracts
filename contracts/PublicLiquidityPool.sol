// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {LiquidityPoolBase} from "./LiquidityPoolBase.sol";
import {HelperLib} from "./utils/HelperLib.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";

/// @title A version of the liquidity pool contract that supports direct liquidity provision for third parties.
/// Borrowing is managed in the same way as in the base contract, though profits are accounted for differently.
/// Fee is always accounted in the liquidity token (e.g. USDC) and is derived from the target call data, which
/// is expected to contain the amount to receive as a last 32 bytes. Borrow amount minus the amount to receive
/// gives the fee. Before fee is distributed to the depositors, the protocol fee is taken based on the rate.
/// The total assets counter cannot be increased by a donation, making inflation by users impossible.
/// Borrow many is not supported for this pool because only a single asset can be borrowed.
/// @notice Upgradeable.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract PublicLiquidityPool is LiquidityPoolBase, ERC4626Upgradeable {
    using Math for uint256;
    using SafeCast for uint256;

    uint256 private constant RATE_DENOMINATOR = 10000;
    bytes32 private constant FEE_SETTER_ROLE = "FEE_SETTER_ROLE";

    /// @custom:storage-location erc7201:sprinter.storage.PublicLiquidityPool
    struct PublicLiquidityPoolStorage {
        uint128 virtualBalance;
        uint112 protocolFee;
        uint16 protocolFeeRate;
    }

    bytes32 private constant STORAGE_LOCATION = 0xfc6e0eb16ec00fbf03b840cc31ff1058d469948c6d2311253353d02420e68f00;

    event ProtocolFeeRateSet(uint16 protocolFeeRate);

    error TargetCallDataTooShort();
    error InvalidFillAmount();
    error InvalidProtocolFeeRate();

    constructor(
        address liquidityToken,
        address wrappedNativeToken
    ) LiquidityPoolBase(liquidityToken, wrappedNativeToken) {
        ERC7201Helper.validateStorageLocation(STORAGE_LOCATION, "sprinter.storage.PublicLiquidityPool");
    }

    function initialize(
        address admin,
        address mpcAddress_,
        address signerAddress_,
        string memory name_,
        string memory symbol_,
        uint16 protocolFeeRate_
    ) external initializer {
        _initializeBase(admin, mpcAddress_, signerAddress_);
        __ERC4626_init(ASSETS);
        __ERC20_init(name_, symbol_);
        _setProtocolFeeRate(protocolFeeRate_);
    }

    // Public getters for storage variables

    function protocolFee() public view returns (uint112) {
        return _getStorage().protocolFee;
    }

    function protocolFeeRate() public view returns (uint16) {
        return _getStorage().protocolFeeRate;
    }

    function setProtocolFeeRate(uint16 protocolFeeRate_) external onlyRole(FEE_SETTER_ROLE) {
        _setProtocolFeeRate(protocolFeeRate_);
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

    function deposit(uint256) external pure override(LiquidityPoolBase) {
        revert NotImplemented();
    }

    function depositWithPull(uint256) external pure override(LiquidityPoolBase) {
        revert NotImplemented();
    }

    function withdraw(address, uint256) external pure override(LiquidityPoolBase) {
        revert NotImplemented();
    }

    function totalDeposited() external view virtual override returns (uint256) {
        return _getStorage().virtualBalance;
    }

    function totalAssets() public view virtual override returns (uint256) {
        PublicLiquidityPoolStorage storage $ = _getStorage();
        return $.virtualBalance - $.protocolFee;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (_getStorageBase().paused) {
            return 0;
        }
        return Math.min(super.maxWithdraw(owner), HelperLib.balanceOfThis(ASSETS));
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (_getStorageBase().paused) {
            return 0;
        }
        return Math.min(
            super.maxRedeem(owner),
            _convertToShares(HelperLib.balanceOfThis(ASSETS), Math.Rounding.Floor)
        );
    }

    function _setProtocolFeeRate(uint16 protocolFeeRate_) internal {
        require(protocolFeeRate_ <= RATE_DENOMINATOR, InvalidProtocolFeeRate());
        _getStorage().protocolFeeRate = protocolFeeRate_;

        emit ProtocolFeeRateSet(protocolFeeRate_);
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
        _getStorage().virtualBalance =
            (uint256(_getStorage().virtualBalance) + assets).toUint128();
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override whenNotPaused() {
        require(receiver != address(0), ZeroAddress());
        _getStorage().virtualBalance =
            (uint256(_getStorage().virtualBalance) - assets).toUint128();
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _withdrawProfitLogic(IERC20 token) internal override returns (uint256) {
        uint256 totalBalance = HelperLib.balanceOfThis(token);
        if (token == ASSETS) {
            PublicLiquidityPoolStorage storage $ = _getStorage();
            uint256 profit = $.protocolFee;
            uint256 virtualBalance = $.virtualBalance;
            $.protocolFee = 0;
            $.virtualBalance = (virtualBalance - profit).toUint128();
            if (totalBalance > virtualBalance) {
                // In case there are donations sent to the pool.
                profit += totalBalance - virtualBalance;
            }
            return profit;
        }
        return totalBalance;
    }

    function _borrowLogic(address borrowToken, uint256 amount, uint256 totalFee, bytes memory context)
        internal override returns (bytes memory)
    {
        if (totalFee > 0) {
            PublicLiquidityPoolStorage storage $ = _getStorage();
            uint256 protocolFeeIncrease = totalFee.mulDiv($.protocolFeeRate, RATE_DENOMINATOR, Math.Rounding.Ceil);
            $.protocolFee = (uint256($.protocolFee) + protocolFeeIncrease).toUint112();
            $.virtualBalance = (uint256($.virtualBalance) + totalFee).toUint128();
        }
        return super._borrowLogic(borrowToken, amount, totalFee, context);
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

    function _getStorage() internal pure returns (PublicLiquidityPoolStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
