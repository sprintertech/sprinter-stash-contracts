import * as AAVEPools from "@bgd-labs/aave-address-book";

// Upgradeable contracts proxies are deployed once with the contract name suffix in id.
// Subsequent implementation just use UPGRADE_ID env variable.
// Immutable contracts are deployed first with the name-derived unique id.
// Subsequent versions use version suffix plus a git commit from the main branch.
export const LiquidityPoolAaveUSDC: string = "LiquidityPoolAaveUSDC";
export const LiquidityPoolUSDC: string = "LiquidityPoolUSDC";
export const LiquidityPoolUSDCStablecoin: string = "LiquidityPoolUSDCStablecoin";
export const LiquidityPoolAaveUSDCV2: string = "LiquidityPoolAaveUSDC-V2-c7d251b";

export enum Network {
  ETHEREUM = "ETHEREUM",
  AVALANCHE = "AVALANCHE",
  OP_MAINNET = "OP_MAINNET",
  ARBITRUM_ONE = "ARBITRUM_ONE",
  BASE = "BASE",
  POLYGON_MAINNET = "POLYGON_MAINNET",
  ETHEREUM_SEPOLIA = "ETHEREUM_SEPOLIA",
  AVALANCHE_FUJI = "AVALANCHE_FUJI",
  OP_SEPOLIA = "OP_SEPOLIA",
  ARBITRUM_SEPOLIA = "ARBITRUM_SEPOLIA",
  BASE_SEPOLIA = "BASE_SEPOLIA",
  POLYGON_AMOY = "POLYGON_AMOY",
};

export enum Provider {
  LOCAL = "LOCAL",
  CCTP = "CCTP",
  ACROSS = "ACROSS",
  EVERCLEAR = "EVERCLEAR",
  STARGATE = "STARGATE",
  OPTIMISM_STANDARD_BRIDGE = "OPTIMISM_STANDARD_BRIDGE",
};

interface CCTPConfig {
  TokenMessenger: string;
  MessageTransmitter: string;
};

export interface RebalancerRoutesConfig {
  Pools: string[];
  Domains: Network[];
  Providers: Provider[];
};

export interface RepayerRoutesConfig {
  Pools: string[];
  Domains: Network[];
  Providers: Provider[];
  SupportsAllTokens: boolean[];
};

interface TokenLtvConfig {
  Tokens: string[];
  LTVs: number[];
};

interface AavePoolConfig {
  AaveAddressesProvider: string;
  minHealthFactor: number; // Value 500 will result in health factor 5.
  defaultLTV: number; // Value 20 will result in LTV 20%.
  tokenLTVs?: TokenLtvConfig;
};

// Liquidity mining tiers.
// Period is in seconds.
// Multiplier will be divided by 1000,000,000. So 1750000000 will result in 1.75x.
// There is no limit to the number of tiers, but has to be at least one.
interface Tier {
  period: bigint;
  multiplier: bigint;
};

interface HubConfig {
  AssetsAdjuster: string; // Address that can increase/decrease LP conversion rate.
  DepositProfit: string; // Address that can deposit profit to the Liquidity Pool via Liquidity Hub.
  AssetsLimitSetter: string; // Address that can set assets limit.
  AssetsLimit: number; // Deposits to Liquidity Hub are only allowed till this limit is reached.
  Tiers: Tier[];
};

export interface NetworkConfig {
  chainId: number;
  CCTP: CCTPConfig;
  AcrossV3SpokePool?: string;
  StargateTreasurer?: string;
  EverclearFeeAdapter?: string;
  OptimismStandardBridge?: string;
  USDC: string;
  WrappedNativeToken: string;
  RebalancerRoutes?: RebalancerRoutesConfig;
  RepayerRoutes?: RepayerRoutesConfig;
  IsTest: boolean;
  Admin: string; // Every contracts admin/owner.
  WithdrawProfit: string;
  Pauser: string;
  RebalanceCaller: string; // Address that can trigger funds movement between pools.
  RepayerCaller: string;
  MpcAddress: string;
  Hub?: HubConfig;
  AavePool?: AavePoolConfig;
  USDCPool?: boolean;
  USDCStablecoinPool?: boolean;
  Stage?: NetworkConfig;
};

