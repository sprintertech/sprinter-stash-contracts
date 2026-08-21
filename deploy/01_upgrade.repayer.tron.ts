import dotenv from "dotenv";
dotenv.config();
import {
  getHardhatNetworkConfig, getNetworkConfig, logDeployers
} from "../scripts/helpers";
import {
  assert, isSet, DomainSolidity, ZERO_ADDRESS, assertAddress,
} from "../scripts/common";
import {
  Repayer,
} from "../typechain-types";
import {
  Network, NetworkConfig,
} from "../network.config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {upgradeProxy} from "../scripts/helpers.tron";

const main: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await hre.getUnnamedAccounts();
  const validateDeployers = hre.network.name !== "localtron";
  const deployEnv = process.env.DEPLOY_TYPE === "STAGE" ? "Stage_" : "Prod_";

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Upgrading Repayer");
  ({network, config} = await getNetworkConfig(validateDeployers));
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(validateDeployers);

  let usdcAddress = ZERO_ADDRESS;
  if (config.Tokens.USDC) {
    usdcAddress = config.Tokens.USDC.Address;
    assertAddress(usdcAddress, "USDC must be an address");
  }
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");

  if (!config.CCTPV2) {
    config.CCTPV2 = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
    };
  }

  if (!config.AcrossV3SpokePool) {
    config.AcrossV3SpokePool = ZERO_ADDRESS;
  }
  if (!config.StargateTreasurer) {
    config.StargateTreasurer = ZERO_ADDRESS;
  }
  if (!config.OptimismStandardBridge) {
    config.OptimismStandardBridge = ZERO_ADDRESS;
  }
  if (!config.BaseStandardBridge) {
    config.BaseStandardBridge = ZERO_ADDRESS;
  }
  if (!config.ArbitrumGatewayRouter) {
    config.ArbitrumGatewayRouter = ZERO_ADDRESS;
  }
  if (!config.Omnibridge) config.Omnibridge = ZERO_ADDRESS;
  if (!config.GnosisUSDCxDAI) config.GnosisUSDCxDAI = ZERO_ADDRESS;
  if (!config.GnosisUSDCTransmuter) config.GnosisUSDCTransmuter = ZERO_ADDRESS;
  if (!config.GnosisAMB) config.GnosisAMB = ZERO_ADDRESS;
  if (!config.USDT0OFT) config.USDT0OFT = ZERO_ADDRESS;
  if (!config.USDT0FeeNativeToken) config.USDT0FeeNativeToken = ZERO_ADDRESS;
  if (!config.PolygonPosRootChainManager) config.PolygonPosRootChainManager = ZERO_ADDRESS;

  const repayerId = deployEnv + "Repayer";
  await upgradeProxy<Repayer>(
    hre,
    "Repayer",
    deployer,
    [
      DomainSolidity[network],
      usdcAddress,
      config.AcrossV3SpokePool,
      config.WrappedNativeToken,
      config.StargateTreasurer,
      config.OptimismStandardBridge,
      config.BaseStandardBridge,
      config.ArbitrumGatewayRouter,
      config.Omnibridge,
      config.GnosisUSDCxDAI,
      config.GnosisUSDCTransmuter,
      config.GnosisAMB,
      config.USDT0OFT,
      config.USDT0FeeNativeToken,
      config.CCTPV2.TokenMessenger,
      config.CCTPV2.MessageTransmitter,
      config.PolygonPosRootChainManager,
    ],
    repayerId,
  );
};

main.tags = ["UpgradeRepayer"];
export default main;
