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
import {LiquidityPoolStablecoin, ProxyAdmin} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolStablecoinId} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = LiquidityPoolStablecoinId;

  let network: Network;
  let config: NetworkConfig;
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }
  
  await logDeployers();
  
  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);
  assert(mainAssetConfig.StablecoinPool, `${mainAsset} stablecoin pool is not configured`);
  id = idWithMainAsset(mainAsset, id);
  console.log(`Deploying ${id}`);

  const rebalancer = await resolveProxyXAddress(idWithMainAsset(mainAsset, "Rebalancer"));
  console.log(`Rebalancer: ${rebalancer}`);

  const {
    target: poolStablecoin, targetAdmin: poolStablecoinAdmin,
  }: {target: LiquidityPoolStablecoin; targetAdmin: ProxyAdmin} =
    await deployProxyX<LiquidityPoolStablecoin>(
      verifier.deployX,
      "LiquidityPoolStablecoin",
      deployerWithNonce,
      config.Admin,
      [mainAssetInfo.Address, config.WrappedNativeToken],
      [deployer, config.MpcAddress, config.SignerAddress],
      id,
      verifier,
    );
  console.log(`${id}Proxy: ${poolStablecoin.target}`);
  console.log(`${id}ProxyAdmin: ${poolStablecoinAdmin.target}`);

  await poolStablecoin.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await poolStablecoin.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  let lastTx = await poolStablecoin.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await poolStablecoin.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    lastTx = await poolStablecoin.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
  await lastTx.wait();
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