type NetworksConfig = {
  [key in Network]: NetworkConfig;
};

export const networkConfig: NetworksConfig = {
  ETHEREUM: {
    chainId: 1,
    CCTP: {
      TokenMessenger: "0xbd3fa81b58ba92a82136038b25adec7066af3155",
      MessageTransmitter: "0x0a992d191deec32afe36203ad87d7d289a738f81",
    },
    AcrossV3SpokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
    StargateTreasurer: "0x1041D127b2d4BC700F0F563883bC689502606918",
    EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
    OptimismStandardBridge: "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WrappedNativeToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Ethereum.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 300,
      defaultLTV: 0,
    },
  },
  AVALANCHE: {
    chainId: 43114,
    CCTP: {
      TokenMessenger: "0x6b25532e1060ce10cc3b0a99e5683b91bfde6982",
      MessageTransmitter: "0x8186359af5f57fbb40c6b14a588d2a59c0c29880",
    },
    StargateTreasurer: "0xC2b638Cb5042c1B3c5d5C969361fB50569840583",
    EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
    USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    WrappedNativeToken: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Avalanche.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 300,
      defaultLTV: 0,
    },
  },
  OP_MAINNET: {
    chainId: 10,
    CCTP: {
      TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
      MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
    },
    AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
    StargateTreasurer: "0x644abb1e17291b4403966119d15Ab081e4a487e9",
    EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
    OptimismStandardBridge: "0x4200000000000000000000000000000000000010",
    USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    RebalancerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE, Network.ARBITRUM_ONE, Network.BASE, Network.ARBITRUM_ONE],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
    },
    RepayerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE, Network.ARBITRUM_ONE, Network.BASE, Network.ARBITRUM_ONE],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      SupportsAllTokens: [true, true, false, false],
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Optimism.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 300,
      defaultLTV: 0,
      tokenLTVs: {
        Tokens: [
          "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb", // wstETH
          "0x4200000000000000000000000000000000000006", // WETH
          "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // USDC
          "0x68f180fcce6836688e9084f035309e29bf0a2095", // WBTC
          "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", // USDT
          "0x4200000000000000000000000000000000000042", // OP
          "0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9", // sUSD
          "0x9bcef72be871e61ed4fbbc7630889bee758eb81d", // rETH
          "0x7f5c764cbc14f9669b88837ca1490cca17c31607", // USDC.e
          "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
          "0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6", // LINK
          "0xc40f949f8a4e094d1b49a23ea9241d289b7b2819", // LUSD
        ],
        LTVs: [
          50,
          50,
          100,
          50,
          80,
          50,
          50,
          50,
          80,
          80,
          50,
          50,
        ],
      },
    },
    USDCPool: true,
    Stage: {
      chainId: 10,
      CCTP: {
        TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
        MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
      },
      AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
      StargateTreasurer: "0x644abb1e17291b4403966119d15Ab081e4a487e9",
      EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
      USDC: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      WithdrawProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      Pauser: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalanceCaller: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCaller: "0xECf983dD6Ecd4245fBAAF608594033AB0660D225",
      MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
      RebalancerRoutes: {
        Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
        Domains: [Network.BASE, Network.ARBITRUM_ONE, Network.BASE, Network.ARBITRUM_ONE],
        Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      },
      RepayerRoutes: {
        Pools: [
          LiquidityPoolAaveUSDC,
          LiquidityPoolAaveUSDC,
          LiquidityPoolUSDC,
          LiquidityPoolUSDC,
          LiquidityPoolAaveUSDC,
          LiquidityPoolAaveUSDC
        ],
        Domains: [
          Network.BASE,
          Network.ARBITRUM_ONE,
          Network.BASE,
          Network.ARBITRUM_ONE,
          Network.BASE,
          Network.ARBITRUM_ONE
        ],
        Providers: [
          Provider.EVERCLEAR,
          Provider.EVERCLEAR,
          Provider.CCTP,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.ACROSS
        ],
        SupportsAllTokens: [true, true, false, false, true, true],
      },
      AavePool: {
        AaveAddressesProvider: AAVEPools.AaveV3Optimism.POOL_ADDRESSES_PROVIDER,
        minHealthFactor: 300,
        defaultLTV: 0,
        tokenLTVs: {
          Tokens: [
            "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb", // wstETH
            "0x4200000000000000000000000000000000000006", // WETH
            "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // USDC
            "0x68f180fcce6836688e9084f035309e29bf0a2095", // WBTC
            "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", // USDT
            "0x4200000000000000000000000000000000000042", // OP
            "0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9", // sUSD
            "0x9bcef72be871e61ed4fbbc7630889bee758eb81d", // rETH
            "0x7f5c764cbc14f9669b88837ca1490cca17c31607", // USDC.e
            "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
            "0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6", // LINK
            "0xc40f949f8a4e094d1b49a23ea9241d289b7b2819", // LUSD
          ],
          LTVs: [
            50,
            50,
            100,
            50,
            80,
            50,
            50,
            50,
            80,
            80,
            50,
            50,
          ],
        },
      },
      USDCPool: true,
    },
  },
  ARBITRUM_ONE: {
    chainId: 42161,
    CCTP: {
      TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
      MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
    },
    AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
    StargateTreasurer: "0x146c8e409C113ED87C6183f4d25c50251DFfbb3a",
    EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    WrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    RebalancerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE, Network.OP_MAINNET, Network.BASE, Network.OP_MAINNET],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
    },
    RepayerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE, Network.OP_MAINNET, Network.BASE, Network.OP_MAINNET],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      SupportsAllTokens: [true, true, false, false],
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 300,
      defaultLTV: 0,
      tokenLTVs: {
        Tokens: [
          "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC
          "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH
          "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", // WBTC
          "0x35751007a407ca6feffe80b3cb397736d2cf4dbe", // weETH
          "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT0
          "0x5979d7b546e38e414f7e9822514be443a4800529", // wstETH
          "0xf97f4df75117a78c1a5a0dbb814af92458539fb4", // LINK
          "0x912ce59144191c1204e64559fe8253a0e49e6548", // ARB
          "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
          "0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8", // rETH
          "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8", // USDC.e
          "0x7dff72693f6a4149b17e7c6314655f6a9f7c8b33", // GHO
          "0x93b346b6bc2548da6a1e7d98e9a421b42541425b", // LUSD
          "0x17fc002b466eec40dae837fc4be5c67993ddbd6f", // FRAX
        ],
        LTVs: [
          100,
          50,
          50,
          50,
          80,
          50,
          50,
          50,
          80,
          30,
          80,
          20,
          50,
          20,
        ],
      },
    },
    USDCPool: true,
    Stage: {
      chainId: 42161,
      CCTP: {
        TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
        MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
      },
      AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
      StargateTreasurer: "0x146c8e409C113ED87C6183f4d25c50251DFfbb3a",
      EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      WrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      WithdrawProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      Pauser: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalanceCaller: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCaller: "0xECf983dD6Ecd4245fBAAF608594033AB0660D225",
      MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
      RebalancerRoutes: {
        Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
        Domains: [Network.BASE, Network.OP_MAINNET, Network.BASE, Network.OP_MAINNET],
        Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      },
      RepayerRoutes: {
        Pools: [
          LiquidityPoolAaveUSDC,
          LiquidityPoolAaveUSDC,
          LiquidityPoolUSDC,
          LiquidityPoolUSDC,
          LiquidityPoolAaveUSDC,
          LiquidityPoolAaveUSDC
        ],
        Domains: [
          Network.BASE,
          Network.OP_MAINNET,
          Network.BASE,
          Network.OP_MAINNET,
          Network.BASE,
          Network.OP_MAINNET
        ],
        Providers: [
          Provider.EVERCLEAR,
          Provider.EVERCLEAR,
          Provider.CCTP,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.ACROSS
        ],
        SupportsAllTokens: [true, true, false, false, true, true],
      },
      AavePool: {
        AaveAddressesProvider: AAVEPools.AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
        minHealthFactor: 300,
        defaultLTV: 0,
        tokenLTVs: {
          Tokens: [
            "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC
            "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH
            "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", // WBTC
            "0x35751007a407ca6feffe80b3cb397736d2cf4dbe", // weETH
            "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT0
            "0x5979d7b546e38e414f7e9822514be443a4800529", // wstETH
            "0xf97f4df75117a78c1a5a0dbb814af92458539fb4", // LINK
            "0x912ce59144191c1204e64559fe8253a0e49e6548", // ARB
            "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
            "0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8", // rETH
            "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8", // USDC.e
            "0x7dff72693f6a4149b17e7c6314655f6a9f7c8b33", // GHO
            "0x93b346b6bc2548da6a1e7d98e9a421b42541425b", // LUSD
            "0x17fc002b466eec40dae837fc4be5c67993ddbd6f", // FRAX
          ],
          LTVs: [
            100,
            50,
            50,
            50,
            80,
            50,
            50,
            50,
            80,
            30,
            80,
            20,
            50,
            20,
          ],
        },
      },
      USDCPool: true,
    },
  },
  BASE: {
    chainId: 8453,
    CCTP: {
      TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
      MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
    },
    AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
    StargateTreasurer: "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
    EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    Hub: {
      AssetsAdjuster: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
      DepositProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
      AssetsLimitSetter: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
      AssetsLimit: 10_000_000,
      Tiers: [
        {period: 7776000n, multiplier: 400000000n},
        {period: 15552000n, multiplier: 1000000000n},
        {period: 31104000n, multiplier: 2200000000n},
      ]
    },
    RebalancerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.OP_MAINNET, Network.ARBITRUM_ONE, Network.OP_MAINNET, Network.ARBITRUM_ONE],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
    },
    RepayerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.OP_MAINNET, Network.ARBITRUM_ONE, Network.OP_MAINNET, Network.ARBITRUM_ONE],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      SupportsAllTokens: [true, true, false, false],
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Base.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 300,
      defaultLTV: 0,
      tokenLTVs: {
        Tokens: [
          "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
          "0x4200000000000000000000000000000000000006", // WETH
          "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC
          "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a", // weETH
          "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", // wstETH
          "0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee", // GHO
          "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", // cbETH
          "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
          "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", // EURC
        ],
        LTVs: [
          100,
          50,
          50,
          50,
          50,
          20,
          50,
          80,
          20,
        ],
      },
    },
    USDCPool: true,
    Stage: {
      chainId: 8453,
      CCTP: {
        TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
        MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
      },
      AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      StargateTreasurer: "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
      EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      WithdrawProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      Pauser: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalanceCaller: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCaller: "0xECf983dD6Ecd4245fBAAF608594033AB0660D225",
      MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
      Hub: {
        AssetsAdjuster: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
        DepositProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
        AssetsLimitSetter: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
        AssetsLimit: 10_000_000,
        Tiers: [
          {period: 7776000n, multiplier: 400000000n},
          {period: 15552000n, multiplier: 1000000000n},
          {period: 31104000n, multiplier: 2200000000n},
        ]
      },
      RebalancerRoutes: {
        Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
        Domains: [Network.OP_MAINNET, Network.ARBITRUM_ONE, Network.OP_MAINNET, Network.ARBITRUM_ONE],
        Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      },
      RepayerRoutes: {
        Pools: [
          LiquidityPoolAaveUSDC,
          LiquidityPoolAaveUSDC,
          LiquidityPoolUSDC,
          LiquidityPoolUSDC,
          LiquidityPoolAaveUSDC,
          LiquidityPoolAaveUSDC
        ],
        Domains: [
          Network.OP_MAINNET,
          Network.ARBITRUM_ONE,
          Network.OP_MAINNET,
          Network.ARBITRUM_ONE,
          Network.OP_MAINNET,
          Network.ARBITRUM_ONE
        ],
        Providers: [
          Provider.EVERCLEAR,
          Provider.EVERCLEAR,
          Provider.CCTP,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.ACROSS
        ],
        SupportsAllTokens: [true, true, false, false, true, true],
      },
      AavePool: {
        AaveAddressesProvider: AAVEPools.AaveV3Base.POOL_ADDRESSES_PROVIDER,
        minHealthFactor: 300,
        defaultLTV: 0,
        tokenLTVs: {
          Tokens: [
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
            "0x4200000000000000000000000000000000000006", // WETH
            "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC
            "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a", // weETH
            "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", // wstETH
            "0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee", // GHO
            "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", // cbETH
            "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
            "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", // EURC
          ],
          LTVs: [
            100,
            50,
            50,
            50,
            50,
            20,
            50,
            80,
            20,
          ],
        },
      },
      USDCPool: true,
    },
  },
  POLYGON_MAINNET: {
    chainId: 137,
    CCTP: {
      TokenMessenger: "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE",
      MessageTransmitter: "0xF3be9355363857F3e001be68856A2f96b4C39Ba9",
    },
    AcrossV3SpokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
    StargateTreasurer: "0x36ed193dc7160D3858EC250e69D12B03Ca087D08",
    EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
    USDC: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    WrappedNativeToken: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Polygon.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 300,
      defaultLTV: 0,
    },
  },
  ETHEREUM_SEPOLIA: {
    chainId: 11155111,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    AcrossV3SpokePool: "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662",
    StargateTreasurer: "0x41945d449bd72AE0E237Eade565D8Bde2aa5e969",
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    WrappedNativeToken: "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    USDCPool: true,
    // Aave: AAVEPools.AaveV3Sepolia.POOL_ADDRESSES_PROVIDER, // Uses not official USDC.
  },
  AVALANCHE_FUJI: {
    chainId: 43113,
    CCTP: {
      TokenMessenger: "0xeb08f243e5d3fcff26a9e38ae5520a669f4019d0",
      MessageTransmitter: "0xa9fb1b3009dcb79e2fe346c16a604b8fa8ae0a79",
    },
    USDC: "0x5425890298aed601595a70ab815c96711a31bc65",
    WrappedNativeToken: "0xd00ae08403B9bbb9124bB305C09058E32C39A48c",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Fuji.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 500,
      defaultLTV: 20,
    },
  },
  OP_SEPOLIA: {
    chainId: 11155420,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    AcrossV3SpokePool: "0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
    StargateTreasurer: "0x7470E97cc02b0D5be6CFFAd3fd8012755db16156",
    USDC: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    RebalancerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE_SEPOLIA, Network.ARBITRUM_SEPOLIA, Network.BASE_SEPOLIA, Network.ARBITRUM_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
    },
    RepayerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE_SEPOLIA, Network.ARBITRUM_SEPOLIA, Network.BASE_SEPOLIA, Network.ARBITRUM_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      SupportsAllTokens: [true, true, false, false],
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3OptimismSepolia.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 500,
      defaultLTV: 20,
    },
    USDCPool: true,
  },
  ARBITRUM_SEPOLIA: {
    chainId: 421614,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0xaCF1ceeF35caAc005e15888dDb8A3515C41B4872",
    },
    AcrossV3SpokePool: "0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75",
    StargateTreasurer: "0xd1E255BB6354D237172802646B0d6dDCFC8c509E",
    USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    WrappedNativeToken: "0x1dF462e2712496373A347f8ad10802a5E95f053D",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    RebalancerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE_SEPOLIA, Network.OP_SEPOLIA, Network.BASE_SEPOLIA, Network.OP_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
    },
    RepayerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE_SEPOLIA, Network.OP_SEPOLIA, Network.BASE_SEPOLIA, Network.OP_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      SupportsAllTokens: [true, true, false, false],
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3ArbitrumSepolia.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 500,
      defaultLTV: 20,
    },
    USDCPool: true,
  },
  BASE_SEPOLIA: {
    chainId: 84532,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    AcrossV3SpokePool: "0x82B564983aE7274c86695917BBf8C99ECb6F0F8F",
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    Hub: {
      AssetsAdjuster: "0x6c663396827e68d10c58691f9c4bb58ae9ec85e3",
      DepositProfit: "0x6c663396827e68d10c58691f9c4bb58ae9ec85e3",
      AssetsLimitSetter: "0x6c663396827e68d10c58691f9c4bb58ae9ec85e3",
      AssetsLimit: 1000,
      Tiers: [
        {period: 600n, multiplier: 400000000n},
        {period: 1200n, multiplier: 1000000000n},
        {period: 2400n, multiplier: 2200000000n},
      ]
    },
    RebalancerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.ARBITRUM_SEPOLIA, Network.OP_SEPOLIA, Network.ARBITRUM_SEPOLIA, Network.OP_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
    },
    RepayerRoutes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.ARBITRUM_SEPOLIA, Network.OP_SEPOLIA, Network.ARBITRUM_SEPOLIA, Network.OP_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP],
      SupportsAllTokens: [true, true, false, false],
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3BaseSepolia.POOL_ADDRESSES_PROVIDER,
      minHealthFactor: 500,
      defaultLTV: 20,
    },
    USDCPool: true,
  },
  POLYGON_AMOY: {
    chainId: 80002,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    AcrossV3SpokePool: "0xd08baaE74D6d2eAb1F3320B2E1a53eeb391ce8e5",
    USDC: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
    WrappedNativeToken: "0x0000000000000000000000000000000000000000",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
  },
};

