// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {CryticERC4626PropertyBase} from "@crytic/properties/contracts/ERC4626/util/ERC4626PropertyTestBase.sol";
import {CryticERC4626VaultProxy} from "@crytic/properties/contracts/ERC4626/properties/VaultProxy.sol";
import {ERC4626LiquidityHubBase} from "./ERC4626LiquidityHubBase.sol";


contract AdditionalPropertiesHub is
    CryticERC4626PropertyBase,
    CryticERC4626VaultProxy,
    ERC4626LiquidityHubBase
{
    error RequireFailed();

    /// @notice Validates the following properties:
    /// - vault.convertToAssets() must not revert for reasonable values
    function verify_convertToAssetsMustNotRevert_hub(uint256 shares) public {
        // arbitrarily define "reasonable values" to be 10**(token.decimals+20)
        uint256 reasonablyLargestValue = 10 ** (shares_.decimals() + 20);

        // prevent scenarios where there is enough totalSupply to trigger overflows
        require(vault.totalSupply() <= reasonablyLargestValue, RequireFailed());
        shares = clampLte(shares, reasonablyLargestValue);

        // exclude the possibility of idiosyncratic reverts. Might have to add more in future.
        shares = clampLte(shares, vault.totalSupply());

        emit LogUint256("totalSupply", vault.totalSupply());
        emit LogUint256("totalAssets", vault.totalAssets());

        try vault.convertToAssets(shares) {
            return;
        } catch {
            assertWithMsg(false, "vault.convertToAssets() must not revert");
        }
    }

    /// @notice verifies `redeem()` must allow proxies to redeem shares
    /// on behalf of the owner using share token approvals
    /// verifies third party `redeem()` calls must update the msg.sender's allowance
    function verify_redeemViaApprovalProxy_hub(
        uint256 receiverId,
        uint256 shares
    ) public returns (uint256 tokensWithdrawn) {
        address owner = address(this);
        address receiver = restrictAddressToThirdParties(receiverId);
        shares = requireValidRedeemAmount(owner, shares);

        shares_.approve(address(redemptionProxy), shares);
        measureAddressHoldings(address(this), "vault", "before redemption");

        measureAddressHoldings(address(vault), "hub", "before redemption");

        try redemptionProxy.redeemOnBehalf(shares, receiver, owner) returns (
            uint256 _tokensWithdrawn
        ) {
            tokensWithdrawn = _tokensWithdrawn;
        } catch {
            assertWithMsg(
                false,
                "vault.redeem() reverted during redeem via approval"
            );
        }

        // verify allowance is updated
        uint256 newAllowance = shares_.allowance(owner, address(redemptionProxy));
        assertEq(
            newAllowance,
            0,
            "The vault failed to update the redemption proxy's share allowance"
        );
    }

    /// @notice verifies `withdraw()` must allow proxies to withdraw shares
    /// on behalf of the owner using share token approvals
    /// verifies third party `withdraw()` calls must update the msg.sender's allowance
    function verify_withdrawViaApprovalProxy_hub(
        uint256 receiverId,
        uint256 tokens
    ) public returns (uint256 sharesBurned) {
        address owner = address(this);
        address receiver = restrictAddressToThirdParties(receiverId);
        tokens = requireValidWithdrawAmount(owner, tokens);

        uint256 expectedSharesConsumed = vault.previewWithdraw(tokens);
        shares_.approve(address(redemptionProxy), expectedSharesConsumed);
        measureAddressHoldings(address(this), "vault", "before withdraw");

        try redemptionProxy.withdrawOnBehalf(tokens, receiver, owner) returns (
            uint256 _sharesBurned
        ) {
            sharesBurned = _sharesBurned;
        } catch {
            assertWithMsg(
                false,
                "vault.withdraw() reverted during withdraw via approval"
            );
        }

        emit LogUint256("withdraw consumed this many shares:", sharesBurned);

        // verify allowance is updated
        uint256 newAllowance = shares_.allowance(owner, address(redemptionProxy));
        uint256 expectedAllowance = expectedSharesConsumed - sharesBurned;
        emit LogUint256("Expecting allowance to now be:", expectedAllowance);
        assertEq(
            expectedAllowance,
            newAllowance,
            "The vault failed to update the redemption proxy's share allowance"
        );
    }

    /// @notice verifies third parties must not be able to `withdraw()` tokens
    /// on an owner's behalf without a token approval
    function verify_withdrawRequiresTokenApproval_hub(
        uint256 receiverId,
        uint256 tokens,
        uint256 sharesApproved
    ) public {
        address owner = address(this);
        address receiver = restrictAddressToThirdParties(receiverId);
        tokens = requireValidWithdrawAmount(owner, tokens);
        uint256 expectedSharesConsumed = vault.previewWithdraw(tokens);
        emit LogUint256(
            "Will attempt to proxy withdraw this many shares:",
            expectedSharesConsumed
        );

        require(sharesApproved < expectedSharesConsumed, RequireFailed());
        emit LogUint256("Approving spend of this many shares:", sharesApproved);
        shares_.approve(address(redemptionProxy), sharesApproved);

        try redemptionProxy.withdrawOnBehalf(tokens, receiver, owner) returns (
            uint256 _sharesBurned
        ) {
            assert(false);
        } catch {
            return;
        }
    }

    /// @notice verifies third parties must not be able to `redeem()` shares 
    /// on an owner's behalf without a token approval
    function verify_redeemRequiresTokenApproval_hub(
        uint256 receiverId,
        uint256 shares,
        uint256 sharesApproved
    ) public {
        address owner = address(this);
        address receiver = restrictAddressToThirdParties(receiverId);
        shares = requireValidRedeemAmount(owner, shares);
        emit LogUint256(
            "Will attempt to proxy redeem this many shares:",
            shares
        );

        require(sharesApproved < shares, RequireFailed());
        emit LogUint256("Approving spend of this many shares:", sharesApproved);
        shares_.approve(address(redemptionProxy), sharesApproved);

        try redemptionProxy.redeemOnBehalf(shares, receiver, owner)
        {
            assert(false);
        } catch {
            assert(true);
        }
    }
}
