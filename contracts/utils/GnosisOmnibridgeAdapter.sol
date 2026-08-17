// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IGnosisOmnibridge, IGnosisAMB, IUSDCTransmuter} from ".././interfaces/IGnosisOmnibridge.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

abstract contract GnosisOmnibridgeAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    /// @notice Omnibridge mediator on the local chain (Ethereum or Gnosis Chain).
    IGnosisOmnibridge immutable public OMNIBRIDGE;
    /// @notice On Gnosis it is USDCe token (Circle's Bridged USDC Standard)
    /// Must be swapped to GNOSIS_USDCXDAI before bridging via Omnibridge from Gnosis.
    /// @notice On Ethereum it is USDC token.
    /// Must be bridged to self to swap GNOSIS_USDCXDAI -> USDCe on Gnosis.
    IERC20 immutable public LOCAL_USDC;
    /// @notice USDC token on Gnosis Chain bridged from Ethereum via Omnibridge (USDCxDAI).
    IERC20 immutable public GNOSIS_USDCXDAI;
    /// @notice Swap contract that converts USDCe to USDCxDAI 1:1 on Gnosis Chain.
    IUSDCTransmuter immutable public GNOSIS_USDC_TRANSMUTER;
    /// @notice Ethereum AMB used to finalise Gnosis Chain → Ethereum transfers via executeSignatures.
    IGnosisAMB immutable public ETHEREUM_AMB;

    event GnosisOmnibridgeTransferInitiated(address indexed token, address indexed receiver, uint256 amount);

    error InsufficientBalance();

    constructor(
        Domain localDomain,
        address omnibridge,
        address localUSDC,
        address gnosisUsdcxdai,
        address gnosisUsdcTransmuter,
        address ethereumAmb
    ) {
        if (localDomain == Domain.ETHEREUM) {
            require(localUSDC != address(0), ZeroAddress());
            require(omnibridge != address(0), ZeroAddress());
            require(ethereumAmb != address(0), ZeroAddress());
            ETHEREUM_AMB = IGnosisAMB(ethereumAmb);
        } else
        if (localDomain == Domain.GNOSIS_CHAIN) {
            require(localUSDC != address(0), ZeroAddress());
            require(omnibridge != address(0), ZeroAddress());
            require(gnosisUsdcxdai != address(0), ZeroAddress());
            require(gnosisUsdcTransmuter != address(0), ZeroAddress());
            GNOSIS_USDCXDAI = IERC20(gnosisUsdcxdai);
            GNOSIS_USDC_TRANSMUTER = IUSDCTransmuter(gnosisUsdcTransmuter);
        } else {
            require(omnibridge == address(0), ZeroAddress());
            require(gnosisUsdcxdai == address(0), ZeroAddress());
            require(gnosisUsdcTransmuter == address(0), ZeroAddress());
            require(ethereumAmb == address(0), ZeroAddress());
        }
        LOCAL_USDC = IERC20(localUSDC);
        OMNIBRIDGE = IGnosisOmnibridge(omnibridge);
    }

    /// @notice Bridges ERC20 tokens between Ethereum and Gnosis Chain via the Omnibridge.
    /// Supports both directions:
    ///   - Ethereum → Gnosis Chain: relayTokens on the Ethereum mediator.
    ///   - Gnosis Chain → Ethereum: if token is USDCe, swaps it to USDCxDAI first,
    ///     then relayTokens on the Gnosis Chain mediator.
    function initiateTransferGnosisOmnibridge(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        Domain localDomain
    ) internal notPayable {
        require(address(OMNIBRIDGE) != address(0), ZeroAddress());
        if (localDomain == Domain.ETHEREUM) {
            require(destinationDomain == Domain.GNOSIS_CHAIN, UnsupportedDomain());
            if (address(token) == address(LOCAL_USDC)) {
                // Must bridge USDC to self to swap USDCxDAI on Gnosis through process().
                require(destinationPool == address(this), InvalidDestinationPool());
            }
        } else
        if (localDomain == Domain.GNOSIS_CHAIN) {
            require(destinationDomain == Domain.ETHEREUM, UnsupportedDomain());
            // USDCe cannot be bridged via Omnibridge; swap to USDCxDAI first.
            // Ethereum will receive USDC.
            if (address(token) == address(LOCAL_USDC)) {
                IUSDCTransmuter usdceSwap = GNOSIS_USDC_TRANSMUTER;
                token.forceApprove(address(usdceSwap), amount);
                usdceSwap.withdraw(amount);
                token = GNOSIS_USDCXDAI;
            }
        } else {
            // Unreachable due to constructor check.
            revert UnsupportedDomain();
        }
        token.forceApprove(address(OMNIBRIDGE), amount);
        OMNIBRIDGE.relayTokens(address(token), destinationPool, amount);
        emit GnosisOmnibridgeTransferInitiated(address(token), destinationPool, amount);
    }

    /// @notice Finalises a Gnosis Chain → Ethereum bridge transfer by submitting validator signatures
    /// to the Ethereum AMB. Must be called on Ethereum after the validators have signed the message.
    /// @param destinationPool The pool that will receive the bridged tokens.
    /// @param localDomain The domain of the local chain (Ethereum or Gnosis Chain).
    /// @param extraData ABI-encoded (address token, bytes message, bytes signatures).
    ///   token      - the ERC20 token expected to arrive at destinationPool.
    ///   message    - the bridge message from the Gnosis Chain bridge event.
    ///   signatures - the packed validator signatures collected on Gnosis Chain.
    /// @return token  The token that was received.
    /// @return amount The amount of tokens received by destinationPool.
    function processTransferGnosisOmnibridge(
        address destinationPool,
        Domain localDomain,
        bytes calldata extraData
    ) internal returns (IERC20 token, uint256 amount) {
        if (localDomain == Domain.ETHEREUM) {
            // No swap is needed on Ethereum.
            IGnosisAMB amb = ETHEREUM_AMB;

            bytes memory message;
            bytes memory signatures;
            (token, message, signatures) = abi.decode(extraData, (IERC20, bytes, bytes));

            uint256 balanceBefore = token.balanceOf(destinationPool);
            amb.executeSignatures(message, signatures);
            uint256 balanceAfter = token.balanceOf(destinationPool);

            require(balanceAfter > balanceBefore, ProcessFailed());
            amount = balanceAfter - balanceBefore;
        } else
        if (localDomain == Domain.GNOSIS_CHAIN) {
            // Only needed to process GNOSIS_USDCXDAI -> USDCe that arrive when USDC is sent from Ethereum.
            amount = abi.decode(extraData, (uint256));
            uint256 balance = GNOSIS_USDCXDAI.balanceOf(address(this));
            require(balance >= amount, InsufficientBalance());
            IUSDCTransmuter usdceSwap = GNOSIS_USDC_TRANSMUTER;
            GNOSIS_USDCXDAI.forceApprove(address(usdceSwap), balance);
            usdceSwap.deposit(balance);
            token = LOCAL_USDC;
        } else {
            // Unreachable if domain is correct, due to constructor check.
            revert UnsupportedDomain();
        }
        return (token, amount);
    }
}
