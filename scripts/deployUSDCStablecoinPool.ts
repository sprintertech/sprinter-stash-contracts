import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier} from "./helpers";
import {resolveProxyXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE} from "./common";
import {LiquidityPoolStablecoin} from "../typechain-types";
import {networkConfig, Network, NetworkConfig, LiquidityPoolUSDCStablecoin} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log(`Deploying to: ${hre.network.name}`);
  if (hre.network.name === "hardhat" && Object.values(Network).includes(process.env.DRY_RUN as Network)) {
    network = process.env.DRY_RUN as Network;
    config = networkConfig[network];
    if (process.env.DEPLOY_TYPE == "STAGE") {
      assert(config.Stage != undefined, "Stage config must be defined");
      console.log(`Dry run for deploying staging USDC stablecoin pool on fork: ${network}`);
      config = config.Stage!;
    } else {
      console.log(`Dry run for deploying USDC stablecoin pool on fork: ${network}`);
    }
  } else if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = networkConfig[network];
    if (process.env.DEPLOY_TYPE == "STAGE") {
      assert(config.Stage != undefined, "Stage config must be defined");
      console.log(`Deploying staging USDC stablecoin pool on: ${network}`);
      config = config.Stage!;
    } else {
      console.log(`Deploying USDC stablecoin pool on: ${network}`);
    }
  } else {
    console.log(`Nothing to deploy on ${hre.network.name} network`);
    return;
  }

  assert(config.USDCStablecoinPool, "USDC stablecoin pool is not configured");

  const rebalancer = await resolveProxyXAddress("Rebalancer");
  console.log(`Rebalancer: ${rebalancer}`);

  console.log("Deploying USDC Stablecoin Liquidity Pool");
  const usdcPoolStablecoin: LiquidityPoolStablecoin = (await verifier.deployX(
    "LiquidityPoolStablecoin", deployer, {}, [config.USDC, deployer, config.MpcAddress], LiquidityPoolUSDCStablecoin
  )) as LiquidityPoolStablecoin;
  console.log(`LiquidityPoolUSDCStablecoin: ${usdcPoolStablecoin.target}`);

  await usdcPoolStablecoin!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await usdcPoolStablecoin!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await usdcPoolStablecoin!.grantRole(PAUSER_ROLE, config.Pauser);

  if (deployer.address !== config.Admin) {
    await usdcPoolStablecoin!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await usdcPoolStablecoin!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
