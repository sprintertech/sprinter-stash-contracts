import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

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
    basetest: {
      chainId: 84532,
      url: "https://sepolia.base.org",
      accounts:
        isSet(process.env.BASETEST_PRIVATE_KEY) ? [process.env.BASETEST_PRIVATE_KEY || ""] : [],
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
