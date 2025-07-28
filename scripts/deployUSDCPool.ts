import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig} from "./helpers";
import {resolveProxyXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {LiquidityPool} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolUSDC} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = LiquidityPoolUSDC;

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
    "LiquidityPool", deployer, {}, [config.USDC, deployer, config.MpcAddress, config.WrappedNativeToken], id
  )) as LiquidityPool;
  console.log(`LiquidityPoolUSDC: ${usdcPool.target}`);

  await usdcPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await usdcPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await usdcPool!.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await usdcPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await usdcPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
