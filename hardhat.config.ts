import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {networkConfig, Network} from "./network.config";

import dotenv from "dotenv";

dotenv.config();

function isSet(param?: string) {
  return param && param.length > 0;
}

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
      url: "https://sepolia.base.org",
      accounts:
        isSet(process.env.DEPLOYER_PRIVATE_KEY) ? [process.env.DEPLOYER_PRIVATE_KEY || ""] : [],
    },
    hardhat: {
      forking: {
        url: `${process.env.FORK_PROVIDER}`,
      },
    },
  },
  sourcify: {
    enabled: true,
  },
};

export default config;
