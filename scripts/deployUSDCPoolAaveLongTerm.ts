import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig, percentsToBps, logDeployers} from "./helpers";
import {resolveProxyXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, assertAddress, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {LiquidityPoolAaveLongTerm} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolAaveUSDCLongTermVersions} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  await logDeployers();

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");
  const BORROW_LONG_TERM_ROLE = toBytes32("BORROW_LONG_TERM_ROLE");
  const REPAYER_ROLE = toBytes32("REPAYER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let id = LiquidityPoolAaveUSDCLongTermVersions.at(-1);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying Aave USDC Long Term Pool");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }
  assert(config.AavePoolLongTerm, "Aave pool long term is not configured");
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.WithdrawProfit, "WithdrawProfit must be an address");
  assertAddress(config.Pauser, "Pauser must be an address");
  assertAddress(config.Tokens.USDC, "USDC must be an address");
  assertAddress(config.MpcAddress, "MpcAddress must be an address");
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");
  assertAddress(config.SignerAddress, "SignerAddress must be an address");
  assertAddress(config.AavePoolLongTerm.BorrowLongTermAdmin, "BorrowLongTermAdmin must be an address");
  assertAddress(config.AavePoolLongTerm.RepayCaller, "RepayCaller must be an address");

  const rebalancer = await resolveProxyXAddress("Rebalancer");
  console.log(`Rebalancer: ${rebalancer}`);

  console.log("Deploying Aave USDC Long Term Liquidity Pool");
  const minHealthFactor = BigInt(config.AavePoolLongTerm.MinHealthFactor) * 10000n / 100n;
  const defaultLTV = BigInt(config.AavePoolLongTerm.DefaultLTV) * 10000n / 100n;
  const aavePoolLongTerm = (await verifier.deployX(
    "LiquidityPoolAaveLongTerm",
    deployerWithNonce,
    {},
    [
      config.Tokens.USDC,
      config.AavePoolLongTerm.AaveAddressesProvider,
      deployer,
      config.MpcAddress,
      minHealthFactor,
      defaultLTV,
      config.WrappedNativeToken,
      config.SignerAddress,
    ],
    id,
  )) as LiquidityPoolAaveLongTerm;

  if (config.AavePoolLongTerm.TokenLTVs) {
    const tokens = Object.keys(config.AavePoolLongTerm.TokenLTVs);
    const LTVs = Object.values(config.AavePoolLongTerm.TokenLTVs);
    await aavePoolLongTerm.setBorrowTokenLTVs(
      tokens,
      percentsToBps(LTVs),
    );
  }
  console.log(`${id}: ${aavePoolLongTerm.target}`);

  await aavePoolLongTerm.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await aavePoolLongTerm.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await aavePoolLongTerm.grantRole(PAUSER_ROLE, config.Pauser);
  await aavePoolLongTerm.grantRole(BORROW_LONG_TERM_ROLE, config.AavePoolLongTerm.BorrowLongTermAdmin);
  await aavePoolLongTerm.grantRole(REPAYER_ROLE, config.AavePoolLongTerm.RepayCaller);

  if (!sameAddress(deployer.address, config.Admin)) {
    await aavePoolLongTerm.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await aavePoolLongTerm.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  console.log("Access control setup complete.");
  console.log("Remember to update Rebalancer and Repayer routes in the config and then onchain.");

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
