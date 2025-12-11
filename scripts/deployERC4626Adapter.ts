import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig, logDeployers} from "./helpers";
import {resolveProxyXAddress, toBytes32, resolveXAddress} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {ERC4626Adapter} from "../typechain-types";
import {Network, NetworkConfig, ERC4626AdapterUSDCVersions} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  await logDeployers();

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = ERC4626AdapterUSDCVersions.at(-1);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying ERC4626 Adapter USDC");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  assert(config.ERC4626AdapterUSDCTargetVault, "ERC4626AdapterUSDCTargetVault must be configured");

  const rebalancer = await resolveProxyXAddress("Rebalancer");
  console.log(`Rebalancer: ${rebalancer}`);

  const targetVault = await resolveXAddress(config.ERC4626AdapterUSDCTargetVault);
  console.log(`Target Vault: ${targetVault}`);

  console.log("Deploying ERC4626 Adapter USDC");
  const erc4626AdapterUSDC: ERC4626Adapter = (await verifier.deployX(
    "ERC4626Adapter",
    deployer,
    {},
    [
      config.Tokens.USDC,
      targetVault,
      deployer,
    ],
    id
  )) as ERC4626Adapter;
  console.log(`${id}: ${erc4626AdapterUSDC.target}`);

  await erc4626AdapterUSDC!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await erc4626AdapterUSDC!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await erc4626AdapterUSDC!.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await erc4626AdapterUSDC!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await erc4626AdapterUSDC!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
