import {HardhatUserConfig, task, types} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {
  prodNetworkConfig as networkConfig, Network, Provider, Token,
  LiquidityPoolAaveId,
} from "./network.config";
import {TypedDataDomain, AbiCoder, toNumber, dataSlice, getAddress, parseEther, isAddress} from "ethers";
import {
  LiquidityPoolAave, PaxosOracle, Rebalancer, Repayer, StashDex,
} from "./typechain-types";
import {
  assert, isSet, ProviderSolidity, DomainSolidity, CCTPDomain, SolidityDomain, SolidityProvider,
  DEFAULT_ADMIN_ROLE, assertAddress, addressToBytes32, ZERO_ADDRESS,
  sameAddress,
} from "./scripts/common";
import "hardhat-ignore-warnings";
import "solidity-coverage";
import {createSender} from "./scripts/safe";
import "@layerzerolabs/hardhat-deploy";
import "@layerzerolabs/hardhat-tron";

import dotenv from "dotenv";
dotenv.config();

// Got to use lazy loading because HRE is only becomes available inside the tasks.
async function loadTestHelpers() {
  return await import("./test/helpers");
}

async function loadScriptHelpers() {
  return await import("./scripts/helpers");
}

function sortRoutes(
  routes: {Pool: string, Domain: Network, Provider: Provider, OnlySupportedToken?: string}[]
): void {
  routes.sort((a, b) => `${a.Pool}${a.Domain}${a.Provider}`.localeCompare(`${b.Pool}${b.Domain}${b.Provider}`));
}

task("grant-role", "Grant some role on some AccessControl")
.addParam("contract", "AccessControl-like contract address")
.addParam("role", "Human readable role to be converted to bytes32")
.addParam("actor", "Wallet address that should get the role")
.setAction(async ({contract, role, actor}: {contract: string, role: string, actor: string}, hre) => {
  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

  const target = await hre.ethers.getContractAt("AccessControl", contract, admin);

  await target.grantRole(hre.ethers.encodeBytes32String(role), actor);
  console.log(`Role ${role} granted to ${actor} on ${contract}.`);
});

task("set-default-ltv", "Update Liquidity Pool config")
.addOptionalParam("pool", "Liquidity Pool proxy address or id", LiquidityPoolAaveId, types.string)
.addOptionalParam("ltv", "New default LTV value, where 10000 is 100%", 2000n, types.bigint)
.setAction(async ({pool, ltv}: {pool: string, ltv: bigint}, hre) => {
  const {resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig, getMainAsset, idWithMainAsset} = await loadScriptHelpers();
  if (!isAddress(pool)) {
    const {config} = await getNetworkConfig();
    const {mainAsset} = getMainAsset(config);
    pool = idWithMainAsset(mainAsset, pool);
  }
  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

  const targetAddress = await resolveXAddress(pool);
  const target = (await hre.ethers.getContractAt("LiquidityPoolAave", targetAddress, admin)) as LiquidityPoolAave;

  await target.setDefaultLTV(ltv);
  console.log(`Default LTV set to ${ltv} on ${targetAddress}.`);
});

task("set-token-ltvs", "Update Liquidity Pool config")
.addParam("tokens", "Comma separated list of tokens to update LTV for")
.addParam("ltvs", "Comma separated list of new LTV values where 10000 is 100%")
.addOptionalParam("pool", "Liquidity Pool proxy address or id", LiquidityPoolAaveId, types.string)
.setAction(async (args: {tokens: string, ltvs: string, pool: string}, hre) => {
  const {resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig, getMainAsset, idWithMainAsset} = await loadScriptHelpers();
  if (!isAddress(args.pool)) {
    const {config} = await getNetworkConfig();
    const {mainAsset} = getMainAsset(config);
    args.pool = idWithMainAsset(mainAsset, args.pool);
  }
  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

  const targetAddress = await resolveXAddress(args.pool);
  const target = (await hre.ethers.getContractAt("LiquidityPoolAave", targetAddress, admin)) as LiquidityPoolAave;

  const tokens = args.tokens && args.tokens.split(",") || [];
  const ltvs = args.ltvs && args.ltvs.split(",") || [];

  await target.setBorrowTokenLTVs(tokens, ltvs);
  console.log(`Following tokens LTVs set on ${targetAddress}:`);
  console.table({tokens, ltvs});
});

