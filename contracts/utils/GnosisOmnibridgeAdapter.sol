// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IGnosisOmnibridge, IGnosisAMB, IUSDCTransmuter} from ".././interfaces/IGnosisOmnibridge.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

abstract contract GnosisOmnibridgeAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    /// @notice Omnibridge mediator on the local chain (Ethereum or Gnosis Chain).
    IGnosisOmnibridge immutable public OMNIBRIDGE;
    /// @notice USDCe token (Circle's Bridged USDC Standard) — equal to Repayer ASSETS on Gnosis Chain.
    /// Must be swapped to GNOSIS_USDCXDAI before bridging via Omnibridge.
    IERC20 immutable public GNOSIS_USDCE;
    /// @notice USDC token on Gnosis Chain bridged from Ethereum via Omnibridge (USDCxDAI).
    IERC20 immutable public GNOSIS_USDCXDAI;
    /// @notice Swap contract that converts USDCe to USDCxDAI 1:1 on Gnosis Chain.
    IUSDCTransmuter immutable public GNOSIS_USDC_TRANSMUTER;
    /// @notice Ethereum AMB used to finalise Gnosis Chain → Ethereum transfers via executeSignatures.
    IGnosisAMB immutable public ETHEREUM_AMB;

    event GnosisOmnibridgeTransferInitiated(address indexed token, address indexed receiver, uint256 amount);

    constructor(
        Domain localDomain,
        address omnibridge,
        address gnosisUsdce,
        address gnosisUsdcxdai,
        address gnosisUsdcTransmuter,
        address ethereumAmb
    ) {
        if (localDomain == Domain.ETHEREUM) {
            require(omnibridge != address(0), ZeroAddress());
            require(ethereumAmb != address(0), ZeroAddress());
            ETHEREUM_AMB = IGnosisAMB(ethereumAmb);
        } else if (localDomain == Domain.GNOSIS_CHAIN) {
            require(omnibridge != address(0), ZeroAddress());
            require(gnosisUsdce != address(0), ZeroAddress());
            require(gnosisUsdcxdai != address(0), ZeroAddress());
            require(gnosisUsdcTransmuter != address(0), ZeroAddress());
            GNOSIS_USDCE = IERC20(gnosisUsdce);
            GNOSIS_USDCXDAI = IERC20(gnosisUsdcxdai);
            GNOSIS_USDC_TRANSMUTER = IUSDCTransmuter(gnosisUsdcTransmuter);
        } else {
            require(omnibridge == address(0), ZeroAddress());
            require(gnosisUsdcxdai == address(0), ZeroAddress());
            require(gnosisUsdcTransmuter == address(0), ZeroAddress());
            require(ethereumAmb == address(0), ZeroAddress());
        }
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
        } else if (localDomain == Domain.GNOSIS_CHAIN) {
            require(destinationDomain == Domain.ETHEREUM, UnsupportedDomain());
            // USDCe cannot be bridged via Omnibridge; swap to USDCxDAI first.
            if (address(token) == address(GNOSIS_USDCE)) {
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
    /// @param extraData ABI-encoded (address token, bytes message, bytes signatures).
    ///   token      - the ERC20 token expected to arrive at destinationPool.
    ///   message    - the bridge message from the Gnosis Chain bridge event.
    ///   signatures - the packed validator signatures collected on Gnosis Chain.
    /// @return token  The token that was received.
    /// @return amount The amount of tokens received by destinationPool.
    function processTransferGnosisOmnibridge(
        address destinationPool,
        bytes calldata extraData
    ) internal returns (IERC20 token, uint256 amount) {
        IGnosisAMB amb = ETHEREUM_AMB;
        require(address(amb) != address(0), ZeroAddress());

        address tokenAddress;
        bytes memory message;
        bytes memory signatures;
        (tokenAddress, message, signatures) = abi.decode(extraData, (address, bytes, bytes));
        token = IERC20(tokenAddress);

        uint256 balanceBefore = token.balanceOf(destinationPool);
        amb.executeSignatures(message, signatures);
        uint256 balanceAfter = token.balanceOf(destinationPool);

        require(balanceAfter > balanceBefore, ProcessFailed());
        amount = balanceAfter - balanceBefore;
        return (token, amount);
    }
}