export enum StandaloneRepayerEnv {
  SparkStage = "SparkStage",
};

export interface StandaloneRepayerConfig {
  chainId: number;
  CCTP: CCTPConfig;
  AcrossV3SpokePool?: string;
  StargateTreasurer?: string;
  EverclearFeeAdapter?: string;
  OptimismStandardBridge?: string;
  USDC: string;
  WrappedNativeToken: string;
  RepayerRoutes: RepayerRoutesConfig;
  IsTest: boolean;
  Admin: string;
  RepayerCallers: string[];
};

type StandaloneRepayersConfig = {
  [key in Network]?: {
    [key in StandaloneRepayerEnv]?: StandaloneRepayerConfig;
  };
};

export const repayerConfig: StandaloneRepayersConfig = {
  BASE: {
    SparkStage: {
      chainId: 8453,
      CCTP: {
        TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
        MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
      },
      AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      StargateTreasurer: "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
      EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      RepayerRoutes: {
        Pools: [
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
        ],
        Domains: [
          Network.BASE,
          Network.ARBITRUM_ONE,
          Network.ARBITRUM_ONE,
          Network.ARBITRUM_ONE,
          Network.ARBITRUM_ONE,
          Network.OP_MAINNET,
          Network.OP_MAINNET,
          Network.OP_MAINNET,
          Network.OP_MAINNET,
        ],
        Providers: [
          Provider.LOCAL,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.STARGATE,
          Provider.EVERCLEAR,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.STARGATE,
          Provider.EVERCLEAR,
        ],
        SupportsAllTokens: [true, false, true, true, true, false, true, true, true],
      },
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
  ARBITRUM_ONE: {
    SparkStage: {
      chainId: 42161,
      CCTP: {
        TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
        MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
      },
      AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
      StargateTreasurer: "0x146c8e409C113ED87C6183f4d25c50251DFfbb3a",
      EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      WrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      RepayerRoutes: {
        Pools: [
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
        ],
        Domains: [
          Network.ARBITRUM_ONE,
          Network.BASE,
          Network.BASE,
          Network.BASE,
          Network.BASE,
          Network.OP_MAINNET,
          Network.OP_MAINNET,
          Network.OP_MAINNET,
          Network.OP_MAINNET,
        ],
        Providers: [
          Provider.LOCAL,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.STARGATE,
          Provider.EVERCLEAR,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.STARGATE,
          Provider.EVERCLEAR,
        ],
        SupportsAllTokens: [true, false, true, true, true, false, true, true, true],
      },
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
  OP_MAINNET: {
    SparkStage: {
      chainId: 10,
      CCTP: {
        TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
        MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
      },
      AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
      StargateTreasurer: "0x644abb1e17291b4403966119d15Ab081e4a487e9",
      EverclearFeeAdapter: "0x15a7cA97D1ed168fB34a4055CEFa2E2f9Bdb6C75",
      USDC: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      RepayerRoutes: {
        Pools: [
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
          "0xa21007B5BC5E2B488063752d1BE43C0f3f376743",
        ],
        Domains: [
          Network.OP_MAINNET,
          Network.ARBITRUM_ONE,
          Network.ARBITRUM_ONE,
          Network.ARBITRUM_ONE,
          Network.ARBITRUM_ONE,
          Network.BASE,
          Network.BASE,
          Network.BASE,
          Network.BASE,
        ],
        Providers: [
          Provider.LOCAL,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.STARGATE,
          Provider.EVERCLEAR,
          Provider.CCTP,
          Provider.ACROSS,
          Provider.STARGATE,
          Provider.EVERCLEAR,
        ],
        SupportsAllTokens: [true, false, true, true, true, false, true, true, true],
      },
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
};
