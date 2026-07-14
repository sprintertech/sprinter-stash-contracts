import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig, logDeployers} from "./helpers";
import {createSender} from "./safe";
import {getDeployProxyXAddress, resolveXAddress} from "../test/helpers";
import {isSet, assert, addressToBytes32} from "./common";
import {StashDex} from "../typechain-types";
import {Network, NetworkConfig, Token} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const sender = await createSender(hre, deployer);

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Upgrading StashDex");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(false);

  assert(config.StashDex, "StashDex must be in config");

  const id = "StashStablecoinDex";
  const stashDexAddress = await getDeployProxyXAddress(id);
  const oracle = await resolveXAddress(config.StashDex.Oracle);
  const receiver = await resolveXAddress(config.StashDex.Receiver);

  console.log(`${id} proxy: ${stashDexAddress}`);
  console.log(`Oracle: ${oracle}`);
  console.log(`Receiver: ${receiver}`);

  // Validate that the oracle supports all tokens appearing in routes.
  const oracleContract = await hre.ethers.getContractAt("PaxosOracle", oracle);
  const routeTokenNames = new Set<Token>(
    config.StashDex.Routes.flatMap(({TokenIn, TokenOut}) => [TokenIn, TokenOut])
  );
  for (const tokenName of routeTokenNames) {
    assert(config.Tokens[tokenName], `Token ${tokenName} not found in config`);
    const tokenAddress = config.Tokens[tokenName].Address;
    assert(
      await oracleContract.isSupported(addressToBytes32(tokenAddress)),
      `Oracle at ${oracle} does not support route token ${tokenName} (${tokenAddress})`,
    );
  }

  await upgradeProxyX<StashDex>(
    verifier.deployX,
    stashDexAddress,
    "StashDex",
    sender,
    [oracle, receiver],
    id,
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
