import {HardhatUserConfig, task, types} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {
  networkConfig, Network, Provider,
} from "./network.config";
import {TypedDataDomain, AbiCoder, toNumber, dataSlice, getAddress} from "ethers";
import {
  LiquidityPoolAave, Rebalancer, Repayer
} from "./typechain-types";
import {
  assert, isSet, ProviderSolidity, DomainSolidity, CCTPDomain, SolidityDomain, SolidityProvider,
  DEFAULT_ADMIN_ROLE,
} from "./scripts/common";
import "hardhat-ignore-warnings";

import dotenv from "dotenv";
dotenv.config();

// Got to use lazy loading because HRE is only becomes available inside the tasks.
async function loadTestHelpers() {
  return await import("./test/helpers");
}

async function loadScriptHelpers() {
  return await import("./scripts/helpers");
}

function sortRoutes(routes: {Pool: string, Domain: Network, Provider: Provider, SupportsAllTokens?: boolean}[]): void {
  routes.sort((a, b) => `${a.Pool}${a.Domain}${a.Provider}`.localeCompare(`${b.Pool}${b.Domain}${b.Provider}`));
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

task("set-routes-rebalancer", "Update Rebalancer config")
.addOptionalParam("rebalancer", "Rebalancer address or id", "Rebalancer", types.string)
.addParam("pools", "Comma separated list of Liquidity Pool ids or addresses")
.addParam("domains", "Comma separated list of domain names")
.addParam("providers", "Comma separated list of provider names")
.addOptionalParam("allowed", "Allowed or denied", true, types.boolean)
.setAction(async (args: {
  rebalancer: string,
  pools: string,
  domains: string,
  providers: string,
  allowed: boolean,
}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();

  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveProxyXAddress(args.rebalancer);
  const target = (await hre.ethers.getContractAt("Rebalancer", targetAddress, admin)) as Rebalancer;

  const targetPools = args.pools?.split(",") || [];
  const pools = await Promise.all(targetPools.map(el => resolveXAddress(el, false)));
  const domains = args.domains?.split(",") || [];
  const domainsSolidity = domains.map(el => {
    assert(Object.values(Network).includes(el as Network), `Invalid domain ${el}`);
    return DomainSolidity[el as Network];
  });
  const providers = args.providers?.split(",") || [];
  const providersSolidity = providers.map(el => {
    assert(Object.values(Provider).includes(el as Provider), `Invalid provider ${el}`);
    return ProviderSolidity[el as Provider];
  });

  await target.setRoute(pools, domainsSolidity, providersSolidity, args.allowed);
  console.log(`Following routes are ${args.allowed ? "" : "dis"}allowed on ${targetAddress}.`);
  console.table({domains, providers});
});

task("update-routes-rebalancer", "Update Rebalancer routes based on current network config")
.addOptionalParam("rebalancer", "Rebalancer address or id", "Rebalancer", types.string)
.setAction(async (args: {
  rebalancer: string,
}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig, addLocalPools} = await loadScriptHelpers();
  const {network, config} = await getNetworkConfig();

  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveProxyXAddress(args.rebalancer);
  const target = (await hre.ethers.getContractAt("Rebalancer", targetAddress, admin)) as Rebalancer;
  const onchainRoutes = await target.getAllRoutes();
  const onchainConfig: {Pool: string, Domain: Network, Provider: Provider}[] = [];
  for (let i = 0; i < onchainRoutes.pools.length; i++) {
    onchainConfig.push({
      Pool: getAddress(onchainRoutes.pools[i]),
      Domain: SolidityDomain[Number(onchainRoutes.domains[i])],
      Provider: SolidityProvider[Number(onchainRoutes.providers[i])],
    });
  }
  const localConfig: {Pool: string, Domain: Network, Provider: Provider}[] = [];
  for (const [pool, domainProviders] of Object.entries(config.RebalancerRoutes || {})) {
    for (const [domain, providers] of Object.entries(domainProviders) as [Network, Provider[]][]) {
      for (const provider of providers) {
        localConfig.push({
          Pool: await resolveXAddress(pool, false),
          Domain: domain,
          Provider: provider,
        });
      }
    }
  }
  await addLocalPools(config, network, localConfig);
  sortRoutes(onchainConfig);
  sortRoutes(localConfig);

  console.log("The onchain configuration is:");
  console.table(onchainConfig);
  console.log("The updated configuration should be:");
  console.table(localConfig, ["Pool", "Domain", "Provider"]);

  const toAllow = localConfig.filter(el => !onchainConfig.some(el2 =>
    el2.Pool === el.Pool &&
    el2.Domain === el.Domain &&
    el2.Provider === el.Provider
  ));
  const toDeny = onchainConfig.filter(el => !localConfig.some(el2 =>
    el2.Pool === el.Pool &&
    el2.Domain === el.Domain &&
    el2.Provider === el.Provider
  ));

  const hasRole = await target.hasRole(DEFAULT_ADMIN_ROLE, admin.address);

  if (toAllow.length > 0) {
    const toAllowParams = toAllow.map(el => ({
      pools: el.Pool,
      domains: DomainSolidity[el.Domain],
      providers: ProviderSolidity[el.Provider],
    }));
    if (hasRole) {
      await target.setRoute(
        toAllowParams.map(el => el.pools),
        toAllowParams.map(el => el.domains),
        toAllowParams.map(el => el.providers),
        true
      );
      console.log(`Following routes are now allowed on ${targetAddress}.`);
      console.table(toAllow);
    } else {
      console.log("To allow missing routes execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      console.log("Params:");
      console.log("isAllowed: true");
      console.table(toAllowParams);
    }
  } else {
    console.log("There are no missing routes to allow.");
  }

  if (toDeny.length > 0) {
    const toDenyParams = toDeny.map(el => ({
      pools: el.Pool,
      domains: DomainSolidity[el.Domain],
      providers: ProviderSolidity[el.Provider],
    }));
    if (hasRole) {
      await target.setRoute(
        toDenyParams.map(el => el.pools),
        toDenyParams.map(el => el.domains),
        toDenyParams.map(el => el.providers),
        false
      );
      console.log(`Following routes are now denied on ${targetAddress}.`);
      console.table(toDeny);
    } else {
      console.log("To deny excess routes execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      console.log("Params:");
      console.log("isAllowed: false");
      console.table(toDenyParams);
    }
  } else {
    console.log("There are no excess routes to deny.");
  }
});

task("set-routes-repayer", "Update Repayer config")
.addOptionalParam("repayer", "Repayer address or id", "Repayer", types.string)
.addParam("pools", "Comma separated list of Liquidity Pool ids or addresses")
.addParam("domains", "Comma separated list of domain names")
.addParam("providers", "Comma separated list of provider names")
.addParam("supportsalltokens", "Comma separated bool flags whether the pool supports all tokens")
.addOptionalParam("allowed", "Allowed or denied", true, types.boolean)
.setAction(async (args: {
  repayer: string,
  pools: string,
  domains: string,
  providers: string,
  supportsalltokens: string,
  allowed: boolean,
}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();

  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveProxyXAddress(args.repayer);
  const target = (await hre.ethers.getContractAt("Repayer", targetAddress, admin)) as Repayer;

  const targetPools = args.pools?.split(",") || [];
  const pools = await Promise.all(targetPools.map(el => resolveXAddress(el, false)));
  const domains = args.domains?.split(",") || [];
  const domainsSolidity = domains.map(el => {
    assert(Object.values(Network).includes(el as Network), `Invalid domain ${el}`);
    return DomainSolidity[el as Network];
  });
  const providers = args.providers?.split(",") || [];
  const providersSolidity = providers.map(el => {
    assert(Object.values(Provider).includes(el as Provider), `Invalid provider ${el}`);
    return ProviderSolidity[el as Provider];
  });
  const supportsAllTokens = args.supportsalltokens?.split(",") || [];
  const supportsAllTokensBool = supportsAllTokens.map(el => el.toString() === "true");

  await target.setRoute(pools, domainsSolidity, providersSolidity, supportsAllTokensBool, args.allowed);
  console.log(`Following routes are ${args.allowed ? "" : "dis"}allowed on ${targetAddress}.`);
  console.table({domains, providers, allTokens: supportsAllTokensBool});
});

task("update-routes-repayer", "Update Repayer routes based on current network config")
.addOptionalParam("repayer", "Repayer address or id", "Repayer", types.string)
.setAction(async (args: {
  repayer: string,
}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig, addLocalPools} = await loadScriptHelpers();
  const {network, config} = await getNetworkConfig();

  const [admin] = await hre.ethers.getSigners();

  const targetAddress = await resolveProxyXAddress(args.repayer);
  const target = (await hre.ethers.getContractAt("Repayer", targetAddress, admin)) as Repayer;
  const onchainRoutes = await target.getAllRoutes();
  const onchainConfig: {Pool: string, Domain: Network, Provider: Provider, SupportsAllTokens: boolean}[] = [];
  for (let i = 0; i < onchainRoutes.pools.length; i++) {
    onchainConfig.push({
      Pool: getAddress(onchainRoutes.pools[i]),
      Domain: SolidityDomain[Number(onchainRoutes.domains[i])],
      Provider: SolidityProvider[Number(onchainRoutes.providers[i])],
      SupportsAllTokens: onchainRoutes.poolSupportsAllTokens[i],
    });
  }
  const localConfig: {Pool: string, Domain: Network, Provider: Provider, SupportsAllTokens: boolean}[] = [];
  for (const [pool, domainProviders] of Object.entries(config.RepayerRoutes || {})) {
    for (const [domain, providers] of Object.entries(domainProviders.Domains) as [Network, Provider[]][]) {
      for (const provider of providers) {
        localConfig.push({
          Pool: await resolveXAddress(pool, false),
          Domain: domain,
          Provider: provider,
          SupportsAllTokens: domainProviders.SupportsAllTokens,
        });
      }
    }
  }
  await addLocalPools(config, network, localConfig);
  sortRoutes(onchainConfig);
  sortRoutes(localConfig);

  console.log("The onchain configuration is:");
  console.table(onchainConfig);
  console.log("The updated configuration should be:");
  console.table(localConfig);

  const toAllow = localConfig.filter(el => !onchainConfig.some(el2 =>
    el2.Pool === el.Pool &&
    el2.Domain === el.Domain &&
    el2.Provider === el.Provider &&
    el2.SupportsAllTokens === el.SupportsAllTokens
  ));
  const toDeny = onchainConfig.filter(el => !localConfig.some(el2 =>
    el2.Pool === el.Pool &&
    el2.Domain === el.Domain &&
    el2.Provider === el.Provider &&
    el2.SupportsAllTokens === el.SupportsAllTokens
  ));

  const hasRole = await target.hasRole(DEFAULT_ADMIN_ROLE, admin.address);

  // Calling deny first so that allow overrides incorrect SupportsAllTokens flag.
  if (toDeny.length > 0) {
    const toDenyParams = toDeny.map(el => ({
      pools: el.Pool,
      domains: DomainSolidity[el.Domain],
      providers: ProviderSolidity[el.Provider],
      supportsAllTokens: el.SupportsAllTokens,
    }));
    if (hasRole) {
      await target.setRoute(
        toDenyParams.map(el => el.pools),
        toDenyParams.map(el => el.domains),
        toDenyParams.map(el => el.providers),
        toDenyParams.map(el => el.supportsAllTokens),
        false
      );
      console.log(`Following routes are now denied on ${targetAddress}.`);
      console.table(toDeny);
    } else {
      console.log("To deny excess routes execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      console.log("Params:");
      console.log("isAllowed: false");
      console.table(toDenyParams);
    }
  } else {
    console.log("There are no excess routes to deny.");
  }

  if (toAllow.length > 0) {
    const toAllowParams = toAllow.map(el => ({
      pools: el.Pool,
      domains: DomainSolidity[el.Domain],
      providers: ProviderSolidity[el.Provider],
      supportsAllTokens: el.SupportsAllTokens,
    }));
    if (hasRole) {
      await target.setRoute(
        toAllowParams.map(el => el.pools),
        toAllowParams.map(el => el.domains),
        toAllowParams.map(el => el.providers),
        toAllowParams.map(el => el.supportsAllTokens),
        true
      );
      console.log(`Following routes are now allowed on ${targetAddress}.`);
      console.table(toAllow);
    } else {
      console.log("To allow missing routes execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      console.log("Params:");
      console.log("isAllowed: true");
      console.table(toAllowParams);
    }
  } else {
    console.log("There are no missing routes to allow.");
  }
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

interface CCTPMessage {
  attestation: string,
  message: string,
  eventNonce: string,
};

interface CCTPResponseSuccess {
  messages: CCTPMessage[],
};

task("cctp-get-process-data", "Get burn attestation from CCTP Api to mint USDC on destination")
.addParam("txhash", "Hash of the initiate transaction")
.addOptionalParam("adapter", "Rebalancer or Repayer address", "0xA85Cf46c150db2600b1D03E437bedD5513869888")
.setAction(async ({txhash, adapter}: {txhash: string, adapter: string}, hre) => {
  const {resolveProxyXAddress} = await loadTestHelpers();
  assert(txhash.length > 0, "Valid txhash should be provided.");

  const cctpAdapter = await hre.ethers.getContractAt("CCTPAdapter", await resolveProxyXAddress(adapter));
  const cctpDomain = await cctpAdapter.domainCCTP(DomainSolidity[hre.network.name as Network]);

  const url = `https://iris-api.circle.com/v1/messages/${cctpDomain}/${txhash}`;
  const options = {method: "GET", headers: {"Content-Type": "application/json"}};
  const result = await (await fetch(url, options)).json();

  if (result.error) {
    console.error(result.error);
    return;
  }

  const success = result as CCTPResponseSuccess;

  assert(success.messages, `Messages are missing in CCTP response: ${success}`);

  if (!success.messages[0].attestation.startsWith("0x")) {
    console.error("Attestation is not ready:", success.messages[0].attestation);
    return;
  }

  const extraDatas = success.messages.map(el => {
    const destinationCCTP = toNumber(dataSlice(el.message, 8, 12));
    const destination = CCTPDomain[destinationCCTP];
    assert(destination, `Unknown CCTP domain ${destinationCCTP}`);
    return {
      destination,
      extraData: AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [el.message, el.attestation]),
    };
  });

  const count = extraDatas.length;
  console.log(count, `message${count > 1 ? "s" : ""} found.`);
  console.log(extraDatas);
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
      viaIR: true,
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
    [Network.POLYGON_MAINNET]: {
      chainId: networkConfig.POLYGON_MAINNET.chainId,
      url: process.env.POLYGON_MAINNET_RPC || "https://polygon-bor-rpc.publicnode.com",
      accounts,
    },
    [Network.UNICHAIN]: {
      chainId: networkConfig.UNICHAIN.chainId,
      url: process.env.UNICHAIN_RPC || "https://mainnet.unichain.org",
      accounts,
    },
    hardhat: {
      forking: {
        url: isSet(process.env.DRY_RUN) || isSet(process.env.FORK_TEST)
          ? process.env[`${process.env.DRY_RUN || process.env.FORK_TEST}_RPC`]!
          : (process.env.FORK_PROVIDER || process.env.BASE_RPC || "https://base-mainnet.public.blastapi.io"),
      },
      accounts: isSet(process.env.DRY_RUN)
        ? [{privateKey: process.env.PRIVATE_KEY!, balance: "1000000000000000000"}]
        : undefined,
      chains: isSet(process.env.DRY_RUN) // https://github.com/NomicFoundation/hardhat/issues/5511
        ? {[networkConfig[`${process.env.DRY_RUN}` as Network]!.chainId]: {hardforkHistory: {cancun: 0}}}
        : {[networkConfig.BASE.chainId]: {hardforkHistory: {cancun: 0}}},
    },
  },
  sourcify: {
    enabled: false,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "opSepolia",
        chainId: networkConfig.OP_SEPOLIA.chainId,
        urls: {
          apiURL: "https://api-sepolia-optimism.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io"
        },
      },
      {
        network: "unichain",
        chainId: networkConfig.UNICHAIN.chainId,
        urls: {
          apiURL: "https://uniscan.xyz/api",
          browserURL: "https://uniscan.xyz"
        },
      },
    ],
  },
  warnings: {
    "contracts/echidna/**/*": {
      default: "off",
    },
    "@crytic/**/*": {
      default: "off",
    },
  },
};

export default config;
