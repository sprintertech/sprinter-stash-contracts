import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

import dotenv from "dotenv";

dotenv.config();

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
