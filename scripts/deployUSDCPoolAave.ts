import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig, percentsToBps} from "./helpers";
import {resolveProxyXAddress, toBytes32} from "../test/helpers";
import {isSet, assert, assertAddress, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {LiquidityPoolAave} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolAaveUSDCVersions} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let id = LiquidityPoolAaveUSDCVersions.at(-1);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying Aave USDC Pool");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }
  assert(config.AavePool, "Aave pool is not configured");
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.WithdrawProfit, "WithdrawProfit must be an address");
  assertAddress(config.Pauser, "Pauser must be an address");
  assertAddress(config.USDC, "USDC must be an address");
  assertAddress(config.MpcAddress, "MpcAddress must be an address");
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");

  const rebalancer = await resolveProxyXAddress("Rebalancer");
  console.log(`Rebalancer: ${rebalancer}`);

  console.log("Deploying Aave USDC Liquidity Pool");
  const minHealthFactor = BigInt(config.AavePool.MinHealthFactor) * 10000n / 100n;
  const defaultLTV = BigInt(config.AavePool.DefaultLTV) * 10000n / 100n;
  const aavePool = (await verifier.deployX(
    "LiquidityPoolAave",
    deployer,
    {},
    [
      config.USDC,
      config.AavePool.AaveAddressesProvider,
      deployer,
      config.MpcAddress,
      minHealthFactor,
      defaultLTV,
      config.WrappedNativeToken,
    ],
    id,
  )) as LiquidityPoolAave;

  if (config.AavePool.TokenLTVs) {
    const tokens = Object.keys(config.AavePool.TokenLTVs);
    const LTVs = Object.values(config.AavePool.TokenLTVs);
    await aavePool.setBorrowTokenLTVs(
      tokens,
      percentsToBps(LTVs),
    );
  }
  console.log(`${id}: ${aavePool.target}`);

  await aavePool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await aavePool.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await aavePool.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await aavePool.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await aavePool.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  console.log("Access control setup complete.");
  console.log("Remember to update Rebalancer and Repayer routes in the config and then onchain.");

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
