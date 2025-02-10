import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {networkConfig, Network} from "./network.config";

import dotenv from "dotenv";

dotenv.config();

function isSet(param?: string) {
  return param && param.length > 0;
}

const accounts: string[] = isSet(process.env.DEPLOYER_PRIVATE_KEY) ? [process.env.DEPLOYER_PRIVATE_KEY || ""] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 999999,
      },
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545/",
    },
    [Network.BASE_SEPOLIA]: {
      chainId: networkConfig.BASE_SEPOLIA.chainId,
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts,
    },
    [Network.ETHEREUM_SEPOLIA]: {
      chainId: networkConfig.ETHEREUM_SEPOLIA.chainId,
      url: process.env.ETHEREUM_SEPOLIA_RPC || "",
      accounts,
    },
    hardhat: {
      forking: {
        url: `${process.env.FORK_PROVIDER}`,
      },
    },
  },
  sourcify: {
    enabled: false,
  },
  etherscan: {
    apiKey: {
      baseSepolia: process.env.ETHERSCAN_BASE_SEPOLIA || "",
      sepolia: process.env.ETHERSCAN_ETHEREUM_SEPOLIA || "",
    },
  },
};

export default config;
