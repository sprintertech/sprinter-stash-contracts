import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier} from "./helpers";
import {resolveProxyXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE} from "./common";
import {LiquidityPool} from "../typechain-types";
import {networkConfig, Network, NetworkConfig, LiquidityPoolUSDC, Provider} from "../network.config";

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
  console.log(`Redeploying to: ${hre.network.name}`);
  if (hre.network.name === "hardhat" && Object.values(Network).includes(process.env.DRY_RUN as Network)) {
    network = process.env.DRY_RUN as Network;
    config = networkConfig[network];
    assert(config.Stage != undefined, "Stage config must be defined");
    console.log(`Deploying staging USDC pool on fork: ${network}`);
    config = config.Stage!;
  } else if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = networkConfig[network];
    assert(config.Stage != undefined, "Stage config must be defined");
    console.log(`Deploying staging USDC pool on fork: ${network}`);
    config = config.Stage!;
  } else {
    console.log(`Nothing to deploy on ${hre.network.name} network`);
    return;
  }

  assert(config.USDCPool, "USDC pool is not configured");

  const rebalancer = await resolveProxyXAddress("Rebalancer");
  console.log(`Rebalancer: ${rebalancer}`);

  let usdcPool: LiquidityPool;
  console.log("Deploying USDC Liquidity Pool");
  usdcPool = (await verifier.deployX(
    "LiquidityPool", deployer, {}, [config.USDC, deployer, config.MpcAddress], LiquidityPoolUSDC
  )) as LiquidityPool;
  console.log(`LiquidityPoolUSDC: ${usdcPool.target}`);

  await usdcPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await usdcPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await usdcPool!.grantRole(PAUSER_ROLE, config.Pauser);

  await usdcPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
  await usdcPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
