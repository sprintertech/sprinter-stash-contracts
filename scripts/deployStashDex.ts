import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {
  getVerifier, deployProxyX, getHardhatNetworkConfig, getNetworkConfig,
  logDeployers,
} from "./helpers";
import {resolveXAddress} from "../test/helpers";
import {
  isSet, assert, assertAddress, addressToBytes32,
} from "./common";
import {StashDex} from "../typechain-types";
import {
  Network, NetworkConfig, Token,
} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  const id = "StashStablecoinDex";

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying StashDex");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers();
  assert(config.StashDex, "StashDex must be in config");
  const stashDexConfig = config.StashDex;

  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.Pauser, "Pauser must be an address");
  assertAddress(stashDexConfig.ConfigAdmin, "StashDex.ConfigAdmin must be an address");
  assertAddress(stashDexConfig.Forwarder, "StashDex.Forwarder must be an address");

  for (const {TokenOut} of stashDexConfig.Routes) {
    assert(stashDexConfig.Pools[TokenOut], `Route tokenOut ${TokenOut} has no pool configured in StashDex.Pools`);
  }

  const oracle = await resolveXAddress(stashDexConfig.Oracle);
  const receiver = await resolveXAddress(stashDexConfig.Receiver);

  const initialPools = await Promise.all(
    (Object.entries(stashDexConfig.Pools) as [Token, string][]).map(async ([token, poolId]) => {
      assert(config.Tokens[token], `Token ${token} not found in config`);
      return {
        token: config.Tokens[token].Address,
        pool: await resolveXAddress(poolId),
      };
    })
  );

  const initialRoutes = await Promise.all(
    stashDexConfig.Routes.map(async ({TokenIn, TokenOut, FeeBps, Processor}) => {
      assert(config.Tokens[TokenIn], `Token ${TokenIn} not found in config`);
      assert(config.Tokens[TokenOut], `Token ${TokenOut} not found in config`);
      return {
        tokenIn: config.Tokens[TokenIn].Address,
        tokenOut: config.Tokens[TokenOut].Address,
        feeBps: FeeBps,
        processor: await resolveXAddress(Processor),
      };
    })
  );

  // Validate that the oracle supports all tokens appearing in routes.
  const oracleContract = await hre.ethers.getContractAt("PaxosOracle", oracle);
  const routeTokenNames = new Set<Token>(
    stashDexConfig.Routes.flatMap(({TokenIn, TokenOut}) => [TokenIn, TokenOut])
  );
  for (const tokenName of routeTokenNames) {
    assert(config.Tokens[tokenName], `Token ${tokenName} not found in config`);
    const tokenAddress = config.Tokens[tokenName].Address;
    assert(
      await oracleContract.isSupported(addressToBytes32(tokenAddress)),
      `Oracle at ${oracle} does not support route token ${tokenName} (${tokenAddress})`,
    );
  }

  const {target: stashDex, targetAdmin: stashDexAdmin} = await deployProxyX<StashDex>(
    verifier.deployX,
    "StashDex",
    deployerWithNonce,
    config.Admin,
    [
      oracle,
      receiver,
    ],
    [
      config.Admin,
      stashDexConfig.ConfigAdmin,
      config.Pauser,
      stashDexConfig.Forwarder,
      initialPools,
      initialRoutes,
    ],
    id,
    verifier,
  );

  console.log(`${id}: ${stashDex.target}`);
  console.log(`StashDexProxyAdmin: ${stashDexAdmin.target}`);
  if (initialPools.length > 0) {
    console.log("InitialPools:");
    console.table(initialPools);
  }
  if (initialRoutes.length > 0) {
    console.log("InitialRoutes:");
    console.table(initialRoutes);
  }

  if (initialPools.length > 0) {
    const DIRECT_BORROW_ROLE = hre.ethers.encodeBytes32String("DIRECT_BORROW_ROLE");
    const calldata = (await stashDex.grantRole.populateTransaction(DIRECT_BORROW_ROLE, stashDex)).data;
    const poolTokenNames = Object.keys(stashDexConfig.Pools) as Token[];

    const grouped = new Map<string, string[]>();
    for (let i = 0; i < initialPools.length; i++) {
      const {pool} = initialPools[i];
      const poolContract = await hre.ethers.getContractAt("AccessControlUpgradeable", pool);
      if (await poolContract.hasRole(DIRECT_BORROW_ROLE, stashDex)) continue;
      const tokens = grouped.get(pool) ?? [];
      tokens.push(poolTokenNames[i]);
      grouped.set(pool, tokens);
    }

    if (grouped.size > 0) {
      console.log("NEXT STEPS — grant DIRECT_BORROW_ROLE on each pool so StashDex can borrow:");
      console.log(`Calldata: ${calldata}`);
      console.table([...grouped.entries()].map(([pool, tokens]) => ({tokens: tokens.join(", "), to: pool})));
    } else {
      console.log("DIRECT_BORROW_ROLE already granted on all pools — no action needed.");
    }
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
