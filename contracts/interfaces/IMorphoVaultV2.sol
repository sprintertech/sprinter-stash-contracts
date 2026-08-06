// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IMorphoVaultV2
/// @notice Minimal interface for a Morpho Vault V2 (https://docs.morpho.org/developers/contracts/morpho-vaults-v2/).
/// deposit/withdraw/redeem/preview* are ABI-compatible with ERC4626 (identical parameter types, only
/// names differ: "onBehalf" instead of "receiver"/"owner"), but Vault V2 is NOT a standard ERC4626:
/// maxDeposit/maxMint/maxWithdraw/maxRedeem always return 0 (the vault uses external gate contracts
/// for access control that cannot be guaranteed revert-free), so this interface deliberately omits
/// them rather than exposing OZ's IERC4626 and risking their use.
interface IMorphoVaultV2 is IERC20 {
    function asset() external view returns (address);

    function balanceOf(address account) external view returns (uint256);

    /// @notice Deposits `assets` of the underlying token, minting shares to `onBehalf`.
    function deposit(uint256 assets, address onBehalf) external returns (uint256 shares);

    /// @notice Withdraws `assets` of the underlying token from the vault's idle liquidity, sending
    /// them to `receiver` and burning shares from `onBehalf`. Reverts if the vault's idle liquidity
    /// cannot cover `assets` (see forceDeallocate for the manual escape hatch).
    function withdraw(uint256 assets, address receiver, address onBehalf) external returns (uint256 shares);

    /// @notice Redeems `shares` for the underlying token, sending assets to `receiver` and burning
    /// shares from `onBehalf`.
    function redeem(uint256 shares, address receiver, address onBehalf) external returns (uint256 assets);

    function previewWithdraw(uint256 assets) external view returns (uint256 shares);

    function previewRedeem(uint256 shares) external view returns (uint256 assets);

    /// @notice Forcibly deallocates `assets` from `adapter` back to the vault's idle pool, burning a
    /// curator-configured penalty (in shares) from `onBehalf`. Permissionless on the vault itself.
    function forceDeallocate(
        address adapter,
        bytes memory data,
        uint256 assets,
        address onBehalf
    ) external returns (uint256 penaltyShares);

    function liquidityAdapter() external view returns (address);
    function liquidityData() external view returns (bytes memory);
}
