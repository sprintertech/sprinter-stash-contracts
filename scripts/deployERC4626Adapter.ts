import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig, logDeployers, deployProxyX} from "./helpers";
import {resolveProxyXAddress, toBytes32, resolveXAddress} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {ERC4626Adapter, ProxyAdmin} from "../typechain-types";
import {Network, NetworkConfig, ERC4626AdapterUSDCVersions} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

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
  await logDeployers();

  assert(config.ERC4626AdapterUSDCTargetVault, "ERC4626AdapterUSDCTargetVault must be configured");

  const rebalancer = await resolveProxyXAddress("Rebalancer");
  console.log(`Rebalancer: ${rebalancer}`);

  const targetVault = await resolveXAddress(config.ERC4626AdapterUSDCTargetVault);
  console.log(`Target Vault: ${targetVault}`);

  console.log("Deploying ERC4626 Adapter USDC");
  const {
    target: erc4626AdapterUSDC, targetAdmin: erc4626AdapterUSDCAdmin,
  }: {target: ERC4626Adapter; targetAdmin: ProxyAdmin} =
    await deployProxyX<ERC4626Adapter>(
      verifier.deployX,
      "ERC4626Adapter",
      deployerWithNonce,
      config.Admin,
      [config.Tokens.USDC.Address, targetVault],
      [deployer],
      id,
      verifier,
    );
  console.log(`${id}: ${erc4626AdapterUSDC.target}`);
  console.log(`${id}ProxyAdmin: ${erc4626AdapterUSDCAdmin.target}`);

  await erc4626AdapterUSDC.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await erc4626AdapterUSDC.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  let lastTx = await erc4626AdapterUSDC.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await erc4626AdapterUSDC.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    lastTx = await erc4626AdapterUSDC.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
  await lastTx.wait();
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
