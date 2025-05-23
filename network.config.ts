import * as AAVEPools from "@bgd-labs/aave-address-book";

export const LiquidityPoolAaveUSDC: string = "LiquidityPoolAaveUSDC";
export const LiquidityPoolUSDC: string = "LiquidityPoolUSDC";
export const LiquidityPoolUSDCStablecoin: string = "LiquidityPoolUSDCStablecoin";

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
};

interface CCTPConfig {
  TokenMessenger: string;
  MessageTransmitter: string;
};

interface RebalancerRoutesConfig {
  Pools: string[];
  Domains: Network[];
  Providers: Provider[];
};

interface RepayerRoutesConfig {
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
  USDC: string;
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
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x1337000000000000000000000000000000000000",
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
    USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x1337000000000000000000000000000000000000",
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
    USDC: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x1337000000000000000000000000000000000000",
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
    },
    USDCPool: true,
    Stage: {
      chainId: 10,
      CCTP: {
        TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
        MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
      },
      AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
      USDC: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
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
        Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.ACROSS, Provider.ACROSS],
        SupportsAllTokens: [true, true, false, false, true, true],
      },
      AavePool: {
        AaveAddressesProvider: AAVEPools.AaveV3Optimism.POOL_ADDRESSES_PROVIDER,
        minHealthFactor: 300,
        defaultLTV: 0,
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
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x1337000000000000000000000000000000000000",
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
    },
    USDCPool: true,
    Stage: {
      chainId: 42161,
      CCTP: {
        TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
        MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
      },
      AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
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
        Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.ACROSS, Provider.ACROSS],
        SupportsAllTokens: [true, true, false, false, true, true],
      },
      AavePool: {
        AaveAddressesProvider: AAVEPools.AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
        minHealthFactor: 300,
        defaultLTV: 0,
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
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x1337000000000000000000000000000000000000",
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
    },
    USDCPool: true,
    Stage: {
      chainId: 8453,
      CCTP: {
        TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
        MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
      },
      AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
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
        Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.ACROSS, Provider.ACROSS],
        SupportsAllTokens: [true, true, false, false, true, true],
      },
      AavePool: {
        AaveAddressesProvider: AAVEPools.AaveV3Base.POOL_ADDRESSES_PROVIDER,
        minHealthFactor: 300,
        defaultLTV: 0,
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
    USDC: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x1337000000000000000000000000000000000000",
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
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
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
    USDC: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
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
    USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
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
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
  },
};
