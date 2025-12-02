import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig} from "./helpers";
import {toBytes32} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE, sameAddress, assertAddress} from "./common";
import {PublicLiquidityPool} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolPublicUSDCVersions} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");
  const FEE_SETTER_ROLE = toBytes32("FEE_SETTER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = LiquidityPoolPublicUSDCVersions.at(-1);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying USDC Public Pool");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  assert(config.USDCPublicPool, "USDC public pool is not configured");
  assertAddress(config.SignerAddress, "SignerAddress must be an address");
  assertAddress(config.USDCPublicPool.FeeSetter, "FeeSetter must be an address");

  console.log("Deploying USDC Public Liquidity Pool");
  const usdcPublicPool: PublicLiquidityPool = (await verifier.deployX(
    "PublicLiquidityPool",
    deployer,
    {},
    [
      config.Tokens.USDC,
      deployer,
      config.MpcAddress,
      config.WrappedNativeToken,
      config.SignerAddress,
      config.USDCPublicPool.Name,
      config.USDCPublicPool.Symbol,
      config.USDCPublicPool.ProtocolFeeRate * 10000 / 100,
    ],
    id
  )) as PublicLiquidityPool;
  console.log(`${id}: ${usdcPublicPool.target}`);

  await usdcPublicPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await usdcPublicPool!.grantRole(PAUSER_ROLE, config.Pauser);
  await usdcPublicPool!.grantRole(FEE_SETTER_ROLE, config.USDCPublicPool.FeeSetter);

  if (!sameAddress(deployer.address, config.Admin)) {
    await usdcPublicPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await usdcPublicPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
