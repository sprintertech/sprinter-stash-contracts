import dotenv from "dotenv"; 
dotenv.config();

import hre from "hardhat";
import {isAddress, MaxUint256, getBigInt} from "ethers";
import {getContractAt, getCreateAddress, deploy, ZERO_BYTES32} from "../test/helpers";
import {assert, getVerifier} from "./helpers";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool,
} from "../typechain-types";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const admin: string = isAddress(process.env.ADMIN) ? process.env.ADMIN : deployer.address;
  const adjuster: string = isAddress(process.env.ADJUSTER) ? process.env.ADJUSTER : deployer.address;
  const maxLimit: bigint = MaxUint256 / 10n ** 12n;
  const assetsLimit: bigint = getBigInt(process.env.ASSETS_LIMIT || maxLimit);
  let usdc: string;
  if (isAddress(process.env.USDC)) {
    usdc = process.env.USDC;
  } else {
    const testUSDC = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    usdc = await testUSDC.getAddress();
  }

  console.log("TEST: Using TEST Liquidity Pool");
  const liquidityPool = (await deploy("TestLiquidityPool", deployer, {}, usdc)) as TestLiquidityPool;

  const startingNonce = await deployer.getNonce();

  const verifier = getVerifier();

  const liquidityHubAddress = await getCreateAddress(deployer, startingNonce + 2);
  const lpToken = (
    await verifier.deploy("SprinterUSDCLPShare", deployer, {nonce: startingNonce + 0}, liquidityHubAddress)
  ) as SprinterUSDCLPShare;

  const liquidityHubImpl = (
    await verifier.deploy("LiquidityHub", deployer, {nonce: startingNonce + 1}, lpToken.target, liquidityPool.target)
  ) as LiquidityHub;
  const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(
    usdc, admin, adjuster, assetsLimit
  )).data;
  const liquidityHubProxy = (await verifier.deploy(
    "TransparentUpgradeableProxy", deployer, {nonce: startingNonce + 2},
    liquidityHubImpl.target, admin, liquidityHubInit
  )) as TransparentUpgradeableProxy;
  const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
  const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
  const liquidityHubAdmin = (await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress)) as ProxyAdmin;

  assert(liquidityHubAddress == liquidityHubProxy.target, "LiquidityHub address mismatch");

  const DEFAULT_ADMIN_ROLE = ZERO_BYTES32;

  console.log("TEST: Using default admin role for Hub on Pool");
  await liquidityPool.grantRole(DEFAULT_ADMIN_ROLE, liquidityHub.target);

  console.log();
  console.log(`Admin: ${admin}`);
  console.log(`SprinterUSDCLPShare: ${lpToken.target}`);
  console.log(`LiquidityHub: ${liquidityHub.target}`);
  console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
  console.log(`USDC: ${usdc}`);

  if (process.env.VERIFY === "true") {
    await verifier.verify();
  }
}

main();
