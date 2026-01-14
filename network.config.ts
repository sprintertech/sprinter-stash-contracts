import * as AAVEPools from "@bgd-labs/aave-address-book";

// Upgradeable contracts proxies are deployed once with the contract name suffix in id.
// Subsequent implementation just use UPGRADE_ID env variable.
// Immutable contracts are deployed first with the name-derived unique id.
// Subsequent versions use version suffix plus a git commit from the main branch.
export const LiquidityPoolAaveUSDC = "LiquidityPoolAaveUSDC";
export const LiquidityPoolUSDC = "LiquidityPoolUSDC";
export const LiquidityPoolPublicUSDC = "LiquidityPoolPublicUSDC";
export const LiquidityPoolUSDCStablecoin = "LiquidityPoolUSDCStablecoin";
export const LiquidityPoolAaveUSDCLongTerm = "LiquidityPoolAaveUSDCLongTerm";
export const ERC4626AdapterUSDC = "ERC4626AdapterUSDC";

export const LiquidityPoolAaveUSDCLongTermV2 = "LiquidityPoolAaveUSDCLongTerm-V2-e09cc75";
export const LiquidityPoolAaveUSDCV2 = "LiquidityPoolAaveUSDC-V2-3601cc4";
export const LiquidityPoolUSDCV2 = "LiquidityPoolUSDC-V2-3601cc4";
export const LiquidityPoolUSDCStablecoinV2 = "LiquidityPoolUSDCStablecoin-V2-3601cc4";

export const LiquidityPoolAaveUSDCV3 = "LiquidityPoolAaveUSDC-V3-e09cc75";
export const LiquidityPoolUSDCV3 = "LiquidityPoolUSDC-V3-e09cc75";
export const LiquidityPoolUSDCStablecoinV3 = "LiquidityPoolUSDCStablecoin-V3-e09cc75";

export const LiquidityPoolAaveUSDCV4 = "LiquidityPoolAaveUSDC-V4-7187ffa";
export const LiquidityPoolUSDCV4 = "LiquidityPoolUSDC-V4-7187ffa";
export const LiquidityPoolPublicUSDCV2 = "LiquidityPoolPublicUSDC-V2-7187ffa";
export const LiquidityPoolUSDCStablecoinV4 = "LiquidityPoolUSDCStablecoin-V4-7187ffa";
export const LiquidityPoolAaveUSDCLongTermV3 = "LiquidityPoolAaveUSDCLongTerm-V3-7187ffa";
export const ERC4626AdapterUSDCV2 = "ERC4626AdapterUSDC-V2-7187ffa";
export const LiquidityPoolAaveUSDCLongTermVersions = [
  LiquidityPoolAaveUSDCLongTerm,
  LiquidityPoolAaveUSDCLongTermV2,
  LiquidityPoolAaveUSDCLongTermV3,
] as const;
export const LiquidityPoolAaveUSDCVersions = [
  LiquidityPoolAaveUSDC,
  LiquidityPoolAaveUSDCV2,
  LiquidityPoolAaveUSDCV3,
  LiquidityPoolAaveUSDCV4,
] as const;
export const LiquidityPoolUSDCVersions = [
  LiquidityPoolUSDC,
  LiquidityPoolUSDCV2,
  LiquidityPoolUSDCV3,
  LiquidityPoolUSDCV4,
] as const;
export const LiquidityPoolUSDCStablecoinVersions = [
  LiquidityPoolUSDCStablecoin,
  LiquidityPoolUSDCStablecoinV2,
  LiquidityPoolUSDCStablecoinV3,
  LiquidityPoolUSDCStablecoinV4,
] as const;
export const LiquidityPoolPublicUSDCVersions = [
  LiquidityPoolPublicUSDC,
  LiquidityPoolPublicUSDCV2,
] as const;
export const ERC4626AdapterUSDCVersions = [
  ERC4626AdapterUSDC,
  ERC4626AdapterUSDCV2,
] as const;

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
  UNICHAIN = "UNICHAIN",
  BSC = "BSC",
  LINEA = "LINEA",
}

export enum Provider {
  LOCAL = "LOCAL",
  CCTP = "CCTP",
  ACROSS = "ACROSS",
  EVERCLEAR = "EVERCLEAR",
  STARGATE = "STARGATE",
  SUPERCHAIN_STANDARD_BRIDGE = "SUPERCHAIN_STANDARD_BRIDGE",
}

