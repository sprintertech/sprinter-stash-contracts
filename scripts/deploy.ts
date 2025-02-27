import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress, MaxUint256, getBigInt} from "ethers";
import {toBytes32} from "../test/helpers";
import {
  getVerifier, deployProxy, getProxyCreateAddress,
} from "./helpers";
import {
  assert, isSet, ProviderSolidity, DomainSolidity,
} from "./common";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub,
  SprinterLiquidityMining, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  Rebalancer, LiquidityPool,
} from "../typechain-types";
import {networkConfig, Network, Provider, NetworkConfig, PREDICTED} from "../network.config";

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
  const pauser: string = isAddress(process.env.PAUSER) ?
    process.env.PAUSER : deployer.address;
  const minHealthFactor: bigint = getBigInt(process.env.MIN_HEALTH_FACTOR || 500n) * 10n ** 18n / 100n;
  const defaultLTV: bigint = getBigInt(process.env.DEFAULT_LTV || 20n) * 10n ** 18n / 100n;

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  const verifier = getVerifier();

  let network: Network;
  let config: NetworkConfig;
  console.log(`Deploying to: ${hre.network.name}`);
  if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = networkConfig[network];
  } else {
    network = Network.BASE;
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
        Pools: [PREDICTED],
        Domains: [Network.ETHEREUM],
        Providers: [Provider.CCTP],
      },
    };
  }

  let liquidityPool: LiquidityPool;
  if (config.Aave) {
    console.log("Deploying AAVE Liquidity Pool");
    liquidityPool = (await verifier.deploy(
      "LiquidityPoolAave",
      deployer,
      {},
      [
        config.USDC,
        config.Aave,
        admin,
        mpcAddress,
        minHealthFactor,
        defaultLTV,
      ],
    )) as LiquidityPool;
  } else {
    console.log("Deploying USDC Liquidity Pool");
    liquidityPool = (await verifier.deploy(
      "LiquidityPool", deployer, {}, [config.USDC, admin, mpcAddress]
    )) as LiquidityPool;
  }

  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  if (!config.Routes) {
    config.Routes = {
      Pools: [],
      Domains: [],
      Providers: [],
    };
  }

  config.Routes.Pools.push(PREDICTED);
  config.Routes.Domains.push(network);
  config.Routes.Providers.push(Provider.LOCAL);

  const liquidityPoolAddress = await liquidityPool.getAddress();
  config.Routes.Pools = config.Routes!.Pools!.map(el => el == PREDICTED ? liquidityPoolAddress : el) || [];

  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxy<Rebalancer>(
    verifier.deploy,
    rebalancerVersion,
    deployer,
    admin,
    [DomainSolidity[network], config.USDC, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter],
    [
      admin,
      rebalanceCaller,
      config.Routes.Pools,
      config.Routes!.Domains!.map(el => DomainSolidity[el]) || [],
      config.Routes!.Providers!.map(el => ProviderSolidity[el]) || [],
    ],
  );

  await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await liquidityPool.grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit);
  await liquidityPool.grantRole(PAUSER_ROLE, pauser);

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
    const lpToken = (await verifier.deploy(
      "SprinterUSDCLPShare",
      deployer,
      {},
      [liquidityHubAddress],
      "contracts/SprinterUSDCLPShare.sol:SprinterUSDCLPShare"
    )) as SprinterUSDCLPShare;

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
      await verifier.deploy("SprinterLiquidityMining", deployer, {}, [admin, liquidityHub, tiers])
    ) as SprinterLiquidityMining;

    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub);

    console.log(`SprinterUSDCLPShare: ${lpToken.target}`);
    console.log(`LiquidityHub: ${liquidityHub.target}`);
    console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
    console.log(`LiquidityHub Adjuster: ${adjuster}`);
    console.log(`SprinterLiquidityMining: ${liquidityMining.target}`);
    console.log("Tiers:");
    console.table(tiers.map(el => {
      const multiplier = `${el.multiplier / 1000000000n}.${el.multiplier % 1000000000n}x`;
      return {seconds: Number(el.period), multiplier};
    }));
  }

  console.log(`Admin: ${admin}`);
  console.log(`LiquidityPool: ${liquidityPool.target}`);
  console.log(`LiquidityPool Withdraw Profit: ${withdrawProfit}`);
  console.log(`LiquidityPool Pauser: ${pauser}`);
  console.log(`USDC: ${config.USDC}`);
  console.log(`Rebalancer: ${rebalancer.target}`);
  console.log(`RebalancerProxyAdmin: ${rebalancerAdmin.target}`);
  console.log("Routes:");
  console.table(config.Routes || {});

  await verifier.verify(process.env.VERIFY === "true");
}

main();
