import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {
  getVerifier, getHardhatNetworkConfig, getNetworkConfig, logDeployers, deployProxyX, getMainAsset, idWithMainAsset,
} from "./helpers";
import {resolveProxyXAddress, toBytes32, resolveXAddress} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE, sameAddress} from "./common";
import {ERC4626Adapter, ProxyAdmin} from "../typechain-types";
import {Network, NetworkConfig, ERC4626AdapterId} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = ERC4626AdapterId;

  let network: Network;
  let config: NetworkConfig;
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }
  await logDeployers();

  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);
  assert(mainAssetConfig.ERC4626AdapterTargetVault, `${mainAsset} ERC4626AdapterTargetVault must be configured`);
  id = idWithMainAsset(mainAsset, id);
  console.log(`Deploying ${id}`);

  const rebalancer = await resolveProxyXAddress(idWithMainAsset(mainAsset, "Rebalancer"));
  console.log(`Rebalancer: ${rebalancer}`);

  const targetVault = await resolveXAddress(mainAssetConfig.ERC4626AdapterTargetVault);
  console.log(`Target Vault: ${targetVault}`);

  const {
    target: erc4626Adapter, targetAdmin: erc4626AdapterAdmin,
  }: {target: ERC4626Adapter; targetAdmin: ProxyAdmin} =
    await deployProxyX<ERC4626Adapter>(
      verifier.deployX,
      "ERC4626Adapter",
      deployerWithNonce,
      config.Admin,
      [mainAssetInfo.Address, targetVault],
      [deployer],
      id,
      verifier,
    );
  console.log(`${id}: ${erc4626Adapter.target}`);
  console.log(`${id}ProxyAdmin: ${erc4626AdapterAdmin.target}`);

  await erc4626Adapter.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await erc4626Adapter.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  let lastTx = await erc4626Adapter.grantRole(PAUSER_ROLE, config.Pauser);

  if (!sameAddress(deployer.address, config.Admin)) {
    await erc4626Adapter.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    lastTx = await erc4626Adapter.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
  await lastTx.wait();
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