export enum Token {
  USDC = "USDC",
  USDT = "USDT",
  DAI = "DAI",
  WETH = "WETH",
  WBTC = "WBTC",
}

interface CCTPConfig {
  TokenMessenger: string;
  MessageTransmitter: string;
}

export interface RebalancerRoutesConfig {
  [Pool: string]: {
    [Domain in Network]?: Provider[];
  };
}

export interface RepayerRoutesConfig {
  [Pool: string]: {
    SupportsAllTokens: boolean;
    Domains: {
      [Domain in Network]?: Provider[];
    };
  };
}

interface PublicPoolConfig {
  Name: string;
  Symbol: string;
  ProtocolFeeRate: number;
  FeeSetter: string;
}

interface AavePoolConfig {
  AaveAddressesProvider: string;
  MinHealthFactor: number; // Value 500 will result in health factor 5.
  DefaultLTV: number; // Value 20 will result in LTV 20%.
  TokenLTVs?: {
    [token: string]: number;
  };
}

interface AavePoolLongTermConfig extends AavePoolConfig {
  BorrowLongTermAdmin: string;
  RepayCaller: string;
}

// Liquidity mining tiers.
// period is in seconds.
// multiplier will be divided by 1000,000,000. So 1750000000 will result in 1.75x.
// There is no limit to the number of tiers, but has to be at least one.
// Keys are not capitalized to match the contract.
interface Tier {
  period: bigint;
  multiplier: bigint;
}

interface HubConfig {
  AssetsAdjuster: string; // Address that can increase/decrease LP conversion rate.
  DepositProfit: string; // Address that can deposit profit to the Liquidity Pool via Liquidity Hub.
  AssetsLimitSetter: string; // Address that can set assets limit.
  AssetsLimit: number; // Deposits to Liquidity Hub are only allowed till this limit is reached.
  Tiers: Tier[];
  Pool?: (typeof LiquidityPoolUSDCVersions)[number] 
    | (typeof LiquidityPoolAaveUSDCVersions)[number]
    | (typeof LiquidityPoolUSDCStablecoinVersions)[number]
    | (typeof LiquidityPoolAaveUSDCLongTermVersions)[number];
}

export interface NetworkConfig {
  ChainId: number;
  CCTP?: CCTPConfig;
  AcrossV3SpokePool?: string;
  StargateTreasurer?: string;
  EverclearFeeAdapter?: string;
  OptimismStandardBridge?: string;
  BaseStandardBridge?: string;
  Tokens: {
    [Token.USDC]: string;
    [Token.USDT]?: string;
    [Token.DAI]?: string;
    [Token.WETH]?: string;
    [Token.WBTC]?: string;
  };
  WrappedNativeToken: string;
  RebalancerRoutes?: RebalancerRoutesConfig;
  RepayerRoutes?: RepayerRoutesConfig;
  IsTest: boolean;
  Admin: string; // Every contracts admin/owner.
  WithdrawProfit: string;
  Pauser: string;
  RebalanceCaller: string; // Address that can trigger funds movement between pools.
  RepayerCaller: string;
  SetInputOutputTokens: string;
  MpcAddress: string;
  SignerAddress: string;
  Hub?: HubConfig;
  AavePool?: AavePoolConfig;
  AavePoolLongTerm?: AavePoolLongTermConfig;
  USDCPool?: boolean;
  USDCStablecoinPool?: boolean;
  USDCPublicPool?: PublicPoolConfig;
  ERC4626AdapterUSDCTargetVault?: string;
  Stage?: NetworkConfig;
}

export type PartialNetworksConfig = {
  [key in Network]?: NetworkConfig;
};

type NetworksConfig = {
  [key in Network]: NetworkConfig;
};

