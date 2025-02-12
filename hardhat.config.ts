import {HardhatUserConfig, task} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {networkConfig, Network} from "./network.config";
import {TypedDataDomain} from "ethers";
import {
  LiquidityPool,
} from "./typechain-types";

import dotenv from "dotenv";

dotenv.config();

function isSet(param?: string) {
  return param && param.length > 0;
}

task("grant-role", "Grant some role on some AccessControl")
.addParam("contract", "AccessControl-like contract address")
.addParam("role", "Human readable role to be converted to bytes32")
.addParam("actor", "Wallet address that should get the role")
.setAction(async ({contract, role, actor}: {contract: string, role: string, actor: string}, hre) => {
  const [admin] = await hre.ethers.getSigners();

  const target = await hre.ethers.getContractAt("AccessControl", contract, admin);

  await target.grantRole(hre.ethers.encodeBytes32String(role), actor);
  console.log(`Role ${role} granted to ${actor} on ${contract}.`);
});

task("set-default-ltv", "Update Liquidity Pool config")
.addOptionalParam("pool", "Liquidity Pool address")
.addOptionalParam("ltv", "New default LTV value")
.setAction(async ({pool, ltv}: {pool?: string, ltv?: string}, hre) => {
  const [admin] = await hre.ethers.getSigners();

  const targetAddress = pool || "0xB44aEaB4843094Dd086c26dD6ce284c417436Deb";
  const target = (await hre.ethers.getContractAt("LiquidityPool", targetAddress, admin)) as LiquidityPool;

  const newLtv = ltv || "2000";
  await target.setDefaultLTV(newLtv);
  console.log(`Default LTV set to ${newLtv} on ${pool}.`);
});

task("sign-borrow", "Sign a Liquidity Pool borrow request for testing purposes")
.addOptionalParam("token", "Token to borrow")
.addOptionalParam("amount", "Amount to borrow in base units")
.addOptionalParam("target", "Target address to approve and call")
.addOptionalParam("data", "Data to call target with")
.addOptionalParam("nonce", "Reuse protection nonce")
.addOptionalParam("deadline", "Expiry protection timestamp")
.addOptionalParam("pool", "Liquidity Pool address")
.setAction(async (args: {
  token?: string,
  amount?: string,
  target?: string,
  data?: string,
  nonce?: string,
  deadline?: string,
  pool?: string,
}, hre) => {
  const config = networkConfig[hre.network.name as Network];

  const [signer] = await hre.ethers.getSigners();

  const name = "LiquidityPool";
  const version = "1.0.0";

  const pool = args.pool || "0xB44aEaB4843094Dd086c26dD6ce284c417436Deb";
  const domain: TypedDataDomain = {
    name,
    version,
    chainId: hre.network.config.chainId,
    verifyingContract: pool,
  };

  const types = {
    Borrow: [
      {name: "borrowToken", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "target", type: "address"},
      {name: "targetCallData", type: "bytes"},
      {name: "nonce", type: "uint256"},
      {name: "deadline", type: "uint256"},
    ],
  };

  const token = await hre.ethers.getContractAt("IERC20", hre.ethers.ZeroAddress, signer);
  const borrowToken = args.token || config.USDC;
  const amount = args.amount || "1000000";
  const target = args.target || borrowToken;
  const data = args.data || (await token.transferFrom.populateTransaction(pool, signer.address, amount)).data;
  const nonce = args.nonce || `${Date.now()}`;
  const deadline = args.deadline || "2000000000";
  const value = {
    borrowToken,
    amount,
    target,
    targetCallData: data,
    nonce,
    deadline,
  };

  const sig = await signer.signTypedData(domain, types, value);

  console.log(`borrowToken: ${borrowToken}`);
  console.log(`amount: ${amount}`);
  console.log(`target: ${target}`);
  console.log(`targetCallData: ${data}`);
  console.log(`nonce: ${nonce}`);
  console.log(`deadline: ${deadline}`);
  console.log(`signature: ${sig}`);
});

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
        url: process.env.FORK_PROVIDER || "https://eth-mainnet.public.blastapi.io",
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
