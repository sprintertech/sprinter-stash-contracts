import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {
  getVerifier, getHardhatNetworkConfig, getNetworkConfig, logDeployers, deployProxyX, getMainAsset,
  idWithMainAsset,
} from "./helpers";
import {resolveProxyXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {LiquidityPool, ProxyAdmin} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolId} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  await logDeployers();

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = LiquidityPoolId;

  let network: Network;
  let config: NetworkConfig;
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);
  assert(mainAssetConfig.BasicPool, `${mainAsset} basic pool is not configured`);
  id = idWithMainAsset(mainAsset, id);
  console.log(`Deploying ${id}`);

  const rebalancer = await resolveProxyXAddress(idWithMainAsset(mainAsset, "Rebalancer"));
  console.log(`Rebalancer: ${rebalancer}`);

  const {target: basicPool, targetAdmin: basicPoolAdmin}: {target: LiquidityPool; targetAdmin: ProxyAdmin} =
    await deployProxyX<LiquidityPool>(
      verifier.deployX,
      "LiquidityPool",
      deployerWithNonce,
      config.Admin,
      [mainAssetInfo.Address, config.WrappedNativeToken],
      [deployer, config.MpcAddress, config.SignerAddress],
      id,
      verifier,
    );
  console.log(`${id}Proxy: ${basicPool.target}`);
  console.log(`${id}ProxyAdmin: ${basicPoolAdmin.target}`);

  await basicPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await basicPool.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  let lastTx = await basicPool!.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await basicPool.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    lastTx = await basicPool.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
  await lastTx.wait();
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
