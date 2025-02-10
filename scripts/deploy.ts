import dotenv from "dotenv"; 
dotenv.config();

import hre from "hardhat";
import {isAddress, MaxUint256, getBigInt} from "ethers";
import {ZERO_BYTES32} from "../test/helpers";
import {
  assert, getVerifier, isSet, ProviderSolidity, DomainSolidity, deployProxy,
  getProxyCreateAddress,
} from "./helpers";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub,
  TestLiquidityPool, SprinterLiquidityMining, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  Rebalancer,
} from "../typechain-types";
import {networkConfig, Network, Provider, NetworkConfig} from "../network.config";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const admin: string = isAddress(process.env.ADMIN) ? process.env.ADMIN : deployer.address;
  const rebalanceCaller: string = isAddress(process.env.REBALANCE_CALLER) ?
    process.env.REBALANCE_CALLER : deployer.address;
  const adjuster: string = isAddress(process.env.ADJUSTER) ? process.env.ADJUSTER : deployer.address;
  const maxLimit: bigint = MaxUint256 / 10n ** 12n;
  const assetsLimit: bigint = getBigInt(process.env.ASSETS_LIMIT || maxLimit);

  const verifier = getVerifier();

  let config: NetworkConfig;
  if (Object.values(Network).includes(hre.network.name as Network)) {
    config = networkConfig[hre.network.name as Network];
  } else {
    const testUSDC = (await verifier.deploy("TestUSDC", deployer)) as TestUSDC;
    const cctpTokenMessenger = (await verifier.deploy("TestCCTPTokenMessenger", deployer)) as TestCCTPTokenMessenger;
    const cctpMessageTransmitter = (
      await verifier.deploy("TestCCTPMessageTransmitter", deployer)
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
  const liquidityPool = (await verifier.deploy("TestLiquidityPool", deployer, {}, config.USDC)) as TestLiquidityPool;

  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxy<Rebalancer>(
    verifier.deploy,
    rebalancerVersion,
    deployer,
    admin,
    [liquidityPool, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter],
    [
      admin,
      rebalanceCaller,
      config.Routes ? config.Routes.Domains.map(el => DomainSolidity[el]) : [],
      config.Routes ? config.Routes.Providers.map(el => ProviderSolidity[el]) : [],
    ],
  );

  const DEFAULT_ADMIN_ROLE = ZERO_BYTES32;

  console.log("TEST: Using default admin role for Rebalancer on Pool");
  await liquidityPool.grantRole(DEFAULT_ADMIN_ROLE, rebalancer);

  if (config.IsHub) {
    const tiers = [];

    for (let i = 1;; i++) {
      if (!isSet(process.env[`TIER_${i}_SECONDS`])) {
        break;
      }
      const period = BigInt(process.env[`TIER_${i}_SECONDS`] || "0");
      const multiplier = BigInt(process.env[`TIER_${i}_MULTIPLIER`] || "0");
      tiers.push({period, multiplier});
    }

    if (tiers.length == 0) {
      throw new Error("Empty liquidity mining tiers configuration.");
    }

    const startingNonce = await deployer.getNonce();

    const liquidityHubAddress = await getProxyCreateAddress(deployer, startingNonce + 1);
    const lpToken = (
      await verifier.deploy("SprinterUSDCLPShare", deployer, {nonce: startingNonce + 0}, liquidityHubAddress)
    ) as SprinterUSDCLPShare;

    const {target: liquidityHub, targetAdmin: liquidityHubAdmin} = await deployProxy<LiquidityHub>(
      verifier.deploy,
      "LiquidityHub",
      deployer,
      admin,
      [lpToken, liquidityPool],
      [config.USDC, admin, adjuster, assetsLimit],
    );

    assert(liquidityHubAddress == liquidityHub.target, "LiquidityHub address mismatch");
    const liquidityMining = (
      await verifier.deploy("SprinterLiquidityMining", deployer, {}, admin, liquidityHub, tiers)
    ) as SprinterLiquidityMining;

    console.log("TEST: Using default admin role for Hub on Pool");
    await liquidityPool.grantRole(DEFAULT_ADMIN_ROLE, liquidityHub);

    console.log();
    console.log(`SprinterUSDCLPShare: ${lpToken.target}`);
    console.log(`LiquidityHub: ${liquidityHub.target}`);
    console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
    console.log(`SprinterLiquidityMining: ${liquidityMining.target}`);
    console.log("Tiers:");
    console.table(tiers.map(el => {
      const multiplier = `${el.multiplier / 100n}.${el.multiplier % 100n}x`;
      return {seconds: Number(el.period), multiplier};
    }));
  }

  console.log(`Admin: ${admin}`);
  console.log(`LiquidityPool: ${liquidityPool.target}`);
  console.log(`USDC: ${config.USDC}`);
  console.log(`Rebalancer: ${rebalancer.target}`);
  console.log(`RebalancerProxyAdmin: ${rebalancerAdmin.target}`);
  console.log("Routes:");
  console.table(config.Routes || {});

  if (process.env.VERIFY === "true") {
    await verifier.verify();
  }
}

main();