export const networkConfig: NetworksConfig = {
  ETHEREUM: {
    ChainId: 1,
    CCTP: {
      TokenMessenger: "0xbd3fa81b58ba92a82136038b25adec7066af3155",
      MessageTransmitter: "0x0a992d191deec32afe36203ad87d7d289a738f81",
    },
    AcrossV3SpokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
    StargateTreasurer: "0x1041D127b2d4BC700F0F563883bC689502606918",
    EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
    OptimismStandardBridge: "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1",
    BaseStandardBridge: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35",
    Tokens: {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    },
    WrappedNativeToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalancerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        [Network.OP_MAINNET]: [Provider.CCTP],
        [Network.ARBITRUM_ONE]: [Provider.CCTP],
        [Network.BASE]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCV4]: {
        [Network.OP_MAINNET]: [Provider.CCTP],
        [Network.ARBITRUM_ONE]: [Provider.CCTP],
        [Network.BASE]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        [Network.UNICHAIN]: [Provider.CCTP],
      },
    },
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.OP_MAINNET]: [
            Provider.CCTP,
            Provider.ACROSS,
            Provider.EVERCLEAR,
            Provider.SUPERCHAIN_STANDARD_BRIDGE,
            Provider.STARGATE,
          ],
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [
            Provider.CCTP,
            Provider.ACROSS,
            Provider.EVERCLEAR,
            Provider.SUPERCHAIN_STANDARD_BRIDGE,
            Provider.STARGATE
          ],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.OP_MAINNET]: [
            Provider.CCTP,
            Provider.ACROSS,
            Provider.EVERCLEAR,
            Provider.SUPERCHAIN_STANDARD_BRIDGE
          ],
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.SUPERCHAIN_STANDARD_BRIDGE],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.UNICHAIN]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
    },
    USDCStablecoinPool: true,
    AavePoolLongTerm: {
      AaveAddressesProvider: AAVEPools.AaveV3Ethereum.POOL_ADDRESSES_PROVIDER,
      MinHealthFactor: 150,
      DefaultLTV: 0,
      TokenLTVs: {
        "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": 100, // WBTC
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": 100, // WETH
        "0x6b175474e89094c44da98b954eedeac495271d0f": 90, // DAI
      },
      BorrowLongTermAdmin: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
      RepayCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    },
    USDCPool: true,
    Stage: {
      ChainId: 1,
      CCTP: {
        TokenMessenger: "0xbd3fa81b58ba92a82136038b25adec7066af3155",
        MessageTransmitter: "0x0a992d191deec32afe36203ad87d7d289a738f81",
      },
      AcrossV3SpokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
      StargateTreasurer: "0x1041D127b2d4BC700F0F563883bC689502606918",
      EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
      OptimismStandardBridge: "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1",
      BaseStandardBridge: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35",
      Tokens: {
        USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      },
      WrappedNativeToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      WithdrawProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      Pauser: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalanceCaller: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCaller: "0xECf983dD6Ecd4245fBAAF608594033AB0660D225",
      SetInputOutputTokens: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
      SignerAddress: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalancerRoutes: {
        [LiquidityPoolAaveUSDCV4]: {
          [Network.BASE]: [Provider.CCTP],
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
          [Network.OP_MAINNET]: [Provider.CCTP],
        },
        [LiquidityPoolUSDCV4]: {
          [Network.BASE]: [Provider.CCTP],
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
          [Network.OP_MAINNET]: [Provider.CCTP],
        },
        [LiquidityPoolAaveUSDCLongTermV3]: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
        },
        [ERC4626AdapterUSDCV2]: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
        },
      },
      RepayerRoutes: {
        [LiquidityPoolAaveUSDCV4]: {
          SupportsAllTokens: true,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.SUPERCHAIN_STANDARD_BRIDGE],
            [Network.OP_MAINNET]: [
              Provider.CCTP,
              Provider.ACROSS,
              Provider.EVERCLEAR,
              Provider.SUPERCHAIN_STANDARD_BRIDGE
            ],
          },
        },
        [LiquidityPoolUSDCV4]: {
          SupportsAllTokens: false,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.BASE]: [
              Provider.CCTP,
              Provider.ACROSS,
              Provider.EVERCLEAR,
              Provider.SUPERCHAIN_STANDARD_BRIDGE,
            ],
            [Network.OP_MAINNET]: [
              Provider.CCTP,
              Provider.ACROSS,
              Provider.EVERCLEAR,
              Provider.SUPERCHAIN_STANDARD_BRIDGE,
            ],
          },
        },
        [LiquidityPoolAaveUSDCLongTermV3]: {
          SupportsAllTokens: true,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
        },
      },
      USDCPool: true,
    },
  },
  AVALANCHE: {
    ChainId: 43114,
    CCTP: {
      TokenMessenger: "0x6b25532e1060ce10cc3b0a99e5683b91bfde6982",
      MessageTransmitter: "0x8186359af5f57fbb40c6b14a588d2a59c0c29880",
    },
    StargateTreasurer: "0xC2b638Cb5042c1B3c5d5C969361fB50569840583",
    EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
    Tokens: {
      USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    },
    WrappedNativeToken: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.CCTP, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
          [Network.BASE]: [Provider.CCTP],
          [Network.ETHEREUM]: [Provider.CCTP],
          [Network.OP_MAINNET]: [Provider.CCTP],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.UNICHAIN]: [Provider.CCTP, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
    },
  },
  OP_MAINNET: {
    ChainId: 10,
    CCTP: {
      TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
      MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
    },
    AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
    StargateTreasurer: "0x644abb1e17291b4403966119d15Ab081e4a487e9",
    EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
    OptimismStandardBridge: "0x4200000000000000000000000000000000000010",
    Tokens: {
      USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
      DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
      WETH: "0x4200000000000000000000000000000000000006",
      WBTC: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
    },
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalancerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        [Network.BASE]: [Provider.CCTP],
        [Network.ARBITRUM_ONE]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCV4]: {
        [Network.BASE]: [Provider.CCTP],
        [Network.ARBITRUM_ONE]: [Provider.CCTP],
        [Network.ETHEREUM]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        [Network.ETHEREUM]: [Provider.CCTP],
        [Network.UNICHAIN]: [Provider.CCTP],
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        [Network.ETHEREUM]: [Provider.CCTP],
      },
    },
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.UNICHAIN]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        }
      },
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Optimism.POOL_ADDRESSES_PROVIDER,
      MinHealthFactor: 300,
      DefaultLTV: 0,
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
    USDCPool: true,
    Stage: {
      ChainId: 10,
      CCTP: {
        TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
        MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
      },
      AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
      StargateTreasurer: "0x644abb1e17291b4403966119d15Ab081e4a487e9",
      EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
      Tokens: {
        USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
        DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
        WETH: "0x4200000000000000000000000000000000000006",
        WBTC: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
      },
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      WithdrawProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      Pauser: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalanceCaller: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCaller: "0xECf983dD6Ecd4245fBAAF608594033AB0660D225",
      SetInputOutputTokens: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
      SignerAddress: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalancerRoutes: {
        [LiquidityPoolAaveUSDCV4]: {
          [Network.BASE]: [Provider.CCTP],
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
        },
        [LiquidityPoolUSDCV4]: {
          [Network.BASE]: [Provider.CCTP],
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
          [Network.ETHEREUM]: [Provider.CCTP],
        },
        [LiquidityPoolAaveUSDCLongTermV3]: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
        },
        [ERC4626AdapterUSDCV2]: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
        },
      },
      RepayerRoutes: {
        [LiquidityPoolAaveUSDCV4]: {
          SupportsAllTokens: true,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
        },
        [LiquidityPoolUSDCV4]: {
          SupportsAllTokens: false,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
        },
        [LiquidityPoolAaveUSDCLongTermV3]: {
          SupportsAllTokens: true,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
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
      USDCPool: true,
    },
  },
  ARBITRUM_ONE: {
    ChainId: 42161,
    CCTP: {
      TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
      MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
    },
    AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
    StargateTreasurer: "0x146c8e409C113ED87C6183f4d25c50251DFfbb3a",
    EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
    Tokens: {
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
      WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    },
    WrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalancerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        [Network.BASE]: [Provider.CCTP],
        [Network.OP_MAINNET]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCV4]: {
        [Network.BASE]: [Provider.CCTP],
        [Network.OP_MAINNET]: [Provider.CCTP],
        [Network.ETHEREUM]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        [Network.ETHEREUM]: [Provider.CCTP],
        [Network.UNICHAIN]: [Provider.CCTP],
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        [Network.ETHEREUM]: [Provider.CCTP],
      },
    },
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.UNICHAIN]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        }
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
    USDCPool: true,
    Stage: {
      ChainId: 42161,
      CCTP: {
        TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
        MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
      },
      AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
      StargateTreasurer: "0x146c8e409C113ED87C6183f4d25c50251DFfbb3a",
      EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
      Tokens: {
        USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
        WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
      },
      WrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      WithdrawProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      Pauser: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalanceCaller: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCaller: "0xECf983dD6Ecd4245fBAAF608594033AB0660D225",
      SetInputOutputTokens: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
      SignerAddress: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalancerRoutes: {
        [LiquidityPoolAaveUSDCV4]: {
          [Network.BASE]: [Provider.CCTP],
          [Network.OP_MAINNET]: [Provider.CCTP],
        },
        [LiquidityPoolUSDCV4]: {
          [Network.BASE]: [Provider.CCTP],
          [Network.OP_MAINNET]: [Provider.CCTP],
          [Network.ETHEREUM]: [Provider.CCTP],
        },
      },
      RepayerRoutes: {
        [LiquidityPoolAaveUSDCV4]: {
          SupportsAllTokens: true,
          Domains: {
            [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
        },
        [LiquidityPoolUSDCV4]: {
          SupportsAllTokens: false,
          Domains: {
            [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
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
      USDCPool: true,
      AavePoolLongTerm: {
        AaveAddressesProvider: AAVEPools.AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
        MinHealthFactor: 150,
        DefaultLTV: 0,
        TokenLTVs: {
          "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": 100, // WBTC
        },
        BorrowLongTermAdmin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
        RepayCaller: "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607",
      },
      USDCPublicPool: {
        Name: "Sprinter-Lighter Fast Withdrawal Pool",
        Symbol: "SLFWP",
        ProtocolFeeRate: 20,
        FeeSetter: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      },
      ERC4626AdapterUSDCTargetVault: LiquidityPoolPublicUSDCV2,
    },
  },
  BASE: {
    ChainId: 8453,
    CCTP: {
      TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
      MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
    },
    AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
    StargateTreasurer: "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
    EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
    Tokens: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      WETH: "0x4200000000000000000000000000000000000006",
    },
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Hub: {
      AssetsAdjuster: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
      DepositProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
      AssetsLimitSetter: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
      AssetsLimit: 10_000_000,
      Tiers: [
        {period: 7776000n, multiplier: 400000000n},
        {period: 15552000n, multiplier: 1000000000n},
        {period: 31104000n, multiplier: 2200000000n},
      ],
      Pool: LiquidityPoolAaveUSDCV4,
    },
    RebalancerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        [Network.OP_MAINNET]: [Provider.CCTP],
        [Network.ARBITRUM_ONE]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCV4]: {
        [Network.OP_MAINNET]: [Provider.CCTP],
        [Network.ETHEREUM]: [Provider.CCTP],
        [Network.ARBITRUM_ONE]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        [Network.ETHEREUM]: [Provider.CCTP],
        [Network.UNICHAIN]: [Provider.CCTP],
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        [Network.ETHEREUM]: [Provider.CCTP],
      },
    },
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.UNICHAIN]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        }
      },
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Base.POOL_ADDRESSES_PROVIDER,
      MinHealthFactor: 150,
      DefaultLTV: 0,
      TokenLTVs: {
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 100, // USDC
        "0x4200000000000000000000000000000000000006": 75, // WETH
        "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": 50, // cbBTC
        "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": 50, // weETH
        "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": 50, // wstETH
        "0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee": 20, // GHO
        "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": 50, // cbETH
        "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": 80, // USDbC
        "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": 20, // EURC
      },
    },
    USDCPool: true,
    Stage: {
      ChainId: 8453,
      CCTP: {
        TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
        MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
      },
      AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      StargateTreasurer: "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
      EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
      Tokens: {
        USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        WETH: "0x4200000000000000000000000000000000000006",
      },
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      WithdrawProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      Pauser: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RebalanceCaller: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCaller: "0xECf983dD6Ecd4245fBAAF608594033AB0660D225",
      SetInputOutputTokens: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
      SignerAddress: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      Hub: {
        AssetsAdjuster: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
        DepositProfit: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
        AssetsLimitSetter: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
        AssetsLimit: 10_000_000,
        Tiers: [
          {period: 7776000n, multiplier: 400000000n},
          {period: 15552000n, multiplier: 1000000000n},
          {period: 31104000n, multiplier: 2200000000n},
        ],
        Pool: LiquidityPoolAaveUSDCV4,
      },
      RebalancerRoutes: {
        [LiquidityPoolAaveUSDCV4]: {
          [Network.OP_MAINNET]: [Provider.CCTP],
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
        },
        [LiquidityPoolUSDCV4]: {
          [Network.OP_MAINNET]: [Provider.CCTP],
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
          [Network.ETHEREUM]: [Provider.CCTP],
        },
        [LiquidityPoolAaveUSDCLongTermV3]: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
        },
        [ERC4626AdapterUSDCV2]: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP],
        },
      },
      RepayerRoutes: {
        [LiquidityPoolAaveUSDCV4]: {
          SupportsAllTokens: true,
          Domains: {
            [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
        },
        [LiquidityPoolUSDCV4]: {
          SupportsAllTokens: false,
          Domains: {
            [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
            [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
        },
        [LiquidityPoolAaveUSDCLongTermV3]: {
          SupportsAllTokens: true,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          },
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
      USDCPool: true,
    },
  },
  POLYGON_MAINNET: {
    ChainId: 137,
    CCTP: {
      TokenMessenger: "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE",
      MessageTransmitter: "0xF3be9355363857F3e001be68856A2f96b4C39Ba9",
    },
    AcrossV3SpokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
    StargateTreasurer: "0x36ed193dc7160D3858EC250e69D12B03Ca087D08",
    EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
    Tokens: {
      USDC: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
      DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    },
    WrappedNativeToken: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.UNICHAIN]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        }
      },
    },
    // AavePool: { // Not deployed yet.
    //   AaveAddressesProvider: AAVEPools.AaveV3Polygon.POOL_ADDRESSES_PROVIDER,
    //   MinHealthFactor: 300,
    //   DefaultLTV: 0,
    // },
  },
  UNICHAIN: {
    ChainId: 130,
    CCTP: {
      TokenMessenger: "0x4e744b28E787c3aD0e810eD65A24461D4ac5a762",
      MessageTransmitter: "0x353bE9E2E38AB1D19104534e4edC21c643Df86f4",
    },
    AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
    StargateTreasurer: "0x6D205337F45D6850c3c3006e28d5b52c8a432c35",
    EverclearFeeAdapter: "0x877Fd0A881B63eBE413124EeE6abbCD7E82cf10b",
    Tokens: {
      USDC: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
      WETH: "0x4200000000000000000000000000000000000006",
    },
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalancerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        [Network.OP_MAINNET]: [Provider.CCTP],
        [Network.ARBITRUM_ONE]: [Provider.CCTP],
        [Network.BASE]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCV4]: {
        [Network.OP_MAINNET]: [Provider.CCTP],
        [Network.ARBITRUM_ONE]: [Provider.CCTP],
        [Network.BASE]: [Provider.CCTP],
        [Network.ETHEREUM]: [Provider.CCTP],
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        [Network.ETHEREUM]: [Provider.CCTP],
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        [Network.ETHEREUM]: [Provider.CCTP],
      },
    },
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.CCTP, Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        }
      },
    },
    USDCStablecoinPool: true,
  },
  BSC: {
    ChainId: 56,
    AcrossV3SpokePool: "0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
    StargateTreasurer: "0x0a6A15964fEe494A881338D65940430797F0d97C",
    EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
    Tokens: {
      USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    },
    WrappedNativeToken: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.UNICHAIN]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
    },
  },
  LINEA: {
    ChainId: 59144,
    AcrossV3SpokePool: "0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75",
    StargateTreasurer: "0xf5F74d2508e97A3a7CCA2ccb75c8325D66b46152",
    EverclearFeeAdapter: "0xAa7ee09f745a3c5De329EB0CD67878Ba87B70Ffe",
    Tokens: {
      USDC: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
      USDT: "0xA219439258ca9da29E9Cc4cE5596924745e12B93",
      DAI: "0x4AF15ec2A0BD43Db75dd04E62FAA3B8EF36b00d5",
      WETH: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f",
      WBTC: "0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4",
    },
    WrappedNativeToken: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    IsTest: false,
    Admin: "0x4eA9E682BA79bC403523c9e8D98A05EaF3810636",
    WithdrawProfit: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    Pauser: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RebalanceCaller: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerCaller: "0x9A5B33bd11329116A55F764c604a5152eE8Ca292",
    SetInputOutputTokens: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    MpcAddress: "0x3F68D470701522F1c9bb21CF44a33dBFa8E299C2",
    SignerAddress: "0x83B8D2eAda788943c3e80892f37f9c102271C1D6",
    RepayerRoutes: {
      [LiquidityPoolAaveUSDCV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCV4]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.BASE]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.OP_MAINNET]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolUSDCStablecoinV4]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
          [Network.UNICHAIN]: [Provider.ACROSS, Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
      [LiquidityPoolAaveUSDCLongTermV3]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ETHEREUM]: [Provider.EVERCLEAR, Provider.STARGATE],
        },
      },
    },
  },
  ETHEREUM_SEPOLIA: {
    ChainId: 11155111,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    AcrossV3SpokePool: "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662",
    StargateTreasurer: "0x41945d449bd72AE0E237Eade565D8Bde2aa5e969",
    Tokens: {
      USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    },
    WrappedNativeToken: "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    SetInputOutputTokens: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    USDCPool: true,
    // Aave: AAVEPools.AaveV3Sepolia.POOL_ADDRESSES_PROVIDER, // Uses not official USDC.
  },
  AVALANCHE_FUJI: {
    ChainId: 43113,
    CCTP: {
      TokenMessenger: "0xeb08f243e5d3fcff26a9e38ae5520a669f4019d0",
      MessageTransmitter: "0xa9fb1b3009dcb79e2fe346c16a604b8fa8ae0a79",
    },
    Tokens: {
      USDC: "0x5425890298aed601595a70ab815c96711a31bc65",
    },
    WrappedNativeToken: "0xd00ae08403B9bbb9124bB305C09058E32C39A48c",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    SetInputOutputTokens: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3Fuji.POOL_ADDRESSES_PROVIDER,
      MinHealthFactor: 500,
      DefaultLTV: 20,
    },
  },
  OP_SEPOLIA: {
    ChainId: 11155420,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    AcrossV3SpokePool: "0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
    StargateTreasurer: "0x7470E97cc02b0D5be6CFFAd3fd8012755db16156",
    Tokens: {
      USDC: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    },
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    SetInputOutputTokens: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RebalancerRoutes: {
      [LiquidityPoolAaveUSDC]: {
        [Network.BASE_SEPOLIA]: [Provider.CCTP],
        [Network.ARBITRUM_SEPOLIA]: [Provider.CCTP],
      },
      [LiquidityPoolUSDC]: {
        [Network.BASE_SEPOLIA]: [Provider.CCTP],
        [Network.ARBITRUM_SEPOLIA]: [Provider.CCTP],
      },
    },
    RepayerRoutes: {
      [LiquidityPoolAaveUSDC]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.BASE_SEPOLIA]: [Provider.CCTP],
          [Network.ARBITRUM_SEPOLIA]: [Provider.CCTP],
        },
      },
      [LiquidityPoolUSDC]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.BASE_SEPOLIA]: [Provider.CCTP],
          [Network.ARBITRUM_SEPOLIA]: [Provider.CCTP],
        },
      },
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3OptimismSepolia.POOL_ADDRESSES_PROVIDER,
      MinHealthFactor: 500,
      DefaultLTV: 20,
    },
    USDCPool: true,
  },
  ARBITRUM_SEPOLIA: {
    ChainId: 421614,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0xaCF1ceeF35caAc005e15888dDb8A3515C41B4872",
    },
    AcrossV3SpokePool: "0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75",
    StargateTreasurer: "0xd1E255BB6354D237172802646B0d6dDCFC8c509E",
    Tokens: {
      USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    },
    WrappedNativeToken: "0x1dF462e2712496373A347f8ad10802a5E95f053D",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    SetInputOutputTokens: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RebalancerRoutes: {
      [LiquidityPoolAaveUSDC]: {
        [Network.BASE_SEPOLIA]: [Provider.CCTP],
        [Network.OP_SEPOLIA]: [Provider.CCTP],
      },
      [LiquidityPoolUSDC]: {
        [Network.BASE_SEPOLIA]: [Provider.CCTP],
        [Network.OP_SEPOLIA]: [Provider.CCTP],
      },
    },
    RepayerRoutes: {
      [LiquidityPoolAaveUSDC]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.BASE_SEPOLIA]: [Provider.CCTP],
          [Network.OP_SEPOLIA]: [Provider.CCTP],
        },
      },
      [LiquidityPoolUSDC]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.BASE_SEPOLIA]: [Provider.CCTP],
          [Network.OP_SEPOLIA]: [Provider.CCTP],
        },
      },
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3ArbitrumSepolia.POOL_ADDRESSES_PROVIDER,
      MinHealthFactor: 500,
      DefaultLTV: 20,
    },
    USDCPool: true,
  },
  BASE_SEPOLIA: {
    ChainId: 84532,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    AcrossV3SpokePool: "0x82B564983aE7274c86695917BBf8C99ECb6F0F8F",
    Tokens: {
      USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    WrappedNativeToken: "0x4200000000000000000000000000000000000006",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    SetInputOutputTokens: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
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
      [LiquidityPoolAaveUSDC]: {
        [Network.ARBITRUM_SEPOLIA]: [Provider.CCTP],
        [Network.OP_SEPOLIA]: [Provider.CCTP],
      },
      [LiquidityPoolUSDC]: {
        [Network.ARBITRUM_SEPOLIA]: [Provider.CCTP],
        [Network.OP_SEPOLIA]: [Provider.CCTP],
      },
    },
    RepayerRoutes: {
      [LiquidityPoolAaveUSDC]: {
        SupportsAllTokens: true,
        Domains: {
          [Network.ARBITRUM_SEPOLIA]: [Provider.CCTP],
          [Network.OP_SEPOLIA]: [Provider.CCTP],
        },
      },
      [LiquidityPoolUSDC]: {
        SupportsAllTokens: false,
        Domains: {
          [Network.ARBITRUM_SEPOLIA]: [Provider.CCTP],
          [Network.OP_SEPOLIA]: [Provider.CCTP],
        },
      },
    },
    AavePool: {
      AaveAddressesProvider: AAVEPools.AaveV3BaseSepolia.POOL_ADDRESSES_PROVIDER,
      MinHealthFactor: 500,
      DefaultLTV: 20,
    },
    USDCPool: true,
  },
  POLYGON_AMOY: {
    ChainId: 80002,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    AcrossV3SpokePool: "0xd08baaE74D6d2eAb1F3320B2E1a53eeb391ce8e5",
    Tokens: {
      USDC: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
    },
    WrappedNativeToken: "0x0000000000000000000000000000000000000000",
    IsTest: true,
    Admin: "0xcf2d403c75ba3481ae7b190b1cd3246b5afe9120",
    WithdrawProfit: "0xed24c1ca7c8d01c4ba862c6792ad6144f01566f2",
    Pauser: "0xcc5dd1eec29dbe028e61e91db5da4d453be48d90",
    RebalanceCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    RepayerCaller: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    SetInputOutputTokens: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
    MpcAddress: "0x6adAF8c96151962198a9b73132c16E99F4682Eb5",
    SignerAddress: "0x20ad9b208767e98dba19346f88b2686f00dbcf58",
  },
};

