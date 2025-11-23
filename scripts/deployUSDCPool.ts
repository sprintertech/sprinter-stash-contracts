import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress} from "ethers";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig} from "./helpers";
import {resolveProxyXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {LiquidityPool} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolUSDCVersions} from "../network.config";

export async function main() {
  let deployer;

  const simulate = process.env.SIMULATE === "true" ? true : false;

  if (simulate) {
    console.log("Simulation mode enabled");
    assert(isAddress(process.env.DEPLOYER_ADDRESS), "Deployer address must be set");
    deployer = await hre.ethers.getImpersonatedSigner(process.env.DEPLOYER_ADDRESS!);
  } else {
    [deployer] = await hre.ethers.getSigners();
  }
  console.log(`Deployer: ${deployer.address}`);

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = await getVerifier(deployer, process.env.DEPLOY_ID, simulate);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = LiquidityPoolUSDCVersions.at(-1);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying USDC Pool");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  assert(config.USDCPool, "USDC pool is not configured");

  const rebalancer = await resolveProxyXAddress("Rebalancer");
  console.log(`Rebalancer: ${rebalancer}`);

  console.log("Deploying USDC Liquidity Pool");
  const usdcPool: LiquidityPool = (await verifier.deployX(
    "LiquidityPool",
    deployer,
    {},
    [
      config.USDC,
      deployer,
      config.MpcAddress,
      config.WrappedNativeToken,
      config.SignerAddress,
    ],
    id
  )) as LiquidityPool;
  console.log(`${id}: ${usdcPool.target}`);

  await usdcPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await usdcPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await usdcPool!.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await usdcPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await usdcPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.performSimulation(config.ChainId.toString(), deployer);
  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
