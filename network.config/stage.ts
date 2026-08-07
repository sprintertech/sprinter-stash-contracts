import * as AAVEPools from "@bgd-labs/aave-address-book";
import {Network, Provider, Token, PartialNetworksConfig, tokenInfo} from "./types";
import {
  LiquidityPoolAaveUSDCV4,
  LiquidityPoolUSDCV4,
  LiquidityPoolUSDCV3,
  LiquidityPoolUSDCStablecoinV4,
  LiquidityPoolAaveUSDCLongTermV3,
  LiquidityPoolAaveUSDCProxy,
  LiquidityPoolPublicUSDCProxy,
  ERC4626AdapterUSDCV2,
  RepayerProxy,
  PYUSDStashDexProcessorProxy,
  USDCStashDexProcessorProxy,
  USDGStashDexProcessorProxy,
  USDTStashDexProcessorProxy,
  SUPPORTS_ONLY_USDC,
  LiquidityPoolUSDTProxy,
  LiquidityPoolAaveUSDTProxy,
} from "./ids";

export const stageNetworkConfig: PartialNetworksConfig = {
  ETHEREUM: {
    ChainId: 1,
    CCTPV2: {
      TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    },
    AcrossV3SpokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
    StargateTreasurer: "0x1041D127b2d4BC700F0F563883bC689502606918",
    OptimismStandardBridge: "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1",
    BaseStandardBridge: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35",
    ArbitrumGatewayRouter: "0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef",
    PolygonPosRootChainManager: "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77",
    Omnibridge: "0x88ad09518695c6c3712AC10a214bE5109a655671",
    GnosisAMB: "0x4C36d2919e407f0Cc2Ee3c993ccF8ac26d9CE64e",
    USDT0OFT: "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee",
    Tokens: {
      USDC: tokenInfo("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
      USDT: tokenInfo("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
      DAI: tokenInfo("0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
      WETH: tokenInfo("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
      WBTC: tokenInfo("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8),
      USDG: tokenInfo("0xe343167631d89B6Ffc58B88d6b7fB0228795491D", 6),
      PYUSD: tokenInfo("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", 6),
      EURe: tokenInfo("0x39b8B6385416f4cA36a20319F70D28621895279D", 18),
    },
    WrappedNativeToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.ARBITRUM_GATEWAY,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
          ],
          [Network.BASE]: [
            Provider.ACROSS,
            Provider.SUPERCHAIN_STANDARD_BRIDGE,
            Provider.STARGATE,
            Provider.CCTP_V2,
          ],
          [Network.OP_MAINNET]: [
            Provider.ACROSS,
            Provider.SUPERCHAIN_STANDARD_BRIDGE,
            Provider.CCTP_V2,
          ],
          [Network.POLYGON_MAINNET]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
            Provider.POLYGON_POS_BRIDGE,
          ],
          [Network.GNOSIS_CHAIN]: [
            Provider.GNOSIS_OMNIBRIDGE,
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolUSDCV3]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.BASE]: [
            Provider.ACROSS,
            Provider.SUPERCHAIN_STANDARD_BRIDGE,
            Provider.CCTP_V2,
          ],
        },
      },
      [LiquidityPoolUSDCV4]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.ARBITRUM_GATEWAY,
            Provider.CCTP_V2,
          ],
          [Network.BASE]: [
            Provider.ACROSS,
            Provider.SUPERCHAIN_STANDARD_BRIDGE,
            Provider.CCTP_V2,
          ],
          [Network.OP_MAINNET]: [
            Provider.ACROSS,
            Provider.SUPERCHAIN_STANDARD_BRIDGE,
            Provider.CCTP_V2,
          ],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.ARBITRUM_GATEWAY,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
          ],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        Domains: {
          [Network.UNICHAIN]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
          ],
        },
      },
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.GNOSIS_CHAIN]: [
            Provider.GNOSIS_OMNIBRIDGE,
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDTProxy]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.USDT0,
          ],
        },
      },
      [LiquidityPoolUSDTProxy]: {
        OnlySupportedToken: Token.USDT,
        Domains: {
          [Network.TEMPO]: [
            Provider.USDT0,
          ],
          [Network.STABLE]: [
            Provider.USDT0,
          ],
        },
      },
    },
    StashDex: {
      Oracle: "PaxosOracle",
      Receiver: RepayerProxy,
      ConfigAdmin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
      Forwarder: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
      Pools: {
        USDC: LiquidityPoolAaveUSDCProxy,
        PYUSD: LiquidityPoolAaveUSDCProxy,
        USDG: LiquidityPoolAaveUSDCProxy,
        USDT: LiquidityPoolAaveUSDCProxy,
      },
      Routes: [
        {
          TokenIn: Token.USDC,
          TokenOut: Token.PYUSD,
          FeeBps: 3,
          Processor: PYUSDStashDexProcessorProxy,
        },
        {
          TokenIn: Token.PYUSD,
          TokenOut: Token.USDC,
          FeeBps: 3,
          Processor: USDCStashDexProcessorProxy,
        },
        {
          TokenIn: Token.USDC,
          TokenOut: Token.USDG,
          FeeBps: 3,
          Processor: USDGStashDexProcessorProxy,
        },
        {
          TokenIn: Token.USDG,
          TokenOut: Token.USDC,
          FeeBps: 3,
          Processor: USDCStashDexProcessorProxy,
        },
        {
          TokenIn: Token.USDG,
          TokenOut: Token.PYUSD,
          FeeBps: 3,
          Processor: PYUSDStashDexProcessorProxy,
        },
        {
          TokenIn: Token.PYUSD,
          TokenOut: Token.USDG,
          FeeBps: 3,
          Processor: USDGStashDexProcessorProxy,
        },
        {
          TokenIn: Token.USDC,
          TokenOut: Token.USDT,
          FeeBps: 3,
          Processor: USDTStashDexProcessorProxy,
        },
        {
          TokenIn: Token.USDT,
          TokenOut: Token.USDC,
          FeeBps: 3,
          Processor: USDCStashDexProcessorProxy,
        },
        {
          TokenIn: Token.USDG,
          TokenOut: Token.USDT,
          FeeBps: 3,
          Processor: USDTStashDexProcessorProxy,
        },
        {
          TokenIn: Token.USDT,
          TokenOut: Token.USDG,
          FeeBps: 3,
          Processor: USDGStashDexProcessorProxy,
        },
        {
          TokenIn: Token.PYUSD,
          TokenOut: Token.USDT,
          FeeBps: 3,
          Processor: USDTStashDexProcessorProxy,
        },
        {
          TokenIn: Token.USDT,
          TokenOut: Token.PYUSD,
          FeeBps: 3,
          Processor: PYUSDStashDexProcessorProxy,
        },
      ],
    },
    MainAssets: {
      [Token.USDC]: {
        RebalancerRoutes: {
          [LiquidityPoolAaveUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.POLYGON_MAINNET]: [Provider.CCTP_V2],
            [Network.GNOSIS_CHAIN]: [Provider.GNOSIS_OMNIBRIDGE],
          },
          [LiquidityPoolUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCLongTermV3]: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [ERC4626AdapterUSDCV2]: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCStablecoinV4]: {
            [Network.UNICHAIN]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCProxy]: {
            [Network.GNOSIS_CHAIN]: [Provider.GNOSIS_OMNIBRIDGE],
          },
        },
        AavePool: {
          AaveAddressesProvider: AAVEPools.AaveV3Ethereum.POOL_ADDRESSES_PROVIDER,
          MinHealthFactor: 150,
          DefaultLTV: 0,
          TokenLTVs: {
            "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": 100, // WBTC
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": 100, // WETH
            "0x6b175474e89094c44da98b954eedeac495271d0f": 100, // DAI
            "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8": 100, // PYUSD
            "0xe343167631d89B6Ffc58B88d6b7fB0228795491D": 100, // USDG
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 100, // USDC
            "0xdAC17F958D2ee523a2206206994597C13D831ec7": 100, // USDT
          },
        },
        BasicPool: true,
      },
    },
  },
  OP_MAINNET: {
    ChainId: 10,
    CCTPV2: {
      TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    },
    AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
    StargateTreasurer: "0x644abb1e17291b4403966119d15Ab081e4a487e9",
    Tokens: {
      USDC: tokenInfo("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6),
      USDT: tokenInfo("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", 6),
      DAI: tokenInfo("0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18),
      WETH: tokenInfo("0x4200000000000000000000000000000000000006", 18),
      WBTC: tokenInfo("0x68f180fcCe6836688e9084f035309E29Bf0A2095", 8),
    },
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
          [Network.BASE]: [Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2],
          [Network.POLYGON_MAINNET]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.CCTP_V2,
          ],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolUSDCV3]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.BASE]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolUSDCV4]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.BASE]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        Domains: {
          [Network.UNICHAIN]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
        },
      },
    },
    MainAssets: {
      [Token.USDC]: {
        RebalancerRoutes: {
          [LiquidityPoolAaveUSDCProxy]: {
            [Network.ETHEREUM]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
            [Network.POLYGON_MAINNET]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
            [Network.ETHEREUM]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCLongTermV3]: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [ERC4626AdapterUSDCV2]: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCStablecoinV4]: {
            [Network.UNICHAIN]: [Provider.CCTP_V2],
          },
        },
        AavePool: {
          AaveAddressesProvider: AAVEPools.AaveV3Optimism.POOL_ADDRESSES_PROVIDER,
          MinHealthFactor: 300,
          DefaultLTV: 50,
          TokenLTVs: {
            "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb": 50, // wstETH
            "0x4200000000000000000000000000000000000006": 50, // WETH
            "0x0b2c639c533813f4aa9d7837caf62653d097ff85": 100, // USDC
            "0x68f180fcce6836688e9084f035309e29bf0a2095": 50, // WBTC
            "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": 80, // USDT
            "0x4200000000000000000000000000000000000042": 50, // OP
            "0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9": 50, // sUSD
            "0x9bcef72be871e61ed4fbbc7630889bee758eb81d": 50, // rETH
            "0x7f5c764cbc14f9669b88837ca1490cca17c31607": 80, // USDC.e
            "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": 80, // DAI
            "0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6": 50, // LINK
            "0xc40f949f8a4e094d1b49a23ea9241d289b7b2819": 50, // LUSD
          },
        },
        BasicPool: true,
      },
    },
  },
  ARBITRUM_ONE: {
    ChainId: 42161,
    CCTPV2: {
      TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    },
    AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
    StargateTreasurer: "0x146c8e409C113ED87C6183f4d25c50251DFfbb3a",
    USDT0OFT: "0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92",
    Tokens: {
      USDC: tokenInfo("0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6),
      USDT: tokenInfo("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6),
      DAI: tokenInfo("0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18),
      WETH: tokenInfo("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18),
      WBTC: tokenInfo("0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", 8),
      EURe: tokenInfo("0x0c06cCF38114ddfc35e07427B9424adcca9F44F8", 18),
    },
    WrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.OP_MAINNET]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
          [Network.BASE]: [Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2],
          [Network.POLYGON_MAINNET]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
          ],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolUSDCV3]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.BASE]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolUSDCV4]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.BASE]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        Domains: {
          [Network.UNICHAIN]: [
            Provider.ACROSS, Provider.STARGATE, Provider.USDT0, Provider.CCTP_V2
          ],
        },
      },
      [LiquidityPoolUSDTProxy]: {
        OnlySupportedToken: Token.USDT,
        Domains: {
          [Network.TEMPO]: [
            Provider.USDT0,
          ],
          [Network.STABLE]: [
            Provider.USDT0,
          ],
        },
      },
    },
    MainAssets: {
      [Token.USDC]: {
        RebalancerRoutes: {
          [LiquidityPoolAaveUSDCProxy]: {
            [Network.ETHEREUM]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.POLYGON_MAINNET]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.ETHEREUM]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCStablecoinV4]: {
            [Network.UNICHAIN]: [Provider.CCTP_V2],
          },
        },
        AavePool: {
          AaveAddressesProvider: AAVEPools.AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
          MinHealthFactor: 300,
          DefaultLTV: 50,
          TokenLTVs: {
            "0xaf88d065e77c8cc2239327c5edb3a432268e5831": 100, // USDC
            "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": 50, // WETH
            "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": 50, // WBTC
            "0x35751007a407ca6feffe80b3cb397736d2cf4dbe": 50, // weETH
            "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": 80, // USDT0
            "0x5979d7b546e38e414f7e9822514be443a4800529": 50, // wstETH
            "0xf97f4df75117a78c1a5a0dbb814af92458539fb4": 50, // LINK
            "0x912ce59144191c1204e64559fe8253a0e49e6548": 50, // ARB
            "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": 80, // DAI
            "0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8": 30, // rETH
            "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": 80, // USDC.e
            "0x7dff72693f6a4149b17e7c6314655f6a9f7c8b33": 20, // GHO
            "0x93b346b6bc2548da6a1e7d98e9a421b42541425b": 50, // LUSD
            "0x17fc002b466eec40dae837fc4be5c67993ddbd6f": 20, // FRAX
          },
        },
        AavePoolLongTerm: {
          AaveAddressesProvider: AAVEPools.AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
          MinHealthFactor: 150,
          DefaultLTV: 0,
          TokenLTVs: {
            "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": 100, // WBTC
          },
          BorrowLongTermAdmin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
          RepayCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
        },
        BasicPool: true,
        PublicPool: {
          Name: "Sprinter-Lighter Fast Withdrawal Pool",
          Symbol: "SLFWP",
          ProtocolFeeRate: 20,
          FeeSetter: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
        },
        ERC4626AdapterTargetVault: LiquidityPoolPublicUSDCProxy,
      },
      [Token.USDT]: {
        Hub: {
          AssetsAdjuster: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
          DepositProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
          AssetsLimitSetter: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
          AssetsLimit: 10_000_000,
          Pool: LiquidityPoolAaveUSDTProxy,
        },
        RebalancerRoutes: {
          [LiquidityPoolUSDTProxy]: {
            [Network.TEMPO]: [Provider.USDT0],
            [Network.STABLE]: [Provider.USDT0],
          },
        },
        AavePool: {
          AaveAddressesProvider: AAVEPools.AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
          MinHealthFactor: 150,
          DefaultLTV: 0,
          TokenLTVs: {
            "0xaf88d065e77c8cc2239327c5edb3a432268e5831": 100, // USDC
            "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": 75, // WETH
            "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": 75, // WBTC
            "0x35751007a407ca6feffe80b3cb397736d2cf4dbe": 0, // weETH
            "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": 90, // USDT0
            "0x5979d7b546e38e414f7e9822514be443a4800529": 0, // wstETH
            "0xf97f4df75117a78c1a5a0dbb814af92458539fb4": 0, // LINK
            "0x912ce59144191c1204e64559fe8253a0e49e6548": 0, // ARB
            "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": 90, // DAI
            "0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8": 0, // rETH
            "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": 0, // USDC.e
            "0x7dff72693f6a4149b17e7c6314655f6a9f7c8b33": 0, // GHO
            "0x93b346b6bc2548da6a1e7d98e9a421b42541425b": 0, // LUSD
            "0x17fc002b466eec40dae837fc4be5c67993ddbd6f": 0, // FRAX
          },
        },
      },
    },
  },
  BASE: {
    ChainId: 8453,
    CCTPV2: {
      TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    },
    AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
    StargateTreasurer: "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
    Tokens: {
      USDC: tokenInfo("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
      USDT: tokenInfo("0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", 6),
      DAI: tokenInfo("0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", 18),
      WETH: tokenInfo("0x4200000000000000000000000000000000000006", 18),
      EURe: tokenInfo("0xbf6e2966A9C3D99C9E4D069E04f7Bdb9C8aa762C", 18),
    },
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.OP_MAINNET]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
          [Network.POLYGON_MAINNET]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.CCTP_V2,
          ],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolUSDCV4]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        Domains: {
          [Network.UNICHAIN]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
        },
      },
    },
    MainAssets: {
      [Token.USDC]: {
        Hub: {
          AssetsAdjuster: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
          DepositProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
          AssetsLimitSetter: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
          AssetsLimit: 10_000_000,
          Tiers: [
            {period: 7776000n, multiplier: 400000000n},
            {period: 15552000n, multiplier: 1000000000n},
            {period: 31104000n, multiplier: 2200000000n},
          ],
          Pool: LiquidityPoolAaveUSDCV4,
        },
        RebalancerRoutes: {
          [LiquidityPoolAaveUSDCProxy]: {
            [Network.ETHEREUM]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCV4]: {
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
            [Network.POLYGON_MAINNET]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCV4]: {
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
            [Network.ETHEREUM]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCLongTermV3]: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [ERC4626AdapterUSDCV2]: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCStablecoinV4]: {
            [Network.UNICHAIN]: [Provider.CCTP_V2],
          },
        },
        AavePool: {
          AaveAddressesProvider: AAVEPools.AaveV3Base.POOL_ADDRESSES_PROVIDER,
          MinHealthFactor: 300,
          DefaultLTV: 50,
          TokenLTVs: {
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 100, // USDC
            "0x4200000000000000000000000000000000000006": 50, // WETH
            "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": 50, // cbBTC
            "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": 50, // weETH
            "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": 50, // wstETH
            "0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee": 20, // GHO
            "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": 50, // cbETH
            "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": 80, // USDbC
            "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": 20, // EURC
          },
        },
        BasicPool: true,
        ActiveLegacyPools: {
          [LiquidityPoolUSDCV3]: SUPPORTS_ONLY_USDC,
        },
      },
    },
  },
  POLYGON_MAINNET: {
    ChainId: 137,
    CCTPV2: {
      TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    },
    AcrossV3SpokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
    StargateTreasurer: "0x36ed193dc7160D3858EC250e69D12B03Ca087D08",
    USDT0OFT: "0x6BA10300f0DC58B7a1e4c0e41f5daBb7D7829e13",
    Tokens: {
      USDC: tokenInfo("0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", 6),
      USDT: tokenInfo("0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6),
      DAI: tokenInfo("0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", 18),
      WETH: tokenInfo("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", 18),
      WBTC: tokenInfo("0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", 8),
      EURe: tokenInfo("0xE0aEa583266584DafBB3f9C3211d5588c73fEa8d", 18),
    },
    WrappedNativeToken: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.OP_MAINNET]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
          [Network.BASE]: [Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2],
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
          ],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
          ],
        },
      },
      [LiquidityPoolUSDCV3]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.BASE]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolUSDCV4]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.BASE]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        Domains: {
          [Network.UNICHAIN]: [
            Provider.CCTP_V2, Provider.ACROSS, Provider.STARGATE, Provider.USDT0
          ],
        },
      },
      [LiquidityPoolAaveUSDTProxy]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.USDT0,
          ],
        },
      },
      [LiquidityPoolUSDTProxy]: {
        OnlySupportedToken: Token.USDT,
        Domains: {
          [Network.TEMPO]: [
            Provider.USDT0,
          ],
          [Network.STABLE]: [
            Provider.USDT0,
          ],
        },
      },
    },
    MainAssets: {
      [Token.USDC]: {
        RebalancerRoutes: {
          [LiquidityPoolAaveUSDCProxy]: {
            [Network.ETHEREUM]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCLongTermV3]: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.ETHEREUM]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCStablecoinV4]: {
            [Network.UNICHAIN]: [Provider.CCTP_V2],
          },
        },
        AavePool: {
          AaveAddressesProvider: AAVEPools.AaveV3Polygon.POOL_ADDRESSES_PROVIDER,
          MinHealthFactor: 150,
          DefaultLTV: 0,
          TokenLTVs: {
            "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063": 90, // DAI
            "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 100, // USDC
            "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6": 75, // WBTC
            "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619": 75, // WETH
            "0xc2132D05D31c914a87C6611C10748AEb04B58e8F": 90, // USDT0
          },
        },
      },
    },
  },
  UNICHAIN: {
    ChainId: 130,
    CCTPV2: {
      TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    },
    AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
    StargateTreasurer: "0x6D205337F45D6850c3c3006e28d5b52c8a432c35",
    USDT0OFT: "0xc07bE8994D035631c36fb4a89C918CeFB2f03EC3",
    Tokens: {
      USDC: tokenInfo("0x078D782b760474a361dDA0AF3839290b0EF57AD6", 6),
      USDT: tokenInfo("0x9151434b16b9763660705744891fA906F660EcC5", 6),
      WETH: tokenInfo("0x4200000000000000000000000000000000000006", 18),
    },
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.OP_MAINNET]: [
            Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2
          ],
          [Network.BASE]: [Provider.ACROSS, Provider.STARGATE, Provider.CCTP_V2],
          [Network.POLYGON_MAINNET]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
          ],
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2,
          ],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
        [LiquidityPoolAaveUSDTProxy]: {
          Domains: {
            [Network.ARBITRUM_ONE]: [
              Provider.USDT0,
            ],
          },
        },
        [LiquidityPoolUSDTProxy]: {
          OnlySupportedToken: Token.USDT,
          Domains: {
            [Network.TEMPO]: [
              Provider.USDT0,
            ],
            [Network.STABLE]: [
              Provider.USDT0,
            ],
          },
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.STARGATE,
            Provider.USDT0,
            Provider.CCTP_V2
          ],
        },
      },
      [LiquidityPoolUSDCV3]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.BASE]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
      [LiquidityPoolUSDCV4]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.BASE]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.CCTP_V2],
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.CCTP_V2],
        },
      },
    },
    MainAssets: {
      [Token.USDC]: {
        RebalancerRoutes: {
          [LiquidityPoolAaveUSDCProxy]: {
            [Network.ETHEREUM]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.POLYGON_MAINNET]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [LiquidityPoolAaveUSDCLongTermV3]: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
          [LiquidityPoolUSDCV4]: {
            [Network.BASE]: [Provider.CCTP_V2],
            [Network.OP_MAINNET]: [Provider.CCTP_V2],
            [Network.ETHEREUM]: [Provider.CCTP_V2],
            [Network.ARBITRUM_ONE]: [Provider.CCTP_V2],
          },
        },
        StablecoinPool: true,
      },
    },
  },
  BSC: {
    ChainId: 56,
    AcrossV3SpokePool: "0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
    StargateTreasurer: "0x0a6A15964fEe494A881338D65940430797F0d97C",
    Tokens: {
      USDC: tokenInfo("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18),
      WBTC: tokenInfo("0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", 18),
      WETH: tokenInfo("0x2170Ed0880ac9A755fd29B2688956BD959F933F8", 18),
      USDT: tokenInfo("0x55d398326f99059fF775485246999027B3197955", 18),
    },
    WrappedNativeToken: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.STARGATE],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.STARGATE],
          [Network.BASE]: [Provider.ACROSS, Provider.STARGATE],
          [Network.POLYGON_MAINNET]: [
            Provider.ACROSS,
            Provider.STARGATE,
          ],
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.STARGATE,
          ],
          [Network.GNOSIS_CHAIN]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.ACROSS,
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolUSDCV3]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.BASE]: [Provider.ACROSS],
        },
      },
      [LiquidityPoolUSDCV4]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.OP_MAINNET]: [Provider.ACROSS],
          [Network.BASE]: [Provider.ACROSS],
          [Network.ETHEREUM]: [Provider.ACROSS],
          [Network.ARBITRUM_ONE]: [Provider.ACROSS],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        Domains: {
          [Network.UNICHAIN]: [Provider.ACROSS, Provider.STARGATE],
        },
      },
    },
    MainAssets: {},
  },
  GNOSIS_CHAIN: {
    ChainId: 100,
    StargateTreasurer: "0xF1815bd50389c46847f0Bda824eC8da914045D14",
    Omnibridge: "0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d",
    // USDC bridged from Ethereum via Omnibridge — must bridge this token back via Omnibridge
    GnosisUSDCxDAI: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83",
    GnosisUSDCTransmuter: "0x0392A2F5Ac47388945D8c84212469F545fAE52B2",
    Tokens: {
      // Circle's Bridged USDC Standard (USDC.e) — primary USDC on Gnosis Chain
      USDC: tokenInfo("0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0", 6),
      USDT: tokenInfo("0x4ECaBa5870353805a9F068101A40E0f32ed605C6", 6),
      WETH: tokenInfo("0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", 18),
      DAI: tokenInfo("0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", 18),
      EURe: tokenInfo("0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430", 18), // EURe v2
    },
    WrappedNativeToken: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.STARGATE, Provider.GNOSIS_OMNIBRIDGE],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.OP_MAINNET]: [Provider.STARGATE],
          [Network.BASE]: [Provider.STARGATE],
          [Network.POLYGON_MAINNET]: [
            Provider.STARGATE,
          ],
          [Network.ARBITRUM_ONE]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.STARGATE,
          ],
        },
      },
      [LiquidityPoolUSDCV3]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.BASE]: [Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        OnlySupportedToken: Token.USDC,
        Domains: {
          [Network.OP_MAINNET]: [Provider.STARGATE],
          [Network.BASE]: [Provider.STARGATE],
          [Network.ETHEREUM]: [Provider.STARGATE, Provider.GNOSIS_OMNIBRIDGE],
          [Network.ARBITRUM_ONE]: [Provider.STARGATE],
        },
      },
    },
    MainAssets: {
      [Token.USDC]: {
        RebalancerRoutes: {
          [LiquidityPoolUSDCV4]: {
            [Network.ETHEREUM]: [Provider.GNOSIS_OMNIBRIDGE],
          },
        },
        AavePool: {
          AaveAddressesProvider: AAVEPools.AaveV3Gnosis.POOL_ADDRESSES_PROVIDER,
          MinHealthFactor: 150,
          DefaultLTV: 0,
          TokenLTVs: {
            "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d": 90, // DAI
            "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0": 100, // USDC
            "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1": 75, // WETH
            "0x4ECaBa5870353805a9F068101A40E0f32ed605C6": 90, // USDT
            "0xcB444e90D8198415266c6a2724b7900fb12FC56E": 100, // EURe v1
          },
        },
      },
    },
  },
  TEMPO: {
    ChainId: 4217,
    USDT0OFT: "0xaf37E8B6C9ED7f6318979f56Fc287d76c30847ff",
    // Tempo has no native currency (CALLVALUE always returns 0), so its USDT0 OFT requires
    // LayerZero fees to be paid in this ERC-20 token instead (confirmed via oft.nativeToken()).
    USDT0FeeNativeToken: "0x0cEb237E109eE22374a567c6b09F373C73FA4cBb",
    Tokens: {
      USDC: tokenInfo("0x20C000000000000000000000b9537d11c60E8b50", 6),
      USDT: tokenInfo("0x20C00000000000000000000014f22CA97301EB73", 6),
    },
    WrappedNativeToken: "0x0000000000000000000000000000000000000000",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.USDT0],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.POLYGON_MAINNET]: [Provider.USDT0],
        },
      },
      [LiquidityPoolAaveUSDTProxy]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.USDT0,
          ],
        },
      },
      [LiquidityPoolUSDTProxy]: {
        OnlySupportedToken: Token.USDT,
        Domains: {
          [Network.STABLE]: [
            Provider.USDT0,
          ],
        },
      },
    },
    MainAssets: {
      [Token.USDT]: {
        RebalancerRoutes: {
          [LiquidityPoolAaveUSDTProxy]: {
            [Network.ARBITRUM_ONE]: [Provider.USDT0],
          },
          [LiquidityPoolUSDTProxy]: {
            [Network.STABLE]: [Provider.USDT0],
          },
        },
        BasicPool: true,
      },
    },
  },
  STABLE: {
    ChainId: 988,
    USDT0OFT: "0xedaba024be4d87974d5aB11C6Dd586963CcCB027",
    Tokens: {
      USDC: tokenInfo("0x8a2B28364102Bea189D99A475C494330Ef2bDD0B", 6),
      USDT: tokenInfo("0x779Ded0c9e1022225f8E0630b35a9b54bE713736", 6),
    },
    WrappedNativeToken: "0x0000000000000000000000000000000000000000",
    Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    WithdrawProfit: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    Pauser: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RebalanceCaller: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
    SetInputOutputTokens: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCProxy]: {
        Domains: {
          [Network.ETHEREUM]: [Provider.USDT0],
        },
      },
      [LiquidityPoolAaveUSDCV4]: {
        Domains: {
          [Network.POLYGON_MAINNET]: [Provider.USDT0],
        },
      },
      [LiquidityPoolAaveUSDTProxy]: {
        Domains: {
          [Network.ARBITRUM_ONE]: [
            Provider.USDT0,
          ],
        },
      },
      [LiquidityPoolUSDTProxy]: {
        OnlySupportedToken: Token.USDT,
        Domains: {
          [Network.TEMPO]: [
            Provider.USDT0,
          ],
        },
      },
    },
    MainAssets: {
      [Token.USDT]: {
        RebalancerRoutes: {
          [LiquidityPoolAaveUSDTProxy]: {
            [Network.ARBITRUM_ONE]: [Provider.USDT0],
          },
          [LiquidityPoolUSDTProxy]: {
            [Network.TEMPO]: [Provider.USDT0],
          },
        },
        BasicPool: true,
      },
    },
  },
};
