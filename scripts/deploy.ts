import dotenv from "dotenv"; 
dotenv.config();

import hre from "hardhat";
import {isAddress} from "ethers";
import {getContractAt, getCreateAddress, deploy} from "../test/helpers";
import {assert, getVerifier} from "./helpers";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub, TransparentUpgradeableProxy, ProxyAdmin
} from "../typechain-types";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const admin: string = isAddress(process.env.ADMIN) ? process.env.ADMIN : deployer.address;
  let usdc: string;
  if (isAddress(process.env.USDC)) {
    usdc = process.env.USDC;
  } else {
    const testUSDC = await deploy("TestUSDC", deployer, {});
    usdc = await testUSDC.getAddress();
  }

  const startingNonce = await deployer.getNonce();

  const verifier = getVerifier();

  const liquidityHubAddress = await getCreateAddress(deployer, startingNonce + 2);
  const lpToken = (
    await verifier.deploy("SprinterUSDCLPShare", deployer, {nonce: startingNonce + 0}, liquidityHubAddress)
  ) as SprinterUSDCLPShare;

  const liquidityHubImpl = (
    await verifier.deploy("LiquidityHub", deployer, {nonce: startingNonce + 1}, lpToken.target)
  ) as LiquidityHub;
  const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(usdc, admin)).data;
  const liquidityHubProxy = (await verifier.deploy(
    "TransparentUpgradeableProxy", deployer, {nonce: startingNonce + 2},
    liquidityHubImpl.target, admin, liquidityHubInit
  )) as TransparentUpgradeableProxy;
  const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
  const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
  const liquidityHubAdmin = (await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress)) as ProxyAdmin;

  assert(liquidityHubAddress == liquidityHubProxy.target, "LiquidityHub address mismatch");

  console.log();
  console.log(`Admin: ${lpToken.target}`);
  console.log(`SprinterUSDCLPShare: ${lpToken.target}`);
  console.log(`LiquidityHub: ${liquidityHub.target}`);
  console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
  console.log(`USDC: ${usdc}`);

  if (process.env.VERIFY === "true") {
    await verifier.verify();
  }
}

main();
