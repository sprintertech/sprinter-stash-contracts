import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig, logDeployers} from "./helpers";
import {isSet, assert, addressToBytes32} from "./common";
import {PaxosOracle} from "../typechain-types";
import {Network, NetworkConfig, TokenInfo} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = "PaxosOracle";

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying PaxosOracle");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }
  await logDeployers();

  assert(config.Tokens.USDG, "USDG must be configured");
  assert(config.Tokens.PYUSD, "PYUSD must be configured");

  const usdc = config.Tokens.USDC.Address;
  const paxosStablecoins: TokenInfo[] = [config.Tokens.USDG, config.Tokens.PYUSD];
  console.log(`USDC: ${usdc}`);
  console.log(`Paxos stablecoins (1:1 to USDC): ${paxosStablecoins.map(t => t.Address).join(", ")}`);

  const initialAssets = paxosStablecoins.map(t => ({
    assetId: addressToBytes32(t.Address),
    decimals: t.Decimals,
  }));

  const paxosOracle: PaxosOracle = (await verifier.deployX(
    "PaxosOracle",
    deployer,
    {},
    [
      config.Admin,
      usdc,
      initialAssets,
    ],
    id
  )) as PaxosOracle;
  console.log(`${id}: ${paxosOracle.target}`);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
