import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress, MaxUint256, getBigInt} from "ethers";
import {toBytes32} from "../test/helpers";
import {
  getVerifier, deployProxyX,
} from "./helpers";
import {
  assert, isSet, ProviderSolidity, DomainSolidity,
} from "./common";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub,
  SprinterLiquidityMining, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  Rebalancer, LiquidityPool,
} from "../typechain-types";
import {networkConfig, Network, Provider, NetworkConfig} from "../network.config";

async function main() {
  // Rework granting admin roles on deployments so that deployer does not have to be admin.
  const [deployer] = await hre.ethers.getSigners();
  const admin: string = isAddress(process.env.ADMIN) ? process.env.ADMIN : deployer.address;
  const adjuster: string = isAddress(process.env.ADJUSTER) ? process.env.ADJUSTER : deployer.address;
  const maxLimit: bigint = MaxUint256 / 10n ** 12n;
  const assetsLimit: bigint = getBigInt(process.env.ASSETS_LIMIT || maxLimit);

  const rebalanceCaller: string = isAddress(process.env.REBALANCE_CALLER) ?
    process.env.REBALANCE_CALLER : deployer.address;

  const mpcAddress: string = isAddress(process.env.MPC_ADDRESS) ?
    process.env.MPC_ADDRESS : deployer.address;
  const withdrawProfit: string = isAddress(process.env.WITHDRAW_PROFIT) ?
    process.env.WITHDRAW_PROFIT : deployer.address;
  const minHealthFactor: bigint = getBigInt(process.env.MIN_HEALTH_FACTOR || 500n) * 10n ** 18n / 100n;
  const defaultLTV: bigint = getBigInt(process.env.DEFAULT_LTV || 20n) * 10n ** 18n / 100n;

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let config: NetworkConfig;
  if (Object.values(Network).includes(hre.network.name as Network)) {
    config = networkConfig[hre.network.name as Network];
  } else {
    console.log("TEST: Using TEST USDC and CCTP");
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

  let liquidityPool: LiquidityPool;
  if (config.Aave) {
    const {target, targetAdmin: liquidityPoolAdmin} = await deployProxyX<LiquidityPool>(
      verifier.deployX,
      "LiquidityPool",
      deployer,
      admin,
      [config.USDC, config.Aave],
      [
        admin,
        minHealthFactor,
        defaultLTV,
        mpcAddress,
      ],
    );
    liquidityPool = target;
    console.log(`LiquidityPoolProxyAdmin: ${liquidityPoolAdmin.target}`);
  } else {
    console.log("TEST: Using TEST Liquidity Pool");
    liquidityPool = (await verifier.deployX(
      "TestLiquidityPool",
      deployer,
      {},
      [config.USDC, admin],
      "LiquidityPool")
    ) as LiquidityPool;
  }

  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxyX<Rebalancer>(
    verifier.deployX,
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
    "Rebalancer",
  );

  await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await liquidityPool.grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit);

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

    const liquidityHubAddress = await verifier.getDeployProxyXAddress("LiquidityHub", deployer);
    const lpToken = (await verifier.deployX(
      "SprinterUSDCLPShare",
      deployer,
      {},
      [liquidityHubAddress],
      "SprinterUSDCLPShare",
      "contracts/SprinterUSDCLPShare.sol:SprinterUSDCLPShare"
    )) as SprinterUSDCLPShare;

    const {target: liquidityHub, targetAdmin: liquidityHubAdmin} = await deployProxyX<LiquidityHub>(
      verifier.deployX,
      "LiquidityHub",
      deployer,
      admin,
      [lpToken, liquidityPool],
      [config.USDC, admin, adjuster, assetsLimit],
    );

    assert(liquidityHubAddress == liquidityHub.target, "LiquidityHub address mismatch");
    const liquidityMining = (
      await verifier.deployX("SprinterLiquidityMining", deployer, {}, [admin, liquidityHub, tiers])
    ) as SprinterLiquidityMining;

    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub);

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

  await verifier.verify(process.env.VERIFY === "true");
}

main();
