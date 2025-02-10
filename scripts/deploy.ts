import dotenv from "dotenv"; 
dotenv.config();

import hre from "hardhat";
import {isAddress, MaxUint256, getBigInt} from "ethers";
import {getContractAt, getCreateAddress, deploy, ZERO_BYTES32} from "../test/helpers";
import {assert, getVerifier, isSet, ProviderSolidity, DomainSolidity} from "./helpers";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, SprinterLiquidityMining, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  Rebalancer,
} from "../typechain-types";
import {networkConfig, Network, Provider, NetworkConfig} from "../network.config";

const DAY = 60n * 60n * 24n;

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const admin: string = isAddress(process.env.ADMIN) ? process.env.ADMIN : deployer.address;
  const rebalanceCaller: string = isAddress(process.env.REBALANCE_CALLER) ?
    process.env.REBALANCE_CALLER : deployer.address;
  const adjuster: string = isAddress(process.env.ADJUSTER) ? process.env.ADJUSTER : deployer.address;
  const maxLimit: bigint = MaxUint256 / 10n ** 12n;
  const assetsLimit: bigint = getBigInt(process.env.ASSETS_LIMIT || maxLimit);

  let config: NetworkConfig;
  if (Object.values(Network).includes(hre.network.name as Network)) {
    config = networkConfig[hre.network.name as Network];
  } else {
    const testUSDC = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const cctpTokenMessenger = (await deploy("TestCCTPTokenMessenger", deployer, {})) as TestCCTPTokenMessenger;
    const cctpMessageTransmitter = (
      await deploy("TestCCTPMessageTransmitter", deployer, {})
    ) as TestCCTPMessageTransmitter;

    config = {
      CCTP: {
        TokenMessenger: await cctpTokenMessenger.getAddress(),
        MessageTransmitter: await cctpMessageTransmitter.getAddress(),
      },
      USDC: await testUSDC.getAddress(),
      IsTest: false,
      IsHub: true,
      Routes: {
        Domains: [Network.ETHEREUM],
        Providers: [Provider.CCTP],
      },
    };
  }

  console.log("TEST: Using TEST Liquidity Pool");
  const liquidityPool = (await deploy("TestLiquidityPool", deployer, {}, config.USDC)) as TestLiquidityPool;

  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  const rebalancerImpl = (
    await deploy(rebalancerVersion, deployer, {},
      liquidityPool.target, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter
    )
  ) as Rebalancer;
  const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
    admin,
    rebalanceCaller,
    config.Routes ? config.Routes.Domains.map(el => DomainSolidity[el]) : [],
    config.Routes ? config.Routes.Providers.map(el => ProviderSolidity[el]) : []
  )).data;
  const rebalancerProxy = (await deploy(
    "TransparentUpgradeableProxy", deployer, {},
    rebalancerImpl.target, admin, rebalancerInit
  )) as TransparentUpgradeableProxy;
  const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy.target, deployer)) as Rebalancer;
  const rebalancerProxyAdminAddress = await getCreateAddress(rebalancerProxy, 1);
  const rebalancerAdmin = (await getContractAt("ProxyAdmin", rebalancerProxyAdminAddress, deployer)) as ProxyAdmin;

  const DEFAULT_ADMIN_ROLE = ZERO_BYTES32;

  console.log("TEST: Using default admin role for Rebalancer on Pool");
  await liquidityPool.grantRole(DEFAULT_ADMIN_ROLE, rebalancer.target);

  const verifier = getVerifier();

  if (config.IsHub) {
    const tiers = [];

    for (let i = 1;; i++) {
      if (!isSet(process.env[`TIER_${i}_DAYS`])) {
        break;
      }
      const period = BigInt(process.env[`TIER_${i}_DAYS`] || "0") * DAY;
      const multiplier = BigInt(process.env[`TIER_${i}_MULTIPLIER`] || "0");
      tiers.push({period, multiplier});
    }

    if (tiers.length == 0) {
      throw new Error("Empty liquidity mining tiers configuration.");
    }

    const startingNonce = await deployer.getNonce();

    const liquidityHubAddress = await getCreateAddress(deployer, startingNonce + 2);
    const lpToken = (
      await verifier.deploy("SprinterUSDCLPShare", deployer, {nonce: startingNonce + 0}, liquidityHubAddress)
    ) as SprinterUSDCLPShare;

    const liquidityHubImpl = (
      await verifier.deploy("LiquidityHub", deployer, {nonce: startingNonce + 1}, lpToken.target, liquidityPool.target)
    ) as LiquidityHub;
    const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(
      config.USDC, admin, adjuster, assetsLimit
    )).data;
    const liquidityHubProxy = (await verifier.deploy(
      "TransparentUpgradeableProxy", deployer, {nonce: startingNonce + 2},
      liquidityHubImpl.target, admin, liquidityHubInit
    )) as TransparentUpgradeableProxy;
    const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
    const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
    const liquidityHubAdmin = (await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress)) as ProxyAdmin;

    assert(liquidityHubAddress == liquidityHubProxy.target, "LiquidityHub address mismatch");
    const liquidityMining = (
      await deploy("SprinterLiquidityMining", deployer, {}, admin, liquidityHub.target, tiers)
    ) as SprinterLiquidityMining;

    console.log("TEST: Using default admin role for Hub on Pool");
    await liquidityPool.grantRole(DEFAULT_ADMIN_ROLE, liquidityHub.target);

    console.log();
    console.log(`SprinterUSDCLPShare: ${lpToken.target}`);
    console.log(`LiquidityHub: ${liquidityHub.target}`);
    console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
    console.log(`SprinterLiquidityMining: ${liquidityMining.target}`);
    console.log("Tiers:");
    console.table(tiers);
  }

  console.log(`Admin: ${admin}`);
  console.log(`LiquidityPool: ${liquidityPool.target}`);
  console.log(`USDC: ${config.USDC}`);
  console.log(`Rebalancer: ${rebalancer.target}`);
  console.log(`RebalancerProxyAdmin: ${rebalancerAdmin.target}`);
  if (config.Routes) {
    console.log("Routes:");
    console.table(config.Routes);
  }

  if (process.env.VERIFY === "true") {
    await verifier.verify();
  }
}

main();
