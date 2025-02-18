import {HardhatUserConfig, task, types} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {networkConfig, Network, Provider} from "./network.config";
import {TypedDataDomain, resolveAddress} from "ethers";
import {
  LiquidityPool, Rebalancer,
} from "./typechain-types";
import {
  assert, isSet, ProviderSolidity, DomainSolidity,
} from "./scripts/common";

import dotenv from "dotenv";

dotenv.config();

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
.addOptionalParam("ltv", "New default LTV value", 20n * 10n**16n, types.bigint)
.setAction(async ({pool, ltv}: {pool?: string, ltv: bigint}, hre) => {
  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveAddress(pool || process.env.LIQUIDITY_POOL || "");
  const target = (await hre.ethers.getContractAt("LiquidityPool", targetAddress, admin)) as LiquidityPool;

  await target.setDefaultLTV(ltv);
  console.log(`Default LTV set to ${ltv} on ${targetAddress}.`);
});

task("set-token-ltv", "Update Liquidity Pool config")
.addParam("token", "Token to update LTV for")
.addOptionalParam("pool", "Liquidity Pool address")
.addOptionalParam("ltv", "New LTV value", 20n * 10n**16n, types.bigint)
.setAction(async ({token, pool, ltv}: {token: string, pool?: string, ltv: bigint}, hre) => {
  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveAddress(pool || process.env.LIQUIDITY_POOL || "");
  const target = (await hre.ethers.getContractAt("LiquidityPool", targetAddress, admin)) as LiquidityPool;

  await target.setBorrowTokenLTV(token, ltv);
  console.log(`Token ${token} LTV set to ${ltv} on ${targetAddress}.`);
});

task("set-min-health-factor", "Update Liquidity Pool config")
.addOptionalParam("pool", "Liquidity Pool address")
.addOptionalParam("healthfactor", "New min health factor value", 500n * 10n**16n, types.bigint)
.setAction(async ({pool, healthfactor}: {pool?: string, healthfactor: bigint}, hre) => {
  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveAddress(pool || process.env.LIQUIDITY_POOL || "");
  const target = (await hre.ethers.getContractAt("LiquidityPool", targetAddress, admin)) as LiquidityPool;

  await target.setHealthFactor(healthfactor);
  console.log(`Min health factor set to ${healthfactor} on ${targetAddress}.`);
});

task("set-routes", "Update Rebalancer config")
.addOptionalParam("rebalancer", "Rebalancer address")
.addOptionalParam("domains", "Comma separated list of domain names")
.addOptionalParam("providers", "Comma separated list of provider names")
.addOptionalParam("allowed", "Allowed or denied", true, types.boolean)
.setAction(async (args: {rebalancer?: string, providers?: string, domains?: string, allowed: boolean}, hre) => {
  const config = networkConfig[hre.network.name as Network];

  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveAddress(args.rebalancer || process.env.REBALANCER || "");
  const target = (await hre.ethers.getContractAt("Rebalancer", targetAddress, admin)) as Rebalancer;

  const domains = args.domains && args.domains.split(",") || config.Routes?.Domains || [];
  const domainsSolidity = domains.map(el => {
    assert(Object.values(Network).includes(el as Network), `Invalid domain ${el}`);
    return DomainSolidity[el as Network];
  });
  const providers = args.providers && args.providers.split(",") || config.Routes?.Providers || [];
  const providersSolidity = providers.map(el => {
    assert(Object.values(Provider).includes(el as Provider), `Invalid provider ${el}`);
    return ProviderSolidity[el as Provider];
  });
  await target.setRoute(domainsSolidity, providersSolidity, args.allowed);
  console.log(`Following routes are ${args.allowed ? "" : "dis"}allowed on ${targetAddress}.`);
  console.table({domains, providers});
});

task("sign-borrow", "Sign a Liquidity Pool borrow request for testing purposes")
.addOptionalParam("token", "Token to borrow")
.addOptionalParam("amount", "Amount to borrow in base units", 1000000n, types.bigint)
.addOptionalParam("target", "Target address to approve and call")
.addOptionalParam("data", "Data to call target with")
// By default produces a new nonce every 10 seconds.
.addOptionalParam("nonce", "Reuse protection nonce", BigInt(Date.now()) / 1000n / 10n, types.bigint)
.addOptionalParam("deadline", "Expiry protection timestamp", 2000000000n, types.bigint)
.addOptionalParam("pool", "Liquidity Pool address")
.setAction(async (args: {
  token?: string,
  amount: bigint,
  target?: string,
  data?: string,
  nonce: bigint,
  deadline: bigint,
  pool?: string,
}, hre) => {
  const config = networkConfig[hre.network.name as Network];

  const [signer] = await hre.ethers.getSigners();

  const name = "LiquidityPool";
  const version = "1.0.0";

  const pool = args.pool || process.env.LIQUIDITY_POOL;
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
  const amount = args.amount;
  const target = args.target || borrowToken;
  const data = args.data || (await token.transfer.populateTransaction(signer.address, amount)).data;
  const nonce = args.nonce;
  const deadline = args.deadline;
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
    [Network.ARBITRUM_SEPOLIA]: {
      chainId: networkConfig.ARBITRUM_SEPOLIA.chainId,
      url: process.env.ARBITRUM_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
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
      arbitrumSepolia: process.env.ETHERSCAN_ARBITRUM_SEPOLIA || "",
    },
  },
};

export default config;