export enum StandaloneRepayerEnv {
  SparkStage = "SparkStage",
};

export interface StandaloneRepayerConfig {
  ChainId: number;
  CCTP: CCTPConfig;
  AcrossV3SpokePool?: string;
  StargateTreasurer?: string;
  EverclearFeeAdapter?: string;
  OptimismStandardBridge?: string;
  BaseStandardBridge?: string;
  // Repayer tokens are used from the general network config.
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
      ChainId: 8453,
      CCTP: {
        TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
        MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
      },
      AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      StargateTreasurer: "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
      EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      RepayerRoutes: {
        "0xa21007B5BC5E2B488063752d1BE43C0f3f376743": {
          SupportsAllTokens: true,
          Domains: {
            [Network.BASE]: [Provider.LOCAL],
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.STARGATE, Provider.EVERCLEAR],
            [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.STARGATE, Provider.EVERCLEAR],
          },
        },
      },
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
  ARBITRUM_ONE: {
    SparkStage: {
      ChainId: 42161,
      CCTP: {
        TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
        MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
      },
      AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
      StargateTreasurer: "0x146c8e409C113ED87C6183f4d25c50251DFfbb3a",
      EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
      WrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      RepayerRoutes: {
        "0xa21007B5BC5E2B488063752d1BE43C0f3f376743": {
          SupportsAllTokens: true,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.LOCAL],
            [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.STARGATE, Provider.EVERCLEAR],
            [Network.OP_MAINNET]: [Provider.CCTP, Provider.ACROSS, Provider.STARGATE, Provider.EVERCLEAR],
          },
        },
      },
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
  OP_MAINNET: {
    SparkStage: {
      ChainId: 10,
      CCTP: {
        TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
        MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
      },
      AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
      StargateTreasurer: "0x644abb1e17291b4403966119d15Ab081e4a487e9",
      EverclearFeeAdapter: "0xd0185bfb8107c5b2336bC73cE3fdd9Bfb504540e",
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      RepayerRoutes: {
        "0xa21007B5BC5E2B488063752d1BE43C0f3f376743": {
          SupportsAllTokens: true,
          Domains: {
            [Network.OP_MAINNET]: [Provider.LOCAL],
            [Network.ARBITRUM_ONE]: [Provider.CCTP, Provider.ACROSS, Provider.STARGATE, Provider.EVERCLEAR],
            [Network.BASE]: [Provider.CCTP, Provider.ACROSS, Provider.STARGATE, Provider.EVERCLEAR],
          },
        },
      },
      IsTest: false,
      Admin: "0x2D5B6C193C39D2AECb4a99052074E6F325258a0f",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
};
