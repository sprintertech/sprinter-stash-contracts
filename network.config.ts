import * as AAVEPools from "@bgd-labs/aave-address-book";

export const LiquidityPoolAaveUSDC: string = "LiquidityPoolAaveUSDC";
export const LiquidityPoolUSDC: string = "LiquidityPoolUSDC";

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
};

interface CCTPConfig {
  TokenMessenger: string;
  MessageTransmitter: string;
};

interface RoutesConfig {
  Pools: string[];
  Domains: Network[];
  Providers: Provider[];
}

export interface NetworkConfig {
  chainId?: number;
  CCTP: CCTPConfig;
  USDC: string;
  Routes?: RoutesConfig;
  IsTest: boolean;
  IsHub: boolean;
  Aave?: string;
  ExtraUSDCPool?: boolean;
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
    USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    IsTest: false,
    IsHub: false,
    Routes: {
      Pools: [LiquidityPoolAaveUSDC],
      Domains: [Network.BASE],
      Providers: [Provider.CCTP],
    },
    Aave: AAVEPools.AaveV3Ethereum.POOL_ADDRESSES_PROVIDER,
  },
  AVALANCHE: {
    chainId: 43114,
    CCTP: {
      TokenMessenger: "0x6b25532e1060ce10cc3b0a99e5683b91bfde6982",
      MessageTransmitter: "0x8186359af5f57fbb40c6b14a588d2a59c0c29880",
    },
    USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    IsTest: false,
    IsHub: false,
    Aave: AAVEPools.AaveV3Avalanche.POOL_ADDRESSES_PROVIDER,
  },
  OP_MAINNET: {
    chainId: 10,
    CCTP: {
      TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
      MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
    },
    USDC: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    IsTest: false,
    IsHub: false,
    Aave: AAVEPools.AaveV3Optimism.POOL_ADDRESSES_PROVIDER,
  },
  ARBITRUM_ONE: {
    chainId: 42161,
    CCTP: {
      TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
      MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
    },
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    IsTest: false,
    IsHub: false,
    Aave: AAVEPools.AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,
  },
  BASE: {
    chainId: 8453,
    CCTP: {
      TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
      MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
    },
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    IsTest: false,
    IsHub: true,
    Routes: {
      Pools: [LiquidityPoolAaveUSDC],
      Domains: [Network.ETHEREUM],
      Providers: [Provider.CCTP],
    },
    Aave: AAVEPools.AaveV3Base.POOL_ADDRESSES_PROVIDER,
  },
  POLYGON_MAINNET: {
    chainId: 137,
    CCTP: {
      TokenMessenger: "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE",
      MessageTransmitter: "0xF3be9355363857F3e001be68856A2f96b4C39Ba9",
    },
    USDC: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    IsTest: false,
    IsHub: false,
    Aave: AAVEPools.AaveV3Polygon.POOL_ADDRESSES_PROVIDER,
  },
  ETHEREUM_SEPOLIA: {
    chainId: 11155111,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    IsTest: true,
    IsHub: false,
    Routes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE_SEPOLIA, Network.ARBITRUM_SEPOLIA, Network.BASE_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP],
    },
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
    IsHub: false,
    Aave: AAVEPools.AaveV3Fuji.POOL_ADDRESSES_PROVIDER,
  },
  OP_SEPOLIA: {
    chainId: 11155420,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    USDC: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    IsTest: true,
    IsHub: false,
    Aave: AAVEPools.AaveV3OptimismSepolia.POOL_ADDRESSES_PROVIDER,
  },
  ARBITRUM_SEPOLIA: {
    chainId: 421614,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0xaCF1ceeF35caAc005e15888dDb8A3515C41B4872",
    },
    USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    IsTest: true,
    IsHub: false,
    Routes: {
      Pools: [LiquidityPoolAaveUSDC, LiquidityPoolUSDC, LiquidityPoolUSDC],
      Domains: [Network.BASE_SEPOLIA, Network.ETHEREUM_SEPOLIA, Network.BASE_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP, Provider.CCTP],
    },
    Aave: AAVEPools.AaveV3ArbitrumSepolia.POOL_ADDRESSES_PROVIDER,
  },
  BASE_SEPOLIA: {
    chainId: 84532,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    IsTest: true,
    IsHub: true,
    Routes: {
      Pools: [LiquidityPoolUSDC, LiquidityPoolAaveUSDC],
      Domains: [Network.ETHEREUM_SEPOLIA, Network.ARBITRUM_SEPOLIA],
      Providers: [Provider.CCTP, Provider.CCTP],
    },
    Aave: AAVEPools.AaveV3BaseSepolia.POOL_ADDRESSES_PROVIDER,
    ExtraUSDCPool: true,
  },
  POLYGON_AMOY: {
    chainId: 80002,
    CCTP: {
      TokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      MessageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
    },
    USDC: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
    IsTest: true,
    IsHub: false,
  },
};
