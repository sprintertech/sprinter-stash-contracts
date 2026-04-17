import dotenv from "dotenv";
import {NonceManager} from "ethers";
import hre from "hardhat";
import {LiquidityPoolEUReVersions, Network, NetworkConfig} from "../network.config";
import {toBytes32} from "../test/helpers";
import {LiquidityPool} from "../typechain-types";
import {assert, DEFAULT_ADMIN_ROLE, isSet, sameAddress} from "./common";
import {getHardhatNetworkConfig, getNetworkConfig, getVerifier, logDeployers} from "./helpers";
dotenv.config();

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = LiquidityPoolEUReVersions.at(-1);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying EURe Pool");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  await logDeployers();

  assert(config.Tokens.EURe, "EURe token is not configured");

  console.log("Deploying EURe Liquidity Pool");
  const eurePool: LiquidityPool = (await verifier.deployX(
    "LiquidityPool",
    deployerWithNonce,
    {},
    [
      config.Tokens.EURe.Address,
      deployer,
      config.MpcAddress,
      config.WrappedNativeToken,
      config.SignerAddress,
    ],
    id
  )) as LiquidityPool;
  console.log(`${id}: ${eurePool.target}`);

  await eurePool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  let lastTx = await eurePool!.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await eurePool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    lastTx = await eurePool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
  await lastTx.wait();
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
