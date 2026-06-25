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
import {resolveProxyXAddress} from "../test/helpers";
import {isSet, assert, assertAddress} from "./common";
import {Processor} from "../typechain-types";
import {Network, NetworkConfig, Token} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  // Target token is configurable via PROCESSOR_TOKEN
  const token = (process.env.PROCESSOR_TOKEN) as Token;
  assert(
    Object.values(Token).includes(token),
    `PROCESSOR_TOKEN must be one of: ${Object.values(Token).join(", ")}`,
  );

  let network: Network;
  let config: NetworkConfig;
  console.log(`Deploying ${token} Processor`);
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers();

  const tokenInfo = config.Tokens[token];
  assert(tokenInfo, `${token} must be configured`);
  assertAddress(tokenInfo.Address, `${token} must be an address`);
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");

  // Keep the historical "Processor" deploy id for USDC (already deployed) and suffix the token
  // symbol for any other target token so each proxy gets a distinct, token-specific deploy name.
  const id = token === Token.USDC ? "Processor" : `Processor${token}`;

  const repayerAddress = await resolveProxyXAddress("Repayer");
  console.table({
    Processor: id,
    Token: token,
    TokenAddress: tokenInfo.Address,
    Repayer: repayerAddress,
    RepayerCaller: config.RepayerCaller,
  });

  const {target: processor, targetAdmin: processorAdmin} = await deployProxyX<Processor>(
    verifier.deployX,
    "Processor",
    deployer,
    config.Admin,
    [tokenInfo.Address, repayerAddress],
    [config.Admin, config.RepayerCaller, config.SignerAddress],
    id,
    verifier,
    1,
  );
  const subProcessor = await processor.subProcessor();
  console.log(`${id}: ${processor.target}`);
  console.log(`${id}ProxyAdmin: ${processorAdmin.target}`);
  console.log(`SubProcessor: ${subProcessor}`);

  await verifier.addContractForVerification(subProcessor, [tokenInfo.Address]);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
