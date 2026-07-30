import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {
  getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig, logDeployers,
  getMainAsset,
  idWithMainAsset,
  mineIfNeeded,
} from "./helpers";
import {createSender} from "./safe";
import {getDeployProxyXAddress} from "../test/helpers";
import {isSet, assert, DomainSolidity, ZERO_ADDRESS} from "./common";
import {Rebalancer} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";

export async function main() {
  await mineIfNeeded();
  const [deployer] = await hre.ethers.getSigners();
  const sender = await createSender(hre, deployer);

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(false);

  const {mainAsset, mainAssetInfo} = getMainAsset(config);
  const id = idWithMainAsset(mainAsset, "Rebalancer");
  console.log(`Upgrading ${id}`);
  if (!config.CCTPV2) {
    config.CCTPV2 = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
    };
  }
  if (!config.Omnibridge) config.Omnibridge = ZERO_ADDRESS;
  if (!config.GnosisUSDCxDAI) config.GnosisUSDCxDAI = ZERO_ADDRESS;
  if (!config.GnosisUSDCTransmuter) config.GnosisUSDCTransmuter = ZERO_ADDRESS;
  if (!config.GnosisAMB) config.GnosisAMB = ZERO_ADDRESS;
  if (!config.USDT0OFT) config.USDT0OFT = ZERO_ADDRESS;
  if (!config.USDT0FeeNativeToken) config.USDT0FeeNativeToken = ZERO_ADDRESS;

  const rebalancerAddress = await getDeployProxyXAddress(id);
  const rebalancerVersion = "Rebalancer";
  const usdcAddress = config.Tokens.USDC?.Address || ZERO_ADDRESS;

  await upgradeProxyX<Rebalancer>(
    verifier.deployX,
    rebalancerAddress,
    rebalancerVersion,
    sender,
    [
      DomainSolidity[network], mainAssetInfo.Address, usdcAddress,
      config.Omnibridge, config.GnosisUSDCxDAI, config.GnosisUSDCTransmuter, config.GnosisAMB,
      config.USDT0OFT, config.USDT0FeeNativeToken, config.CCTPV2.TokenMessenger, config.CCTPV2.MessageTransmitter,
    ],
    id,
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
