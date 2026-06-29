import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {
  getVerifier,
  deployProxyX,
  logDeployers,
  getNetworkConfig,
  getHardhatNetworkConfig,
} from "./helpers";
import {resolveProxyXAddress, resolveXAddress} from "../test/helpers";
import {isSet, assert, assertAddress} from "./common";
import {StashDexProcessor} from "../typechain-types";
import {DEFAULT_PROXY_TYPE, Network, NetworkConfig, Token} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log(`Deploying ${process.env.PROCESSOR_TOKEN} StashDex Processor`);
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }
  
  await logDeployers();

  assert(isSet(process.env.PROCESSOR_TOKEN), "PROCESSOR_TOKEN must be set");
  const targetAsset = process.env.PROCESSOR_TOKEN as Token;
  assert(Object.values(Token).includes(targetAsset), "PROCESSOR_TOKEN must be a valid Token");
  const tokenInfo = config.Tokens[targetAsset];
  assert(tokenInfo, `${targetAsset} not found in config`);
  assertAddress(tokenInfo.Address, `${targetAsset}.Address must be an address`);
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");
  assertAddress(config.SignerAddress, "SignerAddress must be an address");
  assert(config.StashDex, "StashDex must be in config");

  const id = `StashDexProcessor${targetAsset}`;
  const stashDexAddress = await resolveProxyXAddress("StashStablecoinDex", false);
  const oracleAddress = await resolveXAddress(config.StashDex.Oracle);
  console.table({
    StashDex: stashDexAddress,
    Oracle: oracleAddress,
    Token: tokenInfo.Address,
    Caller: config.RepayerCaller,
    Id: `${DEFAULT_PROXY_TYPE}${id}`,
  });

  const {target: processor, targetAdmin: processorAdmin} = await deployProxyX<StashDexProcessor>(
    verifier.deployX,
    "StashDexProcessor",
    deployer,
    config.Admin,
    [tokenInfo.Address, stashDexAddress, oracleAddress],
    [config.Admin, config.RepayerCaller, config.SignerAddress],
    id,
    verifier,
    1,
  );
  const subProcessor = await processor.subProcessor();
  console.log(`${id}: ${processor.target}`);
  console.log(`${id} ProxyAdmin: ${processorAdmin.target}`);
  console.log(`StashDexSubProcessor${targetAsset}: ${subProcessor}`);

  await verifier.addContractForVerification(subProcessor, [tokenInfo.Address]);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
