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
  isSet, assert, assertAddress,
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
  let id = "StashDex";

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying StashDex");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  await logDeployers();
  assert(config.StashDex, "StashDex must be in config");
  const stashDexConfig = config.StashDex;

  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.Pauser, "Pauser must be an address");
  assertAddress(stashDexConfig.ConfigAdmin, "StashDex.ConfigAdmin must be an address");
  assertAddress(stashDexConfig.Forwarder, "StashDex.Forwarder must be an address");

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

  console.log(`StashDex: ${stashDex.target}`);
  console.log(`StashDexProxyAdmin: ${stashDexAdmin.target}`);
  if (initialPools.length > 0) {
    console.log("InitialPools:");
    console.table(initialPools);
  }
  if (initialRoutes.length > 0) {
    console.log("InitialRoutes:");
    console.table(initialRoutes);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
