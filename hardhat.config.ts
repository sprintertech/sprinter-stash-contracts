import {HardhatUserConfig, task, types} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {networkConfig, Network, Provider} from "./network.config";
import {TypedDataDomain} from "ethers";
import {
  LiquidityPoolAave, Rebalancer,
} from "./typechain-types";
import {
  assert, isSet, ProviderSolidity, DomainSolidity,
} from "./scripts/common";

import dotenv from "dotenv";
dotenv.config();

// Got to use lazy loading because HRE is only becomes available inside the tasks.
async function loadTestHelpers() {
  return await import("./test/helpers");
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
.addOptionalParam("pool", "Liquidity Pool proxy address or id", "LiquidityPoolAaveUSDC", types.string)
.addOptionalParam("ltv", "New default LTV value, where 10000 is 100%", 2000n, types.bigint)
.setAction(async ({pool, ltv}: {pool: string, ltv: bigint}, hre) => {
  const {resolveXAddress} = await loadTestHelpers();
  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveXAddress(pool);
  const target = (await hre.ethers.getContractAt("LiquidityPoolAave", targetAddress, admin)) as LiquidityPoolAave;

  await target.setDefaultLTV(ltv);
  console.log(`Default LTV set to ${ltv} on ${targetAddress}.`);
});

task("set-token-ltvs", "Update Liquidity Pool config")
.addParam("tokens", "Comma separated list of tokens to update LTV for")
.addParam("ltvs", "Comma separated list of new LTV values where 10000 is 100%")
.addOptionalParam("pool", "Liquidity Pool proxy address or id", "LiquidityPoolAaveUSDC", types.string)
.setAction(async (args: {tokens: string, ltvs: string, pool: string}, hre) => {
  const {resolveXAddress} = await loadTestHelpers();
  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveXAddress(args.pool);
  const target = (await hre.ethers.getContractAt("LiquidityPoolAave", targetAddress, admin)) as LiquidityPoolAave;

  const tokens = args.tokens && args.tokens.split(",") || [];
  const ltvs = args.ltvs && args.ltvs.split(",") || [];

  await target.setBorrowTokenLTVs(tokens, ltvs);
  console.log(`Following tokens LTVs set on ${targetAddress}:`);
  console.table({tokens, ltvs});
});

task("set-min-health-factor", "Update Liquidity Pool config")
.addOptionalParam("pool", "Liquidity Pool proxy address or id", "LiquidityPoolAaveUSDC", types.string)
.addOptionalParam("healthfactor", "New min health factor value, where 10000 is 1", 50000n, types.bigint)
.setAction(async ({pool, healthfactor}: {pool: string, healthfactor: bigint}, hre) => {
  const {resolveXAddress} = await loadTestHelpers();
  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveXAddress(pool);
  const target = (await hre.ethers.getContractAt("LiquidityPoolAave", targetAddress, admin)) as LiquidityPoolAave;

  await target.setMinHealthFactor(healthfactor);
  console.log(`Min health factor set to ${healthfactor} on ${targetAddress}.`);
});

task("set-routes", "Update Rebalancer config")
.addOptionalParam("rebalancer", "Rebalancer address or id", "Rebalancer", types.string)
.addOptionalParam("pools", "Comma separated list of Liquidity Pool ids or addresses")
.addOptionalParam("domains", "Comma separated list of domain names")
.addOptionalParam("providers", "Comma separated list of provider names")
.addOptionalParam("allowed", "Allowed or denied", true, types.boolean)
.setAction(async (args: {
  rebalancer: string,
  pools?: string,
  domains?: string,
  providers?: string,
  allowed: boolean,
}, hre) => {
  const {resolveProxyXAddress} = await loadTestHelpers();
  const config = networkConfig[hre.network.name as Network];

  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveProxyXAddress(args.rebalancer);
  const target = (await hre.ethers.getContractAt("Rebalancer", targetAddress, admin)) as Rebalancer;

  const targetPools = args.pools && args.pools.split(",") || [];
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

  await target.setRoute(targetPools, domainsSolidity, providersSolidity, args.allowed);
  console.log(`Following routes are ${args.allowed ? "" : "dis"}allowed on ${targetAddress}.`);
  console.table({domains, providers});
});

task("sign-borrow", "Sign a Liquidity Pool borrow request for testing purposes")
.addParam("caller", "Address that will call borrow or borrowAndSwap")
.addOptionalParam("token", "Token to borrow")
.addOptionalParam("amount", "Amount to borrow in base units", 1000000n, types.bigint)
.addOptionalParam("target", "Target address to approve and call")
.addOptionalParam("data", "Data to call target with")
// By default produces a new nonce every 10 seconds.
.addOptionalParam("nonce", "Reuse protection nonce", BigInt(Date.now()) / 1000n / 10n, types.bigint)
.addOptionalParam("deadline", "Expiry protection timestamp", 2000000000n, types.bigint)
.addOptionalParam("pool", "Liquidity Pool proxy address or id", "LiquidityPool", types.string)
.setAction(async (args: {
  caller: string,
  token?: string,
  amount: bigint,
  target?: string,
  data?: string,
  nonce: bigint,
  deadline: bigint,
  pool: string,
}, hre) => {
  const {resolveProxyXAddress} = await loadTestHelpers();
  const config = networkConfig[hre.network.name as Network];

  const [signer] = await hre.ethers.getSigners();

  const name = "LiquidityPool";
  const version = "1.0.0";

  const pool = await resolveProxyXAddress(args.pool);
  const domain: TypedDataDomain = {
    name,
    version,
    chainId: hre.network.config.chainId,
    verifyingContract: pool,
  };

  const types = {
    Borrow: [
      {name: "caller", type: "address"},
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
    caller: args.caller,
    borrowToken,
    amount,
    target,
    targetCallData: data,
    nonce,
    deadline,
  };

  const sig = await signer.signTypedData(domain, types, value);

  console.log(`caller: ${args.caller}`);
  console.log(`borrowToken: ${borrowToken}`);
  console.log(`amount: ${amount}`);
  console.log(`target: ${target}`);
  console.log(`targetCallData: ${data}`);
  console.log(`nonce: ${nonce}`);
  console.log(`deadline: ${deadline}`);
  console.log(`signature: ${sig}`);
});

const accounts: string[] = isSet(process.env.PRIVATE_KEY) ? [process.env.PRIVATE_KEY || ""] : [];

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
    [Network.OP_SEPOLIA]: {
      chainId: networkConfig.OP_SEPOLIA.chainId,
      url: process.env.OP_SEPOLIA_RPC || "https://sepolia.optimism.io",
      accounts,
    },
    [Network.BASE]: {
      chainId: networkConfig.BASE.chainId,
      url: process.env.BASE_RPC || "https://base-mainnet.public.blastapi.io",
      accounts,
    },
    [Network.ETHEREUM]: {
      chainId: networkConfig.ETHEREUM.chainId,
      url: process.env.ETHEREUM_RPC || "https://eth-mainnet.public.blastapi.io",
      accounts,
    },
    [Network.ARBITRUM_ONE]: {
      chainId: networkConfig.ARBITRUM_ONE.chainId,
      url: process.env.ARBITRUM_ONE_RPC || "https://arbitrum-one.public.blastapi.io",
      accounts,
    },
    [Network.OP_MAINNET]: {
      chainId: networkConfig.OP_MAINNET.chainId,
      url: process.env.OP_MAINNET_RPC || "https://optimism-mainnet.public.blastapi.io",
      accounts,
    },
    hardhat: {
      forking: {
        url: isSet(process.env.DRY_RUN)
          ? process.env[`${process.env.DRY_RUN}_RPC`]!
          : (process.env.FORK_PROVIDER || "https://eth-mainnet.public.blastapi.io"),
      },
      accounts: isSet(process.env.DRY_RUN)
        ? [{privateKey: process.env.PRIVATE_KEY!, balance: "1000000000000000000"}]
        : undefined,
      chains: isSet(process.env.DRY_RUN) // https://github.com/NomicFoundation/hardhat/issues/5511
        ? {[networkConfig[`${process.env.DRY_RUN}` as Network]!.chainId]: {hardforkHistory: {cancun: 0}}}
        : undefined,
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
      opSepolia: process.env.ETHERSCAN_OP_SEPOLIA || "",
      base: process.env.ETHERSCAN_BASE || "",
      mainnet: process.env.ETHERSCAN_ETHEREUM || "",
      arbitrumOne: process.env.ETHERSCAN_ARBITRUM_ONE || "",
      optimisticEthereum: process.env.ETHERSCAN_OP_MAINNET || "",
    },
    customChains: [
      {
        network: "opSepolia",
        chainId: networkConfig.OP_SEPOLIA.chainId,
        urls: {
          apiURL: "https://api-sepolia-optimism.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io"
        },
      },
    ],
  },
};

export default config;
