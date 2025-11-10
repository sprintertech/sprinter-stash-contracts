import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {MaxUint256} from "ethers";
import {toBytes32, resolveProxyXAddress, resolveXAddress, getContractAt, resolveXAddresses} from "../test/helpers";
import {
  getVerifier, deployProxyX, getHardhatNetworkConfig, getNetworkConfig, percentsToBps,
  getProxyXAdmin,
} from "./helpers";
import {
  assert, isSet, ProviderSolidity, DomainSolidity, DEFAULT_ADMIN_ROLE, ZERO_ADDRESS,
  sameAddress,
  assertAddress,
} from "./common";
import {
  SprinterUSDCLPShare, LiquidityHub, SprinterLiquidityMining,
  Rebalancer, Repayer, LiquidityPool, LiquidityPoolAave, LiquidityPoolStablecoin, LiquidityPoolAaveLongTerm,
  ProxyAdmin, PublicLiquidityPool, ERC4626Adapter,
} from "../typechain-types";
import {
  Network, Provider, NetworkConfig,
  LiquidityPoolAaveUSDCVersions,
  LiquidityPoolAaveUSDCLongTermVersions,
  LiquidityPoolUSDCVersions,
  LiquidityPoolUSDCStablecoinVersions,
  LiquidityPoolPublicUSDCVersions,
  ERC4626AdapterUSDCVersions,
} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");
  const BORROW_LONG_TERM_ROLE = toBytes32("BORROW_LONG_TERM_ROLE");
  const REPAYER_ROLE = toBytes32("REPAYER_ROLE");
  const FEE_SETTER_ROLE = toBytes32("FEE_SETTER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying contracts set");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  assert(config.AavePool! || config.AavePoolLongTerm! || config.USDCPool! || config.USDCStablecoinPool!,
    "At least one pool should be present.");
  assertAddress(config.USDC, "USDC must be an address");
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.WithdrawProfit, "WithdrawProfit must be an address");
  assertAddress(config.Pauser, "Pauser must be an address");
  assertAddress(config.RebalanceCaller, "RebalanceCaller must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");
  assertAddress(config.MpcAddress, "MpcAddress must be an address");
  assertAddress(config.SignerAddress, "SignerAddress must be an address");
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");

  if (!config.CCTP) {
    config.CCTP = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
    };
  }

  if (config.Hub) {
    assert(config.Hub.Tiers.length > 0, "Empty liquidity mining tiers configuration.");
    assert(config.Hub.AssetsLimit <= MaxUint256 / 10n ** 12n, "Assets limit is too high");
  }

  const rebalancerRoutes: {Pools: string[], Domains: Network[], Providers: Provider[]} = {
    Pools: [],
    Domains: [],
    Providers: [],
  };
  if (config.RebalancerRoutes) {
    for (const [pool, domainProviders] of Object.entries(config.RebalancerRoutes)) {
      for (const [domain, providers] of Object.entries(domainProviders)) {
        for (const provider of providers) {
          rebalancerRoutes.Pools.push(pool);
          rebalancerRoutes.Domains.push(domain as Network);
          rebalancerRoutes.Providers.push(provider);
        }
      }
    }
  }

  const repayerRoutes: {Pools: string[], Domains: Network[], Providers: Provider[], SupportsAllTokens: boolean[]} = {
    Pools: [],
    Domains: [],
    Providers: [],
    SupportsAllTokens: [],
  };
  if (config.RepayerRoutes) {
    for (const [pool, domainProviders] of Object.entries(config.RepayerRoutes)) {
      for (const [domain, providers] of Object.entries(domainProviders.Domains)) {
        for (const provider of providers) {
          repayerRoutes.Pools.push(pool);
          repayerRoutes.Domains.push(domain as Network);
          repayerRoutes.Providers.push(provider);
          repayerRoutes.SupportsAllTokens.push(domainProviders.SupportsAllTokens);
        }
      }
    }
  }

  if (!config.AcrossV3SpokePool) {
    config.AcrossV3SpokePool = ZERO_ADDRESS;
  }
  if (!config.StargateTreasurer) {
    config.StargateTreasurer = ZERO_ADDRESS;
  }
  if (!config.EverclearFeeAdapter) {
    config.EverclearFeeAdapter = ZERO_ADDRESS;
  }
  if (!config.OptimismStandardBridge) {
    config.OptimismStandardBridge = ZERO_ADDRESS;
  }

  let mainPool: LiquidityPool | undefined = undefined;
  let aavePoolLongTerm: LiquidityPoolAaveLongTerm;
  if (config.AavePoolLongTerm) {
    const id = LiquidityPoolAaveUSDCLongTermVersions.at(-1);
    const minHealthFactor = BigInt(config.AavePoolLongTerm.MinHealthFactor) * 10000n / 100n;
    const defaultLTV = BigInt(config.AavePoolLongTerm.DefaultLTV) * 10000n / 100n;
    console.log("Deploying AAVE Liquidity Pool Long Term");
    aavePoolLongTerm = (await verifier.deployX(
      "LiquidityPoolAaveLongTerm",
      deployer,
      {},
      [
        config.USDC,
        config.AavePoolLongTerm.AaveAddressesProvider,
        deployer,
        config.MpcAddress,
        minHealthFactor,
        defaultLTV,
        config.WrappedNativeToken,
        config.SignerAddress,
      ],
      id,
    )) as LiquidityPoolAaveLongTerm;

    if (config.AavePoolLongTerm.TokenLTVs) {
      const tokens = Object.keys(config.AavePoolLongTerm.TokenLTVs);
      const LTVs = Object.values(config.AavePoolLongTerm.TokenLTVs);
      await aavePoolLongTerm.setBorrowTokenLTVs(
        tokens,
        percentsToBps(LTVs),
      );
    }
    console.log(`${id}: ${aavePoolLongTerm.target}`);

    rebalancerRoutes.Pools.push(await aavePoolLongTerm.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await aavePoolLongTerm.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(true);

    mainPool = aavePoolLongTerm as LiquidityPool;
  }

  let aavePool: LiquidityPoolAave;
  if (config.AavePool) {
    const id = LiquidityPoolAaveUSDCVersions.at(-1);
    const minHealthFactor = BigInt(config.AavePool.MinHealthFactor) * 10000n / 100n;
    const defaultLTV = BigInt(config.AavePool.DefaultLTV) * 10000n / 100n;
    console.log("Deploying AAVE Liquidity Pool");
    aavePool = (await verifier.deployX(
      "LiquidityPoolAave",
      deployer,
      {},
      [
        config.USDC,
        config.AavePool.AaveAddressesProvider,
        deployer,
        config.MpcAddress,
        minHealthFactor,
        defaultLTV,
        config.WrappedNativeToken,
        config.SignerAddress,
      ],
      id,
    )) as LiquidityPoolAave;

    if (config.AavePool.TokenLTVs) {
      const tokens = Object.keys(config.AavePool.TokenLTVs);
      const LTVs = Object.values(config.AavePool.TokenLTVs);
      await aavePool.setBorrowTokenLTVs(
        tokens,
        percentsToBps(LTVs),
      );
    }
    console.log(`${id}: ${aavePool.target}`);

    rebalancerRoutes.Pools.push(await aavePool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await aavePool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(true);

    if (!mainPool) {
      mainPool = aavePool as LiquidityPool;
    }
  }
  
  let usdcPool: LiquidityPool;
  if (config.USDCPool) {
    const id = LiquidityPoolUSDCVersions.at(-1);
    console.log("Deploying USDC Liquidity Pool");
    usdcPool = (await verifier.deployX(
      "LiquidityPool",
      deployer,
      {},
      [config.USDC, deployer, config.MpcAddress, config.WrappedNativeToken, config.SignerAddress],
      id,
    )) as LiquidityPool;
    console.log(`${id}: ${usdcPool.target}`);

    rebalancerRoutes.Pools.push(await usdcPool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await usdcPool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(false);

    if (!mainPool) {
      mainPool = usdcPool;
    }
  }

  let usdcStablecoinPool: LiquidityPoolStablecoin;
  if (config.USDCStablecoinPool) {
    const id = LiquidityPoolUSDCStablecoinVersions.at(-1);
    console.log("Deploying USDC Stablecoin Liquidity Pool");
    usdcStablecoinPool = (await verifier.deployX(
      "LiquidityPoolStablecoin",
      deployer,
      {},
      [config.USDC, deployer, config.MpcAddress, config.WrappedNativeToken, config.SignerAddress],
      id,
    )) as LiquidityPool;
    console.log(`${id}: ${usdcStablecoinPool.target}`);

    rebalancerRoutes.Pools.push(await usdcStablecoinPool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await usdcStablecoinPool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(true);

    if ((!config.AavePool) && (!config.USDCPool)) {
      mainPool = usdcStablecoinPool;
    }
  }

  let usdcPublicPool: PublicLiquidityPool;
  if (config.USDCPublicPool) {
    assertAddress(config.USDCPublicPool.FeeSetter, "FeeSetter must be an address");
    const id = LiquidityPoolPublicUSDCVersions.at(-1);
    console.log("Deploying USDC Public Liquidity Pool");
    usdcPublicPool = (await verifier.deployX(
      "PublicLiquidityPool",
      deployer,
      {},
      [
        config.USDC,
        deployer,
        config.MpcAddress,
        config.WrappedNativeToken,
        config.SignerAddress,
        config.USDCPublicPool.Name,
        config.USDCPublicPool.Symbol,
        config.USDCPublicPool.ProtocolFeeRate * 10000 / 100,
      ],
      id
    )) as PublicLiquidityPool;
    console.log(`${id}: ${usdcPublicPool.target}`);
  }

  let erc4626AdapterUSDC: ERC4626Adapter;
  if (config.ERC4626AdapterUSDCTargetVault) {
    const id = ERC4626AdapterUSDCVersions.at(-1);
    const targetVault = await resolveXAddress(config.ERC4626AdapterUSDCTargetVault);
    console.log(`Target Vault: ${targetVault}`);

    console.log("Deploying ERC4626 Adapter USDC");
    erc4626AdapterUSDC = (await verifier.deployX(
      "ERC4626Adapter",
      deployer,
      {},
      [
        config.USDC,
        targetVault,
        deployer,
      ],
      id
    )) as ERC4626Adapter;
    console.log(`${id}: ${erc4626AdapterUSDC.target}`);

    rebalancerRoutes.Pools.push(await erc4626AdapterUSDC.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);
  }

  assert(mainPool, "Main pool is not defined");
  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  rebalancerRoutes.Pools = await resolveXAddresses(rebalancerRoutes.Pools, false);

  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxyX<Rebalancer>(
    verifier.deployX,
    rebalancerVersion,
    deployer,
    config.Admin,
    [DomainSolidity[network], config.USDC, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter],
    [
      config.Admin,
      config.RebalanceCaller,
      rebalancerRoutes.Pools,
      rebalancerRoutes.Domains.map(el => DomainSolidity[el]),
      rebalancerRoutes.Providers.map(el => ProviderSolidity[el]),
    ],
    "Rebalancer",
    verifier,
  );

  if (config.AavePoolLongTerm) {
    await aavePoolLongTerm!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await aavePoolLongTerm!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await aavePoolLongTerm!.grantRole(PAUSER_ROLE, config.Pauser);
    await aavePoolLongTerm!.grantRole(BORROW_LONG_TERM_ROLE, config.AavePoolLongTerm.BorrowLongTermAdmin);
    await aavePoolLongTerm!.grantRole(REPAYER_ROLE, config.AavePoolLongTerm.RepayCaller);
  }

  if (config.AavePool) {
    await aavePool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await aavePool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await aavePool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (config.USDCPool) {
    await usdcPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await usdcPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await usdcPool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (config.USDCStablecoinPool) {
    await usdcStablecoinPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await usdcStablecoinPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await usdcStablecoinPool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (config.USDCPublicPool) {
    await usdcPublicPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await usdcPublicPool!.grantRole(PAUSER_ROLE, config.Pauser);
    await usdcPublicPool!.grantRole(FEE_SETTER_ROLE, config.USDCPublicPool.FeeSetter);
  }

  if (config.ERC4626AdapterUSDCTargetVault) {
    await erc4626AdapterUSDC!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await erc4626AdapterUSDC!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await erc4626AdapterUSDC!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  const repayerVersion = config.IsTest ? "TestRepayer" : "Repayer";

  repayerRoutes.Pools = await resolveXAddresses(repayerRoutes.Pools || [], false);

  const repayerId = "Repayer";
  let repayer: Repayer;
  let repayerAdmin: ProxyAdmin;
  try {
    repayer = (await getContractAt(repayerVersion, await resolveProxyXAddress(repayerId), deployer)) as Repayer;
    repayerAdmin = await getProxyXAdmin(repayerId, deployer);
    console.log("Repayer was already deployed");
    console.log("Make sure to update the Repayer routes with the update-routes-repayer task");
    repayerRoutes.Pools = []; // We don't automatically update the routes so need to skip the logging in the end.
  } catch {
    const result = await deployProxyX<Repayer>(
      verifier.deployX,
      repayerVersion,
      deployer,
      config.Admin,
      [
        DomainSolidity[network],
        config.USDC,
        config.CCTP.TokenMessenger,
        config.CCTP.MessageTransmitter,
        config.AcrossV3SpokePool,
        config.EverclearFeeAdapter,
        config.WrappedNativeToken,
        config.StargateTreasurer,
        config.OptimismStandardBridge,
      ],
      [
        config.Admin,
        config.RepayerCaller,
        repayerRoutes.Pools,
        repayerRoutes.Domains.map(el => DomainSolidity[el]),
        repayerRoutes.Providers.map(el => ProviderSolidity[el]),
        repayerRoutes.SupportsAllTokens,
      ],
      repayerId,
    );
    repayer = result.target;
    repayerAdmin = result.targetAdmin;
  }


  if (config.Hub) {
    const tiers = config.Hub!.Tiers;
    const assetsLimit = BigInt(config.Hub!.AssetsLimit) * 10n ** 6n;

    const liquidityHubAddress = await verifier.predictDeployProxyXAddress("LiquidityHub", deployer);
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
      config.Admin,
      [lpToken, mainPool],
      [
        config.USDC,
        config.Admin,
        config.Hub.AssetsAdjuster,
        config.Hub.DepositProfit,
        config.Hub.AssetsLimitSetter,
        assetsLimit
      ],
      "LiquidityHub",
      verifier,
    );

    assert(liquidityHubAddress == liquidityHub.target, "LiquidityHub address mismatch");
    const liquidityMining = (
      await verifier.deployX("SprinterLiquidityMining", deployer, {}, [config.Admin, liquidityHub, tiers])
    ) as SprinterLiquidityMining;

    await mainPool.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub);

    console.log(`SprinterUSDCLPShare: ${lpToken.target}`);
    console.log(`LiquidityHub: ${liquidityHub.target}`);
    console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
    console.log(`LiquidityHub Adjuster: ${config.Hub!.AssetsAdjuster}`);
    console.log(`LiquidityHub DepositProfit: ${config.Hub!.DepositProfit}`);
    console.log(`LiquidityHub AssetsLimitSetter: ${config.Hub!.AssetsLimitSetter}`);
    console.log(`LiquidityHub Assets Limit: ${config.Hub!.AssetsLimit}`);
    console.log(`SprinterLiquidityMining: ${liquidityMining.target}`);
    console.log("Tiers:");
    console.table(tiers.map(el => {
      const multiplier = `${el.multiplier / 1000000000n}.${el.multiplier % 1000000000n}x`;
      return {seconds: Number(el.period), multiplier};
    }));
  }

  if (!sameAddress(deployer.address, config.Admin)) {
    if (config.AavePoolLongTerm) {
      await aavePoolLongTerm!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await aavePoolLongTerm!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (config.AavePool) {
      await aavePool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await aavePool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (config.USDCPool) {
      await usdcPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await usdcPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (config.USDCStablecoinPool) {
      await usdcStablecoinPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await usdcStablecoinPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (config.USDCPublicPool) {
      await usdcPublicPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await usdcPublicPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (config.ERC4626AdapterUSDCTargetVault) {
      await erc4626AdapterUSDC!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await erc4626AdapterUSDC!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }
  }

  let multicall: string;
  try {
    multicall = await resolveXAddress("CensoredTransferFromMulticall");
    console.log("Multicall was already deployed");
  } catch {
    multicall = await (await verifier.deployX(
      "CensoredTransferFromMulticall",
      deployer,
    )).getAddress();
  }

  console.log(`Multicall: ${multicall}`);
  console.log(`Admin: ${config.Admin}`);
  console.log(`LiquidityPool Withdraw Profit: ${config.WithdrawProfit}`);
  console.log(`LiquidityPool Pauser: ${config.Pauser}`);
  console.log(`MPC Address: ${config.MpcAddress}`);
  console.log(`USDC: ${config.USDC}`);
  console.log(`Signer Address: ${config.SignerAddress}`);
  console.log(`Rebalancer: ${rebalancer.target}`);
  console.log(`RebalancerProxyAdmin: ${rebalancerAdmin.target}`);
  if (rebalancerRoutes.Pools.length > 0) {
    console.log("RebalancerRoutes:");
    const transposedRoutes = [];
    for (let i = 0; i < rebalancerRoutes.Pools.length; i++) {
      transposedRoutes.push({
        Pool: rebalancerRoutes.Pools[i],
        Domain: rebalancerRoutes.Domains[i],
        Provider: rebalancerRoutes.Providers[i],
      });
    }
    console.table(transposedRoutes);
  }
  console.log(`Repayer: ${repayer.target}`);
  console.log(`RepayerProxyAdmin: ${repayerAdmin.target}`);
  if (repayerRoutes.Pools.length > 0) {
    console.log("RepayerRoutes:");
    const transposedRoutes = [];
    for (let i = 0; i < repayerRoutes.Pools.length; i++) {
      transposedRoutes.push({
        Pool: repayerRoutes.Pools[i],
        Domain: repayerRoutes.Domains[i],
        Provider: repayerRoutes.Providers[i],
        SupportsAllTokens: repayerRoutes.SupportsAllTokens[i],
      });
    }
    console.table(transposedRoutes);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