task("set-min-health-factor", "Update Liquidity Pool config")
.addOptionalParam("pool", "Liquidity Pool proxy address or id", LiquidityPoolAaveId, types.string)
.addOptionalParam("healthfactor", "New min health factor value, where 10000 is 1", 50000n, types.bigint)
.setAction(async ({pool, healthfactor}: {pool: string, healthfactor: bigint}, hre) => {
  const {resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig, getMainAsset, idWithMainAsset} = await loadScriptHelpers();
  if (!isAddress(pool)) {
    const {config} = await getNetworkConfig();
    const {mainAsset} = getMainAsset(config);
    pool = idWithMainAsset(mainAsset, pool);
  }
  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

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
  const {getNetworkConfig, getMainAsset, idWithMainAsset} = await loadScriptHelpers();
  if (!isAddress(args.rebalancer)) {
    const {config} = await getNetworkConfig();
    const {mainAsset} = getMainAsset(config);
    args.rebalancer = idWithMainAsset(mainAsset, "Rebalancer");
  }
  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

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
.addOptionalParam("action", "Action to perform, allow, deny, or both (default)", "both", types.string)
.setAction(async (args: {
  rebalancer: string,
  action: string,
}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig, addLocalPools, getMainAsset, idWithMainAsset} = await loadScriptHelpers();
  const {network, config} = await getNetworkConfig();

  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);
  const {mainAsset, mainAssetConfig} = getMainAsset(config);
  if (!isAddress(args.rebalancer)) {
    args.rebalancer = idWithMainAsset(mainAsset, "Rebalancer");
  }
  assert(["allow", "deny", "both"].includes(args.action), "Invalid action");
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
  for (const [pool, domainProviders] of Object.entries(mainAssetConfig?.RebalancerRoutes || {})) {
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

  const hasRole = await target.hasRole(DEFAULT_ADMIN_ROLE, admin);

  if (toAllow.length > 0) {
    const toAllowParams = toAllow.map(el => ({
      pools: el.Pool,
      domains: DomainSolidity[el.Domain],
      providers: ProviderSolidity[el.Provider],
    }));
    if (hasRole && (args.action === "allow" || args.action === "both")) {
      await (await target.setRoute(
        toAllowParams.map(el => el.pools),
        toAllowParams.map(el => el.domains),
        toAllowParams.map(el => el.providers),
        true
      )).wait();
      console.log(`Following routes are now allowed on ${targetAddress}.`);
      console.table(toAllow);
    } else {
      console.log("To allow missing routes execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      console.log("Params:");
      console.log("isAllowed: true");
      console.table(toAllowParams.map(el => ({
        ...el,
        domains: `${el.domains} (${SolidityDomain[Number(el.domains)]})`,
        providers: `${el.providers} (${SolidityProvider[Number(el.providers)]})`,
      })));
      const allowTx = await target.setRoute.populateTransaction(
        toAllowParams.map(el => el.pools),
        toAllowParams.map(el => el.domains),
        toAllowParams.map(el => el.providers),
        true
      );
      console.log(`Raw data: ${allowTx.data}`);
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
    if (hasRole && (args.action === "deny" || args.action === "both")) {
      await (await target.setRoute(
        toDenyParams.map(el => el.pools),
        toDenyParams.map(el => el.domains),
        toDenyParams.map(el => el.providers),
        false
      )).wait();
      console.log(`Following routes are now denied on ${targetAddress}.`);
      console.table(toDeny);
    } else {
      console.log("To deny excess routes execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      console.log("Params:");
      console.log("isAllowed: false");
      console.table(toDenyParams.map(el => ({
        ...el,
        domains: `${el.domains} (${SolidityDomain[Number(el.domains)]})`,
        providers: `${el.providers} (${SolidityProvider[Number(el.providers)]})`,
      })));
      const denyTx = await target.setRoute.populateTransaction(
        toDenyParams.map(el => el.pools),
        toDenyParams.map(el => el.domains),
        toDenyParams.map(el => el.providers),
        false
      );
      console.log(`Raw data: ${denyTx.data}`);
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
.addParam(
  "onlysupportedtokens",
  "Comma separated list of token ids or addresses each pool is restricted to (empty entry = accepts all tokens)"
)
.addOptionalParam("allowed", "Allowed or denied", true, types.boolean)
.setAction(async (args: {
  repayer: string,
  pools: string,
  domains: string,
  providers: string,
  onlysupportedtokens: string,
  allowed: boolean,
}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();

  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

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
  const targetOnlySupportedTokens = args.onlysupportedtokens?.split(",") || [];
  const onlySupportedToken = await Promise.all(
    targetOnlySupportedTokens.map(el => el.trim() ? resolveXAddress(el, false) : ZERO_ADDRESS)
  );

  await target.setRoute(pools, domainsSolidity, providersSolidity, onlySupportedToken, args.allowed);
  console.log(`Following routes are ${args.allowed ? "" : "dis"}allowed on ${targetAddress}.`);
  console.table({domains, providers, onlySupportedToken});
});

task("update-routes-repayer", "Update Repayer routes based on current network config")
.addOptionalParam("repayer", "Repayer address or id", "Repayer", types.string)
.addOptionalParam("action", "Action to perform, allow, deny, or both (default)", "both", types.string)
.setAction(async (args: {
  repayer: string,
  action: string,
}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig, addLocalPools, resolveOnlySupportedToken} = await loadScriptHelpers();
  const {network, config} = await getNetworkConfig();

  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

  assert(["allow", "deny", "both"].includes(args.action), "Invalid action");
  const targetAddress = await resolveProxyXAddress(args.repayer);
  const target = (await hre.ethers.getContractAt("Repayer", targetAddress, admin)) as Repayer;
  const onchainRoutes = await target.getAllRoutes();
  const onchainConfig: {Pool: string, Domain: Network, Provider: Provider, OnlySupportedToken: string}[] = [];
  for (let i = 0; i < onchainRoutes.pools.length; i++) {
    onchainConfig.push({
      Pool: getAddress(onchainRoutes.pools[i]),
      Domain: SolidityDomain[Number(onchainRoutes.domains[i])],
      Provider: SolidityProvider[Number(onchainRoutes.providers[i])],
      OnlySupportedToken: getAddress(onchainRoutes.poolOnlySupportsToken[i]),
    });
  }
  const localConfig: {Pool: string, Domain: Network, Provider: Provider, OnlySupportedToken: string}[] = [];
  for (const [pool, domainProviders] of Object.entries(config.RepayerRoutes || {})) {
    const poolAddress = await resolveXAddress(pool, false);
    const onlySupportedToken = resolveOnlySupportedToken(config.Tokens, domainProviders.OnlySupportedToken);
    for (const [domain, providers] of Object.entries(domainProviders.Domains) as [Network, Provider[]][]) {
      for (const provider of providers) {
        localConfig.push({
          Pool: poolAddress,
          Domain: domain,
          Provider: provider,
          OnlySupportedToken: getAddress(onlySupportedToken),
        });
      }
    }
  }
  await addLocalPools(config, network, localConfig, false);
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
    el2.OnlySupportedToken === el.OnlySupportedToken
  ));
  const toDeny = onchainConfig.filter(el => !localConfig.some(el2 =>
    el2.Pool === el.Pool &&
    el2.Domain === el.Domain &&
    el2.Provider === el.Provider &&
    el2.OnlySupportedToken === el.OnlySupportedToken
  ));

  const hasRole = await target.hasRole(DEFAULT_ADMIN_ROLE, admin);

  // Calling deny first so that allow overrides an incorrect OnlySupportedToken.
  if (toDeny.length > 0) {
    const toDenyParams = toDeny.map(el => ({
      pools: el.Pool,
      domains: DomainSolidity[el.Domain],
      providers: ProviderSolidity[el.Provider],
      onlySupportedToken: el.OnlySupportedToken,
    }));
    if (hasRole && (args.action === "deny" || args.action === "both")) {
      await (await target.setRoute(
        toDenyParams.map(el => el.pools),
        toDenyParams.map(el => el.domains),
        toDenyParams.map(el => el.providers),
        toDenyParams.map(el => el.onlySupportedToken),
        false
      )).wait();
      console.log(`Following routes are now denied on ${targetAddress}.`);
      console.table(toDeny);
    } else {
      console.log("To deny excess routes execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      console.log("Params:");
      console.log("isAllowed: false");
      console.table(toDenyParams.map(el => ({
        ...el,
        domains: `${el.domains} (${SolidityDomain[Number(el.domains)]})`,
        providers: `${el.providers} (${SolidityProvider[Number(el.providers)]})`,
      })));
      const denyTx = await target.setRoute.populateTransaction(
        toDenyParams.map(el => el.pools),
        toDenyParams.map(el => el.domains),
        toDenyParams.map(el => el.providers),
        toDenyParams.map(el => el.onlySupportedToken),
        false
      );
      console.log(`Raw data: ${denyTx.data}`);
    }
  } else {
    console.log("There are no excess routes to deny.");
  }

  if (toAllow.length > 0) {
    const toAllowParams = toAllow.map(el => ({
      pools: el.Pool,
      domains: DomainSolidity[el.Domain],
      providers: ProviderSolidity[el.Provider],
      onlySupportedToken: el.OnlySupportedToken,
    }));
    if (hasRole && (args.action === "allow" || args.action === "both")) {
      await (await target.setRoute(
        toAllowParams.map(el => el.pools),
        toAllowParams.map(el => el.domains),
        toAllowParams.map(el => el.providers),
        toAllowParams.map(el => el.onlySupportedToken),
        true
      )).wait();
      console.log(`Following routes are now allowed on ${targetAddress}.`);
      console.table(toAllow);
    } else {
      console.log("To allow missing routes execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      console.log("Params:");
      console.log("isAllowed: true");
      console.table(toAllowParams.map(el => ({
        ...el,
        domains: `${el.domains} (${SolidityDomain[Number(el.domains)]})`,
        providers: `${el.providers} (${SolidityProvider[Number(el.providers)]})`,
      })));
      const allowTx = await target.setRoute.populateTransaction(
        toAllowParams.map(el => el.pools),
        toAllowParams.map(el => el.domains),
        toAllowParams.map(el => el.providers),
        toAllowParams.map(el => el.onlySupportedToken),
        true
      );
      console.log(`Raw data: ${allowTx.data}`);
    }
  } else {
    console.log("There are no missing routes to allow.");
  }
});

task("update-tokens-repayer", "Update input output tokens based on current network configs")
.addOptionalParam("repayer", "Repayer address or id", "Repayer", types.string)
.addOptionalParam("check", "Check if tokens are already allowed", true, types.boolean)
.setAction(async (args: {
  repayer: string,
  check: boolean,
}, hre) => {
  const {resolveProxyXAddress, toBytes32} = await loadTestHelpers();
  const {
    getNetworkConfig, getHardhatNetworkConfig, getInputOutputTokens, flattenInputOutputTokens,
  } = await loadScriptHelpers();
  let {network, config} = await getNetworkConfig();
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }
  const inputOutputTokens = getInputOutputTokens(network, config);

  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

  const targetAddress = await resolveProxyXAddress(args.repayer);
  const target = (await hre.ethers.getContractAt("Repayer", targetAddress, admin)) as Repayer;
  const filteredInputOutputTokens: Repayer.InputOutputTokenStruct[] = [];
  const currentInputOutputTokens: Repayer.InputOutputTokenStruct[] = [];
  for (const entry of inputOutputTokens) {
    const outputTokenData = await Promise.all(entry.destinationTokens.map(async el => {
      if (args.check) {
        const result = await target.outputTokenData(entry.inputToken, el.destinationDomain, el.outputToken);
        return {isAllowed: result.isAllowed, localDecimalsGreaterBy: Number(result.localDecimalsGreaterBy)};
      }
      return {isAllowed: false, localDecimalsGreaterBy: 0};
    }));
    const configuredDestTokens = entry.destinationTokens.filter((el, index) => {
      return outputTokenData[index].isAllowed &&
        outputTokenData[index].localDecimalsGreaterBy === el.localDecimalsGreaterBy;
    });
    if (configuredDestTokens.length > 0) {
      currentInputOutputTokens.push({inputToken: entry.inputToken, destinationTokens: configuredDestTokens});
    }
    entry.destinationTokens = entry.destinationTokens.filter((el, index) => {
      const alreadyConfigured =
        outputTokenData[index].isAllowed &&
        outputTokenData[index].localDecimalsGreaterBy === el.localDecimalsGreaterBy;
      return !alreadyConfigured;
    });
    if (entry.destinationTokens.length > 0) {
      filteredInputOutputTokens.push(entry);
    }
  }

  if (currentInputOutputTokens.length > 0) {
    console.log(`Current input/output tokens on ${targetAddress}:`);
    console.table(flattenInputOutputTokens(currentInputOutputTokens));
  } else if (args.check) {
    console.log("No input/output tokens are currently configured.");
  }

  if (filteredInputOutputTokens.length > 0) {
    console.log(`Following tokens will be added to ${targetAddress}.`);
    console.table(flattenInputOutputTokens(filteredInputOutputTokens));
    const hasRole = admin && await target.hasRole(toBytes32("SET_TOKENS_ROLE"), admin);
    if (hasRole) {
      await (await target.setInputOutputTokens(filteredInputOutputTokens, true)).wait();
      console.log("Done.");
    } else {
      console.log("To add missing tokens execute the following transaction.");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setInputOutputTokens");
      console.log("Params:");
      console.log("isAllowed: true");
      for (const entry of filteredInputOutputTokens) {
        console.log(`inputToken: ${entry.inputToken}`);
        console.log("destinationTokens:");
        console.table(entry.destinationTokens.map(el => ({
          ...el,
          destinationDomain: `${el.destinationDomain} (${SolidityDomain[Number(el.destinationDomain)]})`,
        })));
      }
      const tx = await target.setInputOutputTokens.populateTransaction(filteredInputOutputTokens, true);
      console.log(`Raw data: ${tx.data}`);
    }
  } else {
    console.log("There are no missing tokens to add.");
  }
});

task("update-stashdex-routes", "Update StashDex routes to match current network config")
.addOptionalParam("stashdex", "StashDex address or id", "StashStablecoinDex", types.string)
.addOptionalParam("action", "Action to perform: add, disable, or both (default)", "both", types.string)
.setAction(async (args: {stashdex: string, action: string}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig} = await loadScriptHelpers();
  const {config} = await getNetworkConfig();

  assert(config.StashDex, "StashDex not configured for this network");
  assert(["add", "disable", "both"].includes(args.action), "Invalid action");

  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

  const targetAddress = await resolveProxyXAddress(args.stashdex);
  const target = (await hre.ethers.getContractAt("StashDex", targetAddress, admin)) as StashDex;

  // Resolve desired local routes to concrete addresses.
  const localRoutes: {TokenIn: string, TokenOut: string, FeeBps: number, Processor: string}[] = [];
  for (const route of config.StashDex.Routes) {
    const tokenInInfo = config.Tokens[route.TokenIn];
    const tokenOutInfo = config.Tokens[route.TokenOut];
    assert(tokenInInfo, `Token ${route.TokenIn} not found in config`);
    assert(tokenOutInfo, `Token ${route.TokenOut} not found in config`);
    localRoutes.push({
      TokenIn: getAddress(tokenInInfo.Address),
      TokenOut: getAddress(tokenOutInfo.Address),
      FeeBps: route.FeeBps,
      Processor: await resolveXAddress(route.Processor),
    });
  }

  // Reverse map: checksummed address → token name, for human-readable output.
  const addrToName = new Map<string, string>(
    (Object.entries(config.Tokens) as [Token, {Address: string}][])
      .map(([name, info]) => [getAddress(info.Address), name])
  );
  const routeLabel = (tokenIn: string, tokenOut: string) =>
    `${addrToName.get(tokenIn) ?? tokenIn} → ${addrToName.get(tokenOut) ?? tokenOut}`;

  // Validate that the oracle supports all tokens appearing in routes.
  const oracleAddress = await resolveXAddress(config.StashDex.Oracle);
  const oracleContract = await hre.ethers.getContractAt("PaxosOracle", oracleAddress);
  const routeTokenNames = new Set<Token>(
    config.StashDex.Routes.flatMap(({TokenIn, TokenOut}) => [TokenIn, TokenOut])
  );
  for (const tokenName of routeTokenNames) {
    const tokenInfo = config.Tokens[tokenName];
    assert(tokenInfo, `Token ${tokenName} not found in config`);
    assert(
      await oracleContract.isSupported(addressToBytes32(tokenInfo.Address)),
      `Oracle at ${oracleAddress} does not support route token ${tokenName} (${tokenInfo.Address})`,
    );
  }

  // Build the universe of token addresses to probe onchain (Pools keys + Route tokens).
  const tokenAddrs = new Set<string>();
  for (const tokenName of Object.keys(config.StashDex.Pools) as Token[]) {
    const info = config.Tokens[tokenName];
    if (info) tokenAddrs.add(getAddress(info.Address));
  }
  for (const route of config.StashDex.Routes) {
    const inInfo = config.Tokens[route.TokenIn];
    const outInfo = config.Tokens[route.TokenOut];
    if (inInfo) tokenAddrs.add(getAddress(inInfo.Address));
    if (outInfo) tokenAddrs.add(getAddress(outInfo.Address));
  }
  const tokenList = Array.from(tokenAddrs);

  // Read all enabled routes onchain for every ordered pair in the universe.
  const onchainRoutes: {TokenIn: string, TokenOut: string, FeeBps: number, Processor: string}[] = [];
  for (const tokenIn of tokenList) {
    for (const tokenOut of tokenList) {
      if (tokenIn === tokenOut) continue;
      const r = await target.getRoute(tokenIn, tokenOut);
      if (r.allowed) {
        onchainRoutes.push({
          TokenIn: tokenIn,
          TokenOut: tokenOut,
          FeeBps: Number(r.feeBps),
          Processor: getAddress(r.processor),
        });
      }
    }
  }

  console.log("Onchain routes:");
  console.table(onchainRoutes);
  console.log("Desired routes:");
  console.table(localRoutes);

  // Routes to set: in local config but missing onchain, or onchain with wrong params.
  const toSet = localRoutes.filter(lr => !onchainRoutes.some(or =>
    sameAddress(or.TokenIn, lr.TokenIn) &&
    sameAddress(or.TokenOut, lr.TokenOut) &&
    or.FeeBps === lr.FeeBps &&
    sameAddress(or.Processor, lr.Processor)
  ));
  // Routes to disable: enabled onchain but no matching (tokenIn, tokenOut) pair in local config.
  const toDisable = onchainRoutes.filter(or => !localRoutes.some(lr =>
    sameAddress(lr.TokenIn, or.TokenIn) &&
    sameAddress(lr.TokenOut, or.TokenOut)
  ));

  const CONFIG_ROLE = await target.CONFIG_ROLE();
  const hasRole = await target.hasRole(CONFIG_ROLE, admin);

  if (toDisable.length > 0) {
    if (hasRole && (args.action === "disable" || args.action === "both")) {
      for (const route of toDisable) {
        await (await target.disableRoute(route.TokenIn, route.TokenOut)).wait();
      }
      console.log("Disabled routes:");
      console.table(toDisable);
    } else {
      console.log("To disable excess routes execute the following transactions:");
      console.log(`To: ${targetAddress}`);
      console.log("Function: disableRoute");
      for (const route of toDisable) {
        const tx = await target.disableRoute.populateTransaction(route.TokenIn, route.TokenOut);
        console.log(`  ${routeLabel(route.TokenIn, route.TokenOut)}: ${tx.data}`);
      }
    }
  } else {
    console.log("No excess routes to disable.");
  }

  if (toSet.length > 0) {
    if (hasRole && (args.action === "add" || args.action === "both")) {
      for (const route of toSet) {
        await (await target.setRoute({
          tokenIn: route.TokenIn,
          tokenOut: route.TokenOut,
          feeBps: route.FeeBps,
          processor: route.Processor,
        })).wait();
      }
      console.log("Set routes:");
      console.table(toSet);
    } else {
      console.log("To add/update missing routes execute the following transactions:");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setRoute");
      for (const route of toSet) {
        const tx = await target.setRoute.populateTransaction({
          tokenIn: route.TokenIn,
          tokenOut: route.TokenOut,
          feeBps: route.FeeBps,
          processor: route.Processor,
        });
        console.log(`  ${routeLabel(route.TokenIn, route.TokenOut)}: ${tx.data}`);
      }
    }
  } else {
    console.log("No missing routes to add.");
  }
});

task("update-stashdex-pools", "Update StashDex pools to match current network config")
.addOptionalParam("stashdex", "StashDex address or id", "StashStablecoinDex", types.string)
.setAction(async (args: {stashdex: string}, hre) => {
  const {resolveProxyXAddress, resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig} = await loadScriptHelpers();
  const {config} = await getNetworkConfig();

  assert(config.StashDex, "StashDex not configured for this network");

  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

  const targetAddress = await resolveProxyXAddress(args.stashdex);
  const target = (await hre.ethers.getContractAt("StashDex", targetAddress, admin)) as StashDex;

  // Resolve desired local pools to concrete addresses.
  const localPools: {TokenName: Token, PoolId: string, Token: string, Pool: string}[] = [];
  for (const [tokenName, poolId] of Object.entries(config.StashDex.Pools) as [Token, string][]) {
    const tokenInfo = config.Tokens[tokenName];
    assert(tokenInfo, `Token ${tokenName} not found in config`);
    localPools.push({
      TokenName: tokenName,
      PoolId: poolId,
      Token: getAddress(tokenInfo.Address),
      Pool: await resolveXAddress(poolId),
    });
  }

  // Read onchain pool for each token.
  const onchainPools: {Token: string, Pool: string}[] = [];
  for (const {Token: token} of localPools) {
    const pool = await target.getPool(token);
    onchainPools.push({Token: token, Pool: getAddress(pool)});
  }

  console.log("Onchain pools:");
  console.table(onchainPools);
  console.log("Desired pools:");
  console.table(localPools);

  const toSet = localPools.filter(lp => !onchainPools.some(op =>
    sameAddress(op.Token, lp.Token) &&
    sameAddress(op.Pool, lp.Pool)
  ));

  const CONFIG_ROLE = await target.CONFIG_ROLE();
  const hasRole = await target.hasRole(CONFIG_ROLE, admin);

  if (toSet.length > 0) {
    if (hasRole) {
      for (const {Token: token, Pool: pool} of toSet) {
        await (await target.setPool(token, pool)).wait();
      }
      console.log("Updated pools:");
      console.table(toSet);
    } else {
      console.log("To update pools execute the following transactions:");
      console.log(`To: ${targetAddress}`);
      console.log("Function: setPool");
      for (const {TokenName, PoolId, Token: token, Pool: pool} of toSet) {
        const tx = await target.setPool.populateTransaction(token, pool);
        console.log(`  ${TokenName} → ${PoolId}: ${tx.data}`);
      }
    }
  } else {
    console.log("All pools are up to date.");
  }
});

// Does not verify if decimals are correct on-chain.
task("update-paxos-oracle-assets", "Synchronize PaxosOracle assets with tokens in StashDex.Pools config")
.addOptionalParam("oracle", "PaxosOracle address or id", "PaxosOracle", types.string)
.setAction(async (args: {oracle: string}, hre) => {
  const {resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig} = await loadScriptHelpers();
  const {config} = await getNetworkConfig();

  assert(config.StashDex, "StashDex not configured for this network");

  const [sender] = await hre.ethers.getSigners();
  const admin = await createSender(hre, sender);

  const targetAddress = await resolveXAddress(args.oracle);
  const target = (await hre.ethers.getContractAt("PaxosOracle", targetAddress, admin)) as PaxosOracle;

  // Desired: tokens present in StashDex.Pools plus all tokens appearing in routes.
  const desiredTokenNames = new Set<Token>(Object.keys(config.StashDex.Pools) as Token[]);
  for (const {TokenIn, TokenOut} of config.StashDex.Routes) {
    desiredTokenNames.add(TokenIn);
    desiredTokenNames.add(TokenOut);
  }
  const desiredTokens = [...desiredTokenNames].map(tokenName => {
    const tokenInfo = config.Tokens[tokenName];
    assert(tokenInfo, `Token ${tokenName} not found in config`);
    return {TokenName: tokenName, Address: getAddress(tokenInfo.Address), Decimals: tokenInfo.Decimals};
  });

  // All known tokens — used to detect on-chain assets that should be removed.
  const allKnownTokens = (Object.entries(config.Tokens) as [Token, {Address: string, Decimals: number} | undefined][])
    .filter(([, info]) => info)
    .map(([tokenName, info]) => ({TokenName: tokenName, Address: getAddress(info!.Address), Decimals: info!.Decimals}));

  const desiredAddresses = new Set(desiredTokens.map(t => t.Address));

  // Check onchain support for all known tokens.
  const toAdd: typeof desiredTokens = [];
  const toRemove: typeof allKnownTokens = [];
  const onchainAssets: {TokenName: string, Address: string, Decimals: number}[] = [];

  for (const token of desiredTokens) {
    const assetId = addressToBytes32(token.Address);
    const supported = await target.isSupported(assetId);
    if (!supported) toAdd.push(token);
    else onchainAssets.push(token);
  }

  for (const token of allKnownTokens) {
    if (desiredAddresses.has(token.Address)) continue;
    const assetId = addressToBytes32(token.Address);
    const supported = await target.isSupported(assetId);
    if (supported) {
      toRemove.push(token);
      onchainAssets.push(token);
    }
  }

  console.log("Desired assets (StashDex.Pools tokens):");
  console.table(desiredTokens);
  console.log("On-chain assets:");
  console.table(onchainAssets);

  if (toAdd.length === 0 && toRemove.length === 0) {
    console.log("PaxosOracle assets are up to date.");
    return;
  }

  const hasRole = await target.hasRole(DEFAULT_ADMIN_ROLE, admin);

  if (toAdd.length > 0) {
    if (hasRole) {
      for (const {TokenName, Address, Decimals} of toAdd) {
        await (await target.addAsset(addressToBytes32(Address), Decimals)).wait();
        console.log(`Added asset: ${TokenName} (${Address}) ${Decimals} decimals`);
      }
    } else {
      console.log("Assets to add — execute the following transactions:");
      console.log(`To: ${targetAddress}`);
      console.log("Function: addAsset");
      for (const {TokenName, Address, Decimals} of toAdd) {
        const tx = await target.addAsset.populateTransaction(addressToBytes32(Address), Decimals);
        console.log(`  ${TokenName} (${Address}): ${tx.data}`);
      }
    }
  }

  if (toRemove.length > 0) {
    if (hasRole) {
      for (const {TokenName, Address} of toRemove) {
        await (await target.removeAsset(addressToBytes32(Address))).wait();
        console.log(`Removed asset: ${TokenName} (${Address})`);
      }
    } else {
      console.log("Assets to remove — execute the following transactions:");
      console.log(`To: ${targetAddress}`);
      console.log("Function: removeAsset");
      for (const {TokenName, Address} of toRemove) {
        const tx = await target.removeAsset.populateTransaction(addressToBytes32(Address));
        console.log(`  ${TokenName} (${Address}): ${tx.data}`);
      }
    }
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
.addOptionalParam("pool", "Liquidity Pool address or id", LiquidityPoolAaveId, types.string)
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
  const {resolveXAddress} = await loadTestHelpers();
  const {getNetworkConfig, getMainAsset, idWithMainAsset} = await loadScriptHelpers();
  const {config} = await getNetworkConfig();
  const {mainAsset, mainAssetInfo} = getMainAsset(config);
  if (!isAddress(args.pool)) {
    args.pool = idWithMainAsset(mainAsset, args.pool);
  }

  const [signer] = await hre.ethers.getSigners();

  const name = "LiquidityPool";
  const version = "1.0.0";

  const pool = await resolveXAddress(args.pool);
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
  const borrowToken = args.token || mainAssetInfo.Address;
  const amount = args.amount;
  const target = args.target || borrowToken;
  const data = args.data || (await token.transfer.populateTransaction(signer, amount)).data;
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

interface CCTPV2Message {
  attestation: string,
  message: string,
  eventNonce: string,
  status: string,
};

interface CCTPV2ResponseSuccess {
  messages: CCTPV2Message[],
};

task("cctpv2-get-process-data", "Get burn attestation from CCTP V2 Api to mint USDC on destination")
.addParam("txhash", "Hash of the initiate transaction")
.addOptionalParam("adapter", "Rebalancer or Repayer address", "0xA85Cf46c150db2600b1D03E437bedD5513869888")
.setAction(async ({txhash, adapter}: {txhash: string, adapter: string}, hre) => {
  const {resolveProxyXAddress} = await loadTestHelpers();
  assert(txhash.length > 0, "Valid txhash should be provided.");

  const cctpAdapter = await hre.ethers.getContractAt("CCTPV2Adapter", await resolveProxyXAddress(adapter));
  const cctpDomain = await cctpAdapter.domainCCTP(DomainSolidity[hre.network.name as Network]);

  const url = `https://iris-api.circle.com/v2/messages/${cctpDomain}?transactionHash=${txhash}`;
  const options = {method: "GET", headers: {"Content-Type": "application/json"}};
  const result = await (await fetch(url, options)).json();

  if (result.error) {
    console.error(result.error);
    return;
  }

  const success = result as CCTPV2ResponseSuccess;

  assert(success.messages, `Messages are missing in CCTP response: ${success}`);

  if (success.messages[0].status !== "complete" || !success.messages[0].attestation.startsWith("0x")) {
    console.error("Attestation is not ready:", success.messages[0].status, success.messages[0].attestation);
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

task("push-native-token", "Push native currency through a selfdestruct")
.addParam("receiver", "Address of the receiver")
.addOptionalParam("amount", "Human readable amount of native token to send", "0.0011")
.setAction(async ({receiver, amount}: {receiver: string, amount: string}, hre) => {
  const {deploy} = await loadTestHelpers();
  const [sender] = await hre.ethers.getSigners();
  assertAddress(receiver, "Receiver must be a valid address");

  const value = parseEther(amount);
  await deploy("PushNativeToken", sender, {value}, receiver);
  console.log("Done.");
});

const accounts: string[] = isSet(process.env.PRIVATE_KEY) ? [process.env.PRIVATE_KEY || ""] : [];

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{
      version: "0.8.28",
      settings: {
        optimizer: {
          enabled: true,
          runs: 999999,
        },
        viaIR: true,
      },
    },
    {
      version: "0.8.26",
      settings: {
        optimizer: {
          enabled: true,
          runs: 999999,
        },
        viaIR: true,
      },
    }],
    overrides: {
      "contracts/LiquidityPoolAave.sol": {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
          viaIR: true,
        },
      },
      "contracts/LiquidityPoolAaveLongTerm.sol": {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100,
          },
          viaIR: true,
        },
      },
      "contracts/PublicLiquidityPool.sol": {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
          viaIR: true,
        },
      },
      "contracts/Repayer.sol": {
        version: isSet(process.env.TRON) ? "0.8.26" : "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100,
          },
          viaIR: true,
        },
      },
      "contracts/testing/RepayerUSDT0Tempo.sol": {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          viaIR: true,
        },
      },
      "contracts/testing/RepayerUSDT0Stable.sol": {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          viaIR: true,
        },
      },
      "contracts/testing/TestRepayer.sol": {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100,
          },
          viaIR: true,
        },
      }
    }
  },
  tronSolc: {
    enable: true,
    filter: ["Repayer", "Rebalancer", "LiquidityPool", "Deps", "CensoredTransferFromMulticall", "ICreateX"],
    compilers: [{version: "0.8.26"}], // highest version available in tronbox.
    versionRemapping: [
      ["0.8.28", "0.8.26"],
    ],
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545/",
    },
    localtron: {
      url: "http://127.0.0.1:9090/jsonrpc",
      tron: true,
      accounts: [
        "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
        "7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
      ],
    },
    [Network.AVALANCHE]: {
      chainId: networkConfig.AVALANCHE.ChainId,
      url: process.env.AVALANCHE_RPC || "https://avalanche-c-chain-rpc.publicnode.com",
      accounts,
    },
    [Network.BASE]: {
      chainId: networkConfig.BASE.ChainId,
      url: process.env.BASE_RPC || "https://base-mainnet.public.blastapi.io",
      accounts,
    },
    [Network.ETHEREUM]: {
      chainId: networkConfig.ETHEREUM.ChainId,
      url: process.env.ETHEREUM_RPC || "https://eth-mainnet.public.blastapi.io",
      accounts,
    },
    [Network.ARBITRUM_ONE]: {
      chainId: networkConfig.ARBITRUM_ONE.ChainId,
      url: process.env.ARBITRUM_ONE_RPC || "https://arbitrum-one.public.blastapi.io",
      accounts,
    },
    [Network.OP_MAINNET]: {
      chainId: networkConfig.OP_MAINNET.ChainId,
      url: process.env.OP_MAINNET_RPC || "https://public-op-mainnet.fastnode.io",
      accounts,
    },
    [Network.POLYGON_MAINNET]: {
      chainId: networkConfig.POLYGON_MAINNET.ChainId,
      url: process.env.POLYGON_MAINNET_RPC || "https://polygon-bor-rpc.publicnode.com",
      accounts,
      gasMultiplier: 1.5,
    },
    [Network.UNICHAIN]: {
      chainId: networkConfig.UNICHAIN.ChainId,
      url: process.env.UNICHAIN_RPC || "https://mainnet.unichain.org",
      accounts,
    },
    [Network.BSC]: {
      chainId: networkConfig.BSC.ChainId,
      url: process.env.BSC_RPC || "https://bsc-mainnet.public.blastapi.io",
      accounts,
    },
    [Network.LINEA]: {
      chainId: networkConfig.LINEA.ChainId,
      url: process.env.LINEA_RPC || "https://linea-rpc.publicnode.com",
      accounts,
    },
    [Network.GNOSIS_CHAIN]: {
      chainId: networkConfig.GNOSIS_CHAIN.ChainId,
      url: process.env.GNOSIS_CHAIN_RPC || "https://public-gno-mainnet.fastnode.io",
      accounts,
    },
    [Network.WORLD_CHAIN]: {
      chainId: networkConfig.WORLD_CHAIN.ChainId,
      url: process.env.WORLD_CHAIN_RPC || "https://worldchain-mainnet.g.alchemy.com/public",
      accounts,
    },
    [Network.INK]: {
      chainId: networkConfig.INK.ChainId,
      url: process.env.INK_RPC || "https://rpc-qnd.inkonchain.com",
      accounts,
    },
    [Network.HYPER_EVM]: {
      chainId: networkConfig.HYPER_EVM.ChainId,
      url: process.env.HYPER_EVM_RPC || "https://rpc.hyperliquid.xyz/evm",
      accounts,
    },
    [Network.TEMPO]: {
      chainId: networkConfig.TEMPO.ChainId,
      url: process.env.TEMPO_RPC || "https://rpc.mainnet.tempo.xyz",
      accounts,
    },
    [Network.STABLE]: {
      chainId: networkConfig.STABLE.ChainId,
      url: process.env[(isSet(process.env.VIRTUAL) ? "VIRTUAL_" : "") + "STABLE_RPC"],
      accounts,
    },
    [Network.TRON]: {
      chainId: networkConfig.TRON.ChainId,
      url: process.env.TRON_RPC || "https://tron-rpc.publicnode.com/jsonrpc",
      tron: true,
      accounts,
    },
    hardhat: {
      chainId: isSet(process.env.DRY_RUN) || isSet(process.env.FORK_TEST)
        ? networkConfig[`${process.env.DRY_RUN || process.env.FORK_TEST}` as Network]!.ChainId
        : networkConfig.BASE.ChainId,
      forking: {
        url: isSet(process.env.DRY_RUN) || isSet(process.env.FORK_TEST)
          ? process.env[`${process.env.DRY_RUN || process.env.FORK_TEST}_RPC`]!
          : (process.env.FORK_PROVIDER || process.env.BASE_RPC || "https://base-mainnet.public.blastapi.io"),
        // FORK_BLOCK_NUMBER only applies to the default Base fork, not to FORK_TEST or DRY_RUN
        // because each chain has its own block-number space.
        blockNumber: process.env.FORK_BLOCK_NUMBER
          && !isSet(process.env.DRY_RUN)
          && !isSet(process.env.FORK_TEST)
          ? parseInt(process.env.FORK_BLOCK_NUMBER)
          : undefined,
      },
      accounts: isSet(process.env.DRY_RUN)
        ? [{privateKey: process.env.PRIVATE_KEY!, balance: "100000000000000000000"}]
        : undefined,
      // https://github.com/NomicFoundation/hardhat/issues/5511
      chains: isSet(process.env.DRY_RUN) || isSet(process.env.FORK_TEST)
        ? {[networkConfig[
            `${process.env.DRY_RUN || process.env.FORK_TEST}` as Network
          ]!.ChainId]: {hardforkHistory: {cancun: 0}}}
        : {[networkConfig.BASE.ChainId]: {hardforkHistory: {cancun: 0}}},
    },
  },
  sourcify: {
    enabled: false,
  },
  blockscout: {
    enabled: true,
    customChains: [
      {
        network: "INK",
        chainId: networkConfig.INK.ChainId,
        urls: {
          apiURL: "https://explorer.inkonchain.com/api",
          browserURL: "https://explorer.inkonchain.com/",
        },
      },
    ]
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "unichain",
        chainId: networkConfig.UNICHAIN.ChainId,
        urls: {
          apiURL: "https://uniscan.xyz/api",
          browserURL: "https://uniscan.xyz"
        },
      },
      {
        network: "linea",
        chainId: networkConfig.LINEA.ChainId,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://lineascan.build/"
        },
      },
      {
        network: "gnosis",
        chainId: networkConfig.GNOSIS_CHAIN.ChainId,
        urls: {
          apiURL: "https://api.gnosisscan.io/api",
          browserURL: "https://gnosisscan.io"
        },
      },
      {
        network: "hyperevm",
        chainId: networkConfig.HYPER_EVM.ChainId,
        urls: {
          apiURL: "https://api.hyperevmscan.io/api",
          browserURL: "https://hyperevmscan.io"
        },
      },
      {
        network: "worldchain",
        chainId: networkConfig.WORLD_CHAIN.ChainId,
        urls: {
          apiURL: "https://api.worldscan.org/api",
          browserURL: "https://worldscan.org"
        },
      },
      {
        network: "stable",
        chainId: networkConfig.STABLE.ChainId,
        urls: {
          apiURL: "https://api.stablescan.xyz/api",
          browserURL: "https://stablescan.xyz"
        },
      },
      {
        network: "tron",
        chainId: networkConfig.TRON.ChainId,
        urls: {
          apiURL: "https://api.tronscan.org/api",
          browserURL: "https://tronscan.org"
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
    "contracts/utils/PushNativeToken.sol": {
      default: "off",
    },
  },
};

export default config;
