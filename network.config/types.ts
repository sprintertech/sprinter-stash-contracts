export enum Network {
  ETHEREUM = "ETHEREUM",
  AVALANCHE = "AVALANCHE",
  OP_MAINNET = "OP_MAINNET",
  ARBITRUM_ONE = "ARBITRUM_ONE",
  BASE = "BASE",
  POLYGON_MAINNET = "POLYGON_MAINNET",
  UNICHAIN = "UNICHAIN",
  BSC = "BSC",
  LINEA = "LINEA",
  GNOSIS_CHAIN = "GNOSIS_CHAIN",
  WORLD_CHAIN = "WORLD_CHAIN",
  INK = "INK",
  HYPER_EVM = "HYPER_EVM",
  TEMPO = "TEMPO",
  STABLE = "STABLE",
  TRON = "TRON",
}

export enum Provider {
  LOCAL = "LOCAL",
  CCTP = "CCTP",
  ACROSS = "ACROSS",
  EVERCLEAR_DEPRECATED = "EVERCLEAR_DEPRECATED",
  STARGATE = "STARGATE",
  SUPERCHAIN_STANDARD_BRIDGE = "SUPERCHAIN_STANDARD_BRIDGE",
  ARBITRUM_GATEWAY = "ARBITRUM_GATEWAY",
  GNOSIS_OMNIBRIDGE = "GNOSIS_OMNIBRIDGE",
  USDT0 = "USDT0",
  CCTP_V2 = "CCTP_V2",
}

export enum Token {
  USDC = "USDC",
  USDT = "USDT",
  DAI = "DAI",
  WETH = "WETH",
  WBTC = "WBTC",
  EURe = "EURe",
  USDG = "USDG",
  PYUSD = "PYUSD",
}


interface CCTPV2Config {
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
    OnlySupportedToken?: Token; // Omit to accept any repaid token.
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
  DirectBorrowCaller?: string;
}

interface AavePoolLongTermConfig extends AavePoolConfig {
  BorrowLongTermAdmin: string;
  RepayCaller: string;
}

interface ActiveLegacyPoolConfig {
  [Pool: string]: boolean; // SupportsAllTokens
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

type StashDexPools = {
  [key in Token]?: string;
}

interface StashDexRoute {
  TokenIn: Token;
  TokenOut: Token;
  FeeBps: number;
  Processor: string;
}

interface StashDexConfig {
  Oracle: string; // PaxosOracle address.
  Receiver: string; // Address that receives forwarded tokens (eg. Repayer).
  ConfigAdmin: string; // Address holding CONFIG_ROLE — can set pools and routes.
  Forwarder: string; // Address holding FORWARD_ROLE — can call forward().
  Pools: StashDexPools;
  Routes: StashDexRoute[];
}

interface HubConfig {
  AssetsAdjuster: string; // Address that can increase/decrease LP conversion rate.
  DepositProfit: string; // Address that can deposit profit to the Liquidity Pool via Liquidity Hub.
  AssetsLimitSetter: string; // Address that can set assets limit.
  AssetsLimit: number; // Deposits to Liquidity Hub are only allowed till this limit is reached.
  Tiers?: Tier[];
  Pool?: string;
}

// Per-main-asset configuration (e.g. MainAssets.USDC, MainAssets.USDT) — most pool/route
// configuration is specific to which token a given set of Liquidity Pools use as their main asset.
export interface MainAssetConfig {
  Hub?: HubConfig;
  RebalancerRoutes?: RebalancerRoutesConfig;
  AavePool?: AavePoolConfig;
  AavePoolLongTerm?: AavePoolLongTermConfig;
  BasicPool?: boolean;
  StablecoinPool?: boolean;
  PublicPool?: PublicPoolConfig;
  ERC4626AdapterTargetVault?: string;
  ActiveLegacyPools?: ActiveLegacyPoolConfig;
}

export type TokenInfo = {
  Address: string;
  Decimals: number;
}

export function tokenInfo(address: string, decimals: number): TokenInfo {
  return {
    Address: address,
    Decimals: decimals,
  };
}

export interface NetworkConfig {
  ChainId: number;
  CCTPV2?: CCTPV2Config;
  AcrossV3SpokePool?: string;
  StargateTreasurer?: string;
  OptimismStandardBridge?: string;
  BaseStandardBridge?: string;
  ArbitrumGatewayRouter?: string;
  Omnibridge?: string;
  GnosisAMB?: string;
  GnosisUSDCxDAI?: string;
  GnosisUSDCTransmuter?: string;
  USDT0OFT?: string;
  // Set only on chains whose USDT0 OFT requires LayerZero fees to be paid in an ERC-20 token
  // (i.e. USDT0OFT.nativeToken() returns a non-zero address) instead of native currency.
  USDT0FeeNativeToken?: string;
  Tokens: {
    [key in Token]?: TokenInfo;
  };
  WrappedNativeToken: string;
  RepayerRoutes?: RepayerRoutesConfig;
  Admin: string; // Every contracts admin/owner.
  WithdrawProfit: string;
  Pauser: string;
  RebalanceCaller: string; // Address that can trigger funds movement between pools.
  RepayerCaller: string;
  SetInputOutputTokens: string;
  MpcAddress: string;
  SignerAddress: string;
  // Configuration specific to which token a set of Liquidity Pools use as their main asset.
  MainAssets: {
    [key in Token]?: MainAssetConfig;
  };
  StashDex?: StashDexConfig;
}

export type NetworksConfig = {
  [key in Network]: NetworkConfig;
};

export type PartialNetworksConfig = {
  [key in Network]?: NetworkConfig;
};

export enum StandaloneRepayerEnv {
  SparkStage = "SparkStage",
};

export interface StandaloneRepayerConfig {
  ChainId: number;
  CCTPV2?: CCTPV2Config;
  AcrossV3SpokePool?: string;
  StargateTreasurer?: string;
  OptimismStandardBridge?: string;
  BaseStandardBridge?: string;
  ArbitrumGatewayRouter?: string;
  Omnibridge?: string;
  GnosisUSDCxDAI?: string;
  GnosisUSDCTransmuter?: string;
  GnosisAMB?: string;
  USDT0OFT?: string;
  USDT0FeeNativeToken?: string;
  // Repayer tokens are used from the general network config.
  WrappedNativeToken: string;
  RepayerRoutes: RepayerRoutesConfig;
  Admin: string;
  RepayerCallers: string[];
};

export type StandaloneRepayersConfig = {
  [key in Network]?: {
    [key in StandaloneRepayerEnv]?: StandaloneRepayerConfig;
  };
};
