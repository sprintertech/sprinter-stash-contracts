import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {
  getVerifier, getHardhatNetworkConfig, getNetworkConfig, percentsToBps, logDeployers, deployProxyX,
  getMainAsset, idWithMainAsset,
} from "./helpers";
import {resolveProxyXAddress, resolveXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, assertAddress, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {LiquidityPoolAave, ProxyAdmin} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolAaveId} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const DIRECT_BORROW_ROLE = toBytes32("DIRECT_BORROW_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let id = LiquidityPoolAaveId;

  let network: Network;
  let config: NetworkConfig;
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  await logDeployers();

  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);
  assert(mainAssetConfig.AavePool, `${mainAsset} Aave pool is not configured`);
  assertAddress(mainAssetConfig.AavePool.AaveAddressesProvider, "AaveAddressesProvider must be an address");
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.WithdrawProfit, "WithdrawProfit must be an address");
  assertAddress(config.Pauser, "Pauser must be an address");
  assertAddress(config.MpcAddress, "MpcAddress must be an address");
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");
  assertAddress(config.SignerAddress, "SignerAddress must be an address");
  let directBorrowCaller = "";
  if (mainAssetConfig.AavePool.DirectBorrowCaller) {
    directBorrowCaller = await resolveXAddress(mainAssetConfig.AavePool.DirectBorrowCaller, false);
  }
  id = idWithMainAsset(mainAsset, id);
  console.log(`Deploying ${id}`);

  const rebalancer = await resolveProxyXAddress(idWithMainAsset(mainAsset, "Rebalancer"));
  console.log(`Rebalancer: ${rebalancer}`);

  const minHealthFactor = BigInt(mainAssetConfig.AavePool.MinHealthFactor) * 10000n / 100n;
  const defaultLTV = BigInt(mainAssetConfig.AavePool.DefaultLTV) * 10000n / 100n;
  const {target: aavePool, targetAdmin: aavePoolAdmin}: {target: LiquidityPoolAave; targetAdmin: ProxyAdmin} =
    await deployProxyX<LiquidityPoolAave>(
      verifier.deployX,
      "LiquidityPoolAave",
      deployerWithNonce,
      config.Admin,
      [mainAssetInfo.Address, mainAssetConfig.AavePool.AaveAddressesProvider, config.WrappedNativeToken],
      [deployer, config.MpcAddress, config.SignerAddress, minHealthFactor, defaultLTV],
      id,
      verifier,
    );

  if (mainAssetConfig.AavePool.TokenLTVs) {
    const tokens = Object.keys(mainAssetConfig.AavePool.TokenLTVs);
    const LTVs = Object.values(mainAssetConfig.AavePool.TokenLTVs);
    await aavePool.setBorrowTokenLTVs(
      tokens,
      percentsToBps(LTVs),
    );
  }
  console.log(`${id}Proxy: ${aavePool.target}`);
  console.log(`${id}ProxyAdmin: ${aavePoolAdmin.target}`);

  await aavePool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await aavePool.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  if (directBorrowCaller !== "") {
    await aavePool.grantRole(DIRECT_BORROW_ROLE, directBorrowCaller);
  }
  let lastTx = await aavePool.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await aavePool.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    lastTx = await aavePool.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  console.log("Access control setup complete.");
  console.log("Remember to update Rebalancer and Repayer routes in the config and then onchain.");

  await verifier.verify(process.env.VERIFY === "true");
  await lastTx.wait();
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
