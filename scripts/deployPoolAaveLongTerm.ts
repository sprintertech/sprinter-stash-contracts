import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {
  getVerifier, getHardhatNetworkConfig, getNetworkConfig, percentsToBps, logDeployers, deployProxyX,
  getMainAsset, idWithMainAsset,
} from "./helpers";
import {resolveProxyXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, assertAddress, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {LiquidityPoolAaveLongTerm, ProxyAdmin} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolAaveLongTermId} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");
  const BORROW_LONG_TERM_ROLE = toBytes32("BORROW_LONG_TERM_ROLE");
  const REPAYER_ROLE = toBytes32("REPAYER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let id = LiquidityPoolAaveLongTermId;

  let network: Network;
  let config: NetworkConfig;
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  await logDeployers();

  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);
  assert(mainAssetConfig.AavePoolLongTerm, `${mainAsset} Aave pool long term is not configured`);
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.WithdrawProfit, "WithdrawProfit must be an address");
  assertAddress(config.Pauser, "Pauser must be an address");
  assertAddress(config.MpcAddress, "MpcAddress must be an address");
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");
  assertAddress(config.SignerAddress, "SignerAddress must be an address");
  assertAddress(mainAssetConfig.AavePoolLongTerm.BorrowLongTermAdmin, "BorrowLongTermAdmin must be an address");
  assertAddress(mainAssetConfig.AavePoolLongTerm.RepayCaller, "RepayCaller must be an address");
  id = idWithMainAsset(mainAsset, id);
  console.log(`Deploying ${id}`);

  const rebalancer = await resolveProxyXAddress(idWithMainAsset(mainAsset, "Rebalancer"));
  console.log(`Rebalancer: ${rebalancer}`);

  const minHealthFactor = BigInt(mainAssetConfig.AavePoolLongTerm.MinHealthFactor) * 10000n / 100n;
  const defaultLTV = BigInt(mainAssetConfig.AavePoolLongTerm.DefaultLTV) * 10000n / 100n;
  const {
    target: aavePoolLongTerm, targetAdmin: aavePoolLongTermAdmin,
  }: {target: LiquidityPoolAaveLongTerm; targetAdmin: ProxyAdmin} =
    await deployProxyX<LiquidityPoolAaveLongTerm>(
      verifier.deployX,
      "LiquidityPoolAaveLongTerm",
      deployerWithNonce,
      config.Admin,
      [
        mainAssetInfo.Address, mainAssetConfig.AavePoolLongTerm.AaveAddressesProvider,
        config.WrappedNativeToken,
      ],
      [deployer, config.MpcAddress, config.SignerAddress, minHealthFactor, defaultLTV],
      id,
      verifier,
    );

  if (mainAssetConfig.AavePoolLongTerm.TokenLTVs) {
    const tokens = Object.keys(mainAssetConfig.AavePoolLongTerm.TokenLTVs);
    const LTVs = Object.values(mainAssetConfig.AavePoolLongTerm.TokenLTVs);
    await aavePoolLongTerm.setBorrowTokenLTVs(
      tokens,
      percentsToBps(LTVs),
    );
  }
  console.log(`${id}Proxy: ${aavePoolLongTerm.target}`);
  console.log(`${id}ProxyAdmin: ${aavePoolLongTermAdmin.target}`);

  await aavePoolLongTerm.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await aavePoolLongTerm.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await aavePoolLongTerm.grantRole(PAUSER_ROLE, config.Pauser);
  await aavePoolLongTerm.grantRole(BORROW_LONG_TERM_ROLE, mainAssetConfig.AavePoolLongTerm.BorrowLongTermAdmin);
  await aavePoolLongTerm.grantRole(REPAYER_ROLE, mainAssetConfig.AavePoolLongTerm.BorrowLongTermAdmin);
  let lastTx = await aavePoolLongTerm.grantRole(REPAYER_ROLE, mainAssetConfig.AavePoolLongTerm.RepayCaller);

  if (!sameAddress(deployer.address, config.Admin)) {
    await aavePoolLongTerm.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    lastTx = await aavePoolLongTerm.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  console.log("Access control setup complete.");
  console.log("Remember to update Rebalancer and Repayer routes in the config and then onchain.");

  await verifier.verify(process.env.VERIFY === "true");
  await lastTx.wait();
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
