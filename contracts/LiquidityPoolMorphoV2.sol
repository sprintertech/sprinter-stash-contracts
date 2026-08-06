// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMorphoVaultV2} from "./interfaces/IMorphoVaultV2.sol";
import {LiquidityPoolBase} from "./LiquidityPool.sol";
import {HelperLib} from "./utils/HelperLib.sol";

/// @title A version of the liquidity pool contract that keeps deposited assets in a Morpho Vault V2.
/// Deposits are supplied to the vault in exchange for shares. Unlike Aave, there is no separate
/// collateral/debt position: this pool is single-asset only, and borrowing simply withdraws the
/// borrowed amount directly from the vault's idle liquidity. Repayment deposits the received assets
/// back into the vault, so idle funds never sit uninvested.
/// For this initial implementation the vault is assumed to always hold enough idle liquidity to
/// cover withdrawals. FORCE_DEALLOCATE_ROLE can call forceDeallocate() as a manual escape hatch
/// otherwise.
/// @notice Upgradeable.
contract LiquidityPoolMorphoV2 is LiquidityPoolBase {
    using SafeERC20 for IERC20;

    bytes32 private constant FORCE_DEALLOCATE_ROLE = "FORCE_DEALLOCATE_ROLE";

    IMorphoVaultV2 immutable public MORPHO_VAULT;

    error IncompatibleAssets();

    event SuppliedToMorphoVault(uint256 amount);
    event WithdrawnFromMorphoVault(address to, uint256 amount);
    event ForceDeallocated(address adapter, uint256 assets, uint256 penaltyShares);

    constructor(
        address liquidityToken,
        address morphoVault,
        address wrappedNativeToken
    ) LiquidityPoolBase(liquidityToken, wrappedNativeToken) {
        require(morphoVault != address(0), ZeroAddress());
        require(liquidityToken == IMorphoVaultV2(morphoVault).asset(), IncompatibleAssets());
        MORPHO_VAULT = IMorphoVaultV2(morphoVault);
    }

    function initialize(
        address admin,
        address mpcAddress_,
        address signerAddress_
    ) external initializer {
        _initializeBase(admin, mpcAddress_, signerAddress_);
    }

    /// @notice Manual escape hatch for when the vault's idle liquidity is insufficient to cover a
    /// withdrawal/borrow. Pulls `assets` back from `adapter` into the vault's idle pool, burning a
    /// curator-configured penalty (in shares) from this contract's position.
    /// @dev MORPHO_VAULT.forceDeallocate only bypasses this role gate when the curator has
    /// configured a zero penalty for `adapter`: in that case it is fully permissionless and anyone
    /// can call it directly on the vault with onBehalf set to this contract. With a positive
    /// penalty, only the shares owner (this contract) or an address holding an allowance from it to
    /// burn shares can trigger it, so this role gate is meaningful protection whenever a real
    /// penalty is configured.
    function forceDeallocate(
        address adapter,
        bytes calldata data,
        uint256 assets
    ) external onlyRole(FORCE_DEALLOCATE_ROLE) returns (uint256 penaltyShares) {
        penaltyShares = MORPHO_VAULT.forceDeallocate(adapter, data, assets, address(this));
        emit ForceDeallocated(adapter, assets, penaltyShares);
        return penaltyShares;
    }

    // Internal functions

    function _depositToVault(uint256 amount) internal {
        ASSETS.forceApprove(address(MORPHO_VAULT), amount);
        MORPHO_VAULT.deposit(amount, address(this));
    }

    function _withdrawFromVault(uint256 amount, address to) internal {
        MORPHO_VAULT.withdraw(amount, to, address(this));
    }

    function _depositLogic(uint256 amount) internal override {
        _depositToVault(amount);
        emit SuppliedToMorphoVault(amount);
    }

    function _borrowLogic(address borrowToken, uint256 amount, uint256 profit, bytes memory context)
        internal override returns (bytes memory)
    {
        // Enforces borrowToken == address(ASSETS): this pool is single-asset only.
        context = super._borrowLogic(borrowToken, amount, profit, context);
        _withdrawFromVault(amount, address(this));
        return context;
    }

    function _withdrawLogic(address to, uint256 amount) internal override {
        _withdrawFromVault(amount, to);
        emit WithdrawnFromMorphoVault(to, amount);
    }

    /// @dev Cannot delegate to the base implementation for ASSETS: it compares totalDeposited
    /// against this contract's own raw ERC20 balance, but here the deposited principal lives in the
    /// vault (as shares), not as a local balance. Reimplements the same profit/direct-debt logic
    /// with totalAssets (local balance + the vault position's asset-equivalent value) standing in
    /// for the base's currentBalance, then pulls any shortfall out of the vault so the returned
    /// amount is actually available locally for withdrawProfit()'s subsequent transfer.
    function _withdrawProfitLogic(IERC20 token) internal override returns (uint256) {
        if (token != ASSETS) {
            return super._withdrawProfitLogic(token);
        }

        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        uint256 deposited = $.totalDeposited;
        uint256 rawBalance = HelperLib.balanceOfThis(ASSETS);
        uint256 totalAssets = MORPHO_VAULT.previewRedeem(HelperLib.balanceOfThis(MORPHO_VAULT)) + rawBalance;

        uint256 virtualBalance = totalAssets + $.directDebt[address(ASSETS)];
        uint256 withdrawableSurplus = 0;
        if (virtualBalance > deposited) {
            withdrawableSurplus = Math.min(virtualBalance - deposited, totalAssets);
        }

        int256 profit = $.accruedProfit[address(ASSETS)];
        uint256 amount;
        if (profit <= 0) {
            amount = withdrawableSurplus;
        } else {
            uint256 toWithdraw = Math.min(totalAssets, uint256(profit));
            $.accruedProfit[address(ASSETS)] = profit - int256(toWithdraw);
            amount = Math.max(toWithdraw, withdrawableSurplus);
        }

        if (amount > rawBalance) {
            _withdrawLogic(address(this), amount - rawBalance);
        }
        return amount;
    }

    function _repay(address[] calldata borrowTokens) internal override {
        require(borrowTokens.length == 1 && borrowTokens[0] == address(ASSETS), InvalidAsset());
        uint256 amount = HelperLib.balanceOfThis(ASSETS);
        require(amount > 0, NothingToRepay());
        _depositToVault(amount);
        emit Repaid(address(ASSETS), amount);
    }

    function _repayDirect(
        address[] calldata borrowTokens,
        uint256[] calldata maxAmounts
    ) internal override {
        super._repayDirect(borrowTokens, maxAmounts);
        uint256 amount = HelperLib.balanceOfThis(ASSETS);
        if (amount > 0) {
            _depositToVault(amount);
        }
    }

    function _balance(IERC20 token) internal view override returns (uint256) {
        if (token != ASSETS) return 0;
        return MORPHO_VAULT.previewRedeem(HelperLib.balanceOfThis(MORPHO_VAULT)) + HelperLib.balanceOfThis(token);
    }
}
