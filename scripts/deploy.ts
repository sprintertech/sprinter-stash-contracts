import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {MaxUint256, NonceManager} from "ethers";
import {toBytes32, resolveProxyXAddress, resolveXAddress, getContractAt, resolveXAddresses} from "../test/helpers";
import {
  getVerifier, deployProxyX, getHardhatNetworkConfig, getNetworkConfig, percentsToBps,
  getProxyXAdmin, getInputOutputTokens, flattenInputOutputTokens,
  logDeployers, getMainAsset, idWithMainAsset, resolveOnlySupportedToken,
  mineIfNeeded,
} from "./helpers";
import {
  assert, isSet, ProviderSolidity, DomainSolidity, DEFAULT_ADMIN_ROLE, ZERO_ADDRESS,
  sameAddress, assertAddress,
} from "./common";
import {
  LiquidityHub, SprinterLiquidityMining,
  Rebalancer, Repayer, LiquidityPool, LiquidityPoolAave, LiquidityPoolStablecoin, LiquidityPoolAaveLongTerm,
  ProxyAdmin, PublicLiquidityPool, ERC4626Adapter, AccessControl,
  ManagedToken,
} from "../typechain-types";
import {
  Network, Provider, NetworkConfig,
  LiquidityPoolAaveId,
  LiquidityPoolAaveLongTermId,
  LiquidityPoolId,
  LiquidityPoolStablecoinId,
  LiquidityPoolPublicId,
  ERC4626AdapterId,
} from "../network.config";

export async function main() {
  await mineIfNeeded();
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

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

  await logDeployers();

  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);

  assert(
    mainAssetConfig.AavePool || mainAssetConfig.AavePoolLongTerm || mainAssetConfig.BasicPool
      || mainAssetConfig.StablecoinPool,
    "At least one pool should be present."
  );
  let usdcAddress = ZERO_ADDRESS;
  if (config.Tokens.USDC) {
    usdcAddress = config.Tokens.USDC.Address;
    assertAddress(usdcAddress, "USDC must be an address");
  }
  assertAddress(mainAssetInfo.Address, `${mainAsset} must be an address`);
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.WithdrawProfit, "WithdrawProfit must be an address");
  assertAddress(config.Pauser, "Pauser must be an address");
  assertAddress(config.RebalanceCaller, "RebalanceCaller must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");
  assertAddress(config.SetInputOutputTokens, "SetInputOutputTokens must be an address");
  assertAddress(config.MpcAddress, "MpcAddress must be an address");
  assertAddress(config.SignerAddress, "SignerAddress must be an address");
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");

  if (!config.CCTPV2) {
    config.CCTPV2 = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
    };
  }

  if (mainAssetConfig.Hub) {
    if (mainAssetConfig.Hub.Tiers) {
      assert(mainAssetConfig.Hub.Tiers.length > 0, "Empty liquidity mining tiers configuration.");
    }
    assert(
      mainAssetConfig.Hub.AssetsLimit <= MaxUint256 / 10n ** BigInt(18 - mainAssetInfo.Decimals),
      "Assets limit is too high"
    );
  }

  const rebalancerRoutes: {Pools: string[], Domains: Network[], Providers: Provider[]} = {
    Pools: [],
    Domains: [],
    Providers: [],
  };
  if (mainAssetConfig.RebalancerRoutes) {
    for (const [pool, domainProviders] of Object.entries(mainAssetConfig.RebalancerRoutes)) {
      for (const [domain, providers] of Object.entries(domainProviders)) {
        for (const provider of providers) {
          rebalancerRoutes.Pools.push(pool);
          rebalancerRoutes.Domains.push(domain as Network);
          rebalancerRoutes.Providers.push(provider);
        }
      }
    }
  }

  const repayerRoutes: {Pools: string[], Domains: Network[], Providers: Provider[], OnlySupportedTokens: string[]} = {
    Pools: [],
    Domains: [],
    Providers: [],
    OnlySupportedTokens: [],
  };
  if (config.RepayerRoutes) {
    for (const [pool, domainProviders] of Object.entries(config.RepayerRoutes)) {
      for (const [domain, providers] of Object.entries(domainProviders.Domains)) {
        for (const provider of providers) {
          repayerRoutes.Pools.push(pool);
          repayerRoutes.Domains.push(domain as Network);
          repayerRoutes.Providers.push(provider);
          repayerRoutes.OnlySupportedTokens.push(
            resolveOnlySupportedToken(config.Tokens, domainProviders.OnlySupportedToken)
          );
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
  if (!config.OptimismStandardBridge) {
    config.OptimismStandardBridge = ZERO_ADDRESS;
  }
  if (!config.BaseStandardBridge) {
    config.BaseStandardBridge = ZERO_ADDRESS;
  }
  if (!config.ArbitrumGatewayRouter) {
    config.ArbitrumGatewayRouter = ZERO_ADDRESS;
  }
  if (!config.Omnibridge) config.Omnibridge = ZERO_ADDRESS;
  if (!config.GnosisUSDCxDAI) config.GnosisUSDCxDAI = ZERO_ADDRESS;
  if (!config.GnosisUSDCTransmuter) config.GnosisUSDCTransmuter = ZERO_ADDRESS;
  if (!config.GnosisAMB) config.GnosisAMB = ZERO_ADDRESS;
  if (!config.USDT0OFT) config.USDT0OFT = ZERO_ADDRESS;
  if (!config.USDT0FeeNativeToken) config.USDT0FeeNativeToken = ZERO_ADDRESS;

  let mainPool: AccessControl | undefined = undefined;
  let aavePoolLongTerm: LiquidityPoolAaveLongTerm;
  let aavePoolLongTermAdmin: ProxyAdmin;
  if (mainAssetConfig.AavePoolLongTerm) {
    const id = idWithMainAsset(mainAsset, LiquidityPoolAaveLongTermId);
    const minHealthFactor = BigInt(mainAssetConfig.AavePoolLongTerm.MinHealthFactor) * 10000n / 100n;
    const defaultLTV = BigInt(mainAssetConfig.AavePoolLongTerm.DefaultLTV) * 10000n / 100n;
    console.log("Deploying AAVE Liquidity Pool Long Term");
    ({target: aavePoolLongTerm, targetAdmin: aavePoolLongTermAdmin} =
      await deployProxyX<LiquidityPoolAaveLongTerm>(
        verifier.deployX,
        "LiquidityPoolAaveLongTerm",
        deployerWithNonce,
        config.Admin,
        [
          mainAssetInfo.Address, mainAssetConfig.AavePoolLongTerm.AaveAddressesProvider,
          config.WrappedNativeToken,
        ],
        [deployer, config.MpcAddress, config.SignerAddress, minHealthFactor, defaultLTV],
        id,
        verifier,
      ));

    if (mainAssetConfig.AavePoolLongTerm.TokenLTVs) {
      const tokens = Object.keys(mainAssetConfig.AavePoolLongTerm.TokenLTVs);
      const LTVs = Object.values(mainAssetConfig.AavePoolLongTerm.TokenLTVs);
      await aavePoolLongTerm.setBorrowTokenLTVs(
        tokens,
        percentsToBps(LTVs),
      );
    }
    console.log(`${id}Proxy: ${aavePoolLongTerm.target}`);
    console.log(`${id}ProxyAdmin: ${aavePoolLongTermAdmin.target}`);

    rebalancerRoutes.Pools.push(await aavePoolLongTerm.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await aavePoolLongTerm.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.OnlySupportedTokens.push(ZERO_ADDRESS);

    mainPool = aavePoolLongTerm;
  }

  let aavePool: LiquidityPoolAave;
  let aavePoolAdmin: ProxyAdmin;
  if (mainAssetConfig.AavePool) {
    const id = idWithMainAsset(mainAsset, LiquidityPoolAaveId);
    const minHealthFactor = BigInt(mainAssetConfig.AavePool.MinHealthFactor) * 10000n / 100n;
    const defaultLTV = BigInt(mainAssetConfig.AavePool.DefaultLTV) * 10000n / 100n;
    console.log("Deploying AAVE Liquidity Pool");
    ({target: aavePool, targetAdmin: aavePoolAdmin} = await deployProxyX<LiquidityPoolAave>(
      verifier.deployX,
      "LiquidityPoolAave",
      deployerWithNonce,
      config.Admin,
      [mainAssetInfo.Address, mainAssetConfig.AavePool.AaveAddressesProvider, config.WrappedNativeToken],
      [deployer, config.MpcAddress, config.SignerAddress, minHealthFactor, defaultLTV],
      id,
      verifier,
    ));

    if (mainAssetConfig.AavePool.TokenLTVs) {
      const tokens = Object.keys(mainAssetConfig.AavePool.TokenLTVs);
      const LTVs = Object.values(mainAssetConfig.AavePool.TokenLTVs);
      await aavePool.setBorrowTokenLTVs(
        tokens,
        percentsToBps(LTVs),
      );
    }
    console.log(`${id}Proxy: ${aavePool.target}`);
    console.log(`${id}ProxyAdmin: ${aavePoolAdmin.target}`);

    rebalancerRoutes.Pools.push(await aavePool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await aavePool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.OnlySupportedTokens.push(ZERO_ADDRESS);

    if (!mainPool) {
      mainPool = aavePool;
    }
  }

  let basicPool: LiquidityPool;
  let basicPoolAdmin: ProxyAdmin;
  if (mainAssetConfig.BasicPool) {
    const id = idWithMainAsset(mainAsset, LiquidityPoolId);
    console.log(`Deploying ${id}`);
    ({target: basicPool, targetAdmin: basicPoolAdmin} = await deployProxyX<LiquidityPool>(
      verifier.deployX,
      "LiquidityPool",
      deployerWithNonce,
      config.Admin,
      [mainAssetInfo.Address, config.WrappedNativeToken],
      [deployer, config.MpcAddress, config.SignerAddress],
      id,
      verifier,
    ));
    console.log(`${id}Proxy: ${basicPool.target}`);
    console.log(`${id}ProxyAdmin: ${basicPoolAdmin.target}`);

    rebalancerRoutes.Pools.push(await basicPool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await basicPool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.OnlySupportedTokens.push(mainAssetInfo.Address);

    if (!mainPool) {
      mainPool = basicPool;
    }
  }

  let stablecoinPool: LiquidityPoolStablecoin;
  let stablecoinPoolAdmin: ProxyAdmin;
  if (mainAssetConfig.StablecoinPool) {
    const id = idWithMainAsset(mainAsset, LiquidityPoolStablecoinId);
    console.log(`Deploying ${id}`);
    ({target: stablecoinPool, targetAdmin: stablecoinPoolAdmin} =
      await deployProxyX<LiquidityPoolStablecoin>(
        verifier.deployX,
        "LiquidityPoolStablecoin",
        deployerWithNonce,
        config.Admin,
        [mainAssetInfo.Address, config.WrappedNativeToken],
        [deployer, config.MpcAddress, config.SignerAddress],
        id,
        verifier,
      ));
    console.log(`${id}Proxy: ${stablecoinPool.target}`);
    console.log(`${id}ProxyAdmin: ${stablecoinPoolAdmin.target}`);

    rebalancerRoutes.Pools.push(await stablecoinPool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await stablecoinPool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.OnlySupportedTokens.push(ZERO_ADDRESS);

    if ((!mainAssetConfig.AavePool) && (!mainAssetConfig.BasicPool)) {
      mainPool = stablecoinPool;
    }
  }

  let publicPool: PublicLiquidityPool;
  let publicPoolAdmin: ProxyAdmin;
  if (mainAssetConfig.PublicPool) {
    assertAddress(mainAssetConfig.PublicPool.FeeSetter, "FeeSetter must be an address");
    const id = idWithMainAsset(mainAsset, LiquidityPoolPublicId);
    console.log(`Deploying ${id}`);
    ({target: publicPool, targetAdmin: publicPoolAdmin} = await deployProxyX<PublicLiquidityPool>(
      verifier.deployX,
      "PublicLiquidityPool",
      deployerWithNonce,
      config.Admin,
      [mainAssetInfo.Address, config.WrappedNativeToken],
      [deployer, config.MpcAddress, config.SignerAddress,
        mainAssetConfig.PublicPool.Name, mainAssetConfig.PublicPool.Symbol,
        mainAssetConfig.PublicPool.ProtocolFeeRate * 10000 / 100],
      id,
      verifier,
    ));
    console.log(`${id}Proxy: ${publicPool.target}`);
    console.log(`${id}ProxyAdmin: ${publicPoolAdmin.target}`);
  }

  let erc4626Adapter: ERC4626Adapter;
  let erc4626AdapterAdmin: ProxyAdmin;
  if (mainAssetConfig.ERC4626AdapterTargetVault) {
    const id = idWithMainAsset(mainAsset, ERC4626AdapterId);
    const targetVault = await resolveXAddress(mainAssetConfig.ERC4626AdapterTargetVault);
    console.log(`Target Vault: ${targetVault}`);

    console.log(`Deploying ${id}`);
    ({target: erc4626Adapter, targetAdmin: erc4626AdapterAdmin} =
      await deployProxyX<ERC4626Adapter>(
        verifier.deployX,
        "ERC4626Adapter",
        deployerWithNonce,
        config.Admin,
        [mainAssetInfo.Address, targetVault],
        [deployer],
        id,
        verifier,
      ));
    console.log(`${id}Proxy: ${erc4626Adapter.target}`);
    console.log(`${id}ProxyAdmin: ${erc4626AdapterAdmin.target}`);

    rebalancerRoutes.Pools.push(await erc4626Adapter.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);
  }

  assert(mainPool, "Main pool is not defined");
  const rebalancerVersion = "Rebalancer";
  const rebalancerId = idWithMainAsset(mainAsset, "Rebalancer");

  rebalancerRoutes.Pools = await resolveXAddresses(rebalancerRoutes.Pools, false);

  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxyX<Rebalancer>(
    verifier.deployX,
    rebalancerVersion,
    deployerWithNonce,
    config.Admin,
    [
      DomainSolidity[network], mainAssetInfo.Address, usdcAddress,
      config.Omnibridge, config.GnosisUSDCxDAI, config.GnosisUSDCTransmuter, config.GnosisAMB,
      config.USDT0OFT, config.USDT0FeeNativeToken, config.CCTPV2.TokenMessenger, config.CCTPV2.MessageTransmitter,
    ],
    [
      config.Admin,
      config.RebalanceCaller,
      rebalancerRoutes.Pools,
      rebalancerRoutes.Domains.map(el => DomainSolidity[el]),
      rebalancerRoutes.Providers.map(el => ProviderSolidity[el]),
    ],
    rebalancerId,
    verifier,
  );

  if (mainAssetConfig.AavePoolLongTerm) {
    await aavePoolLongTerm!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await aavePoolLongTerm!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await aavePoolLongTerm!.grantRole(PAUSER_ROLE, config.Pauser);
    await aavePoolLongTerm!.grantRole(BORROW_LONG_TERM_ROLE, mainAssetConfig.AavePoolLongTerm.BorrowLongTermAdmin);
    await aavePoolLongTerm!.grantRole(REPAYER_ROLE, mainAssetConfig.AavePoolLongTerm.RepayCaller);
  }

  if (mainAssetConfig.AavePool) {
    await aavePool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await aavePool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await aavePool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (mainAssetConfig.BasicPool) {
    await basicPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await basicPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await basicPool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (mainAssetConfig.StablecoinPool) {
    await stablecoinPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await stablecoinPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await stablecoinPool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (mainAssetConfig.PublicPool) {
    await publicPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await publicPool!.grantRole(PAUSER_ROLE, config.Pauser);
    await publicPool!.grantRole(FEE_SETTER_ROLE, mainAssetConfig.PublicPool.FeeSetter);
  }

  if (mainAssetConfig.ERC4626AdapterTargetVault) {
    await erc4626Adapter!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await erc4626Adapter!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await erc4626Adapter!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  const repayerVersion = "Repayer";

  repayerRoutes.Pools = await resolveXAddresses(repayerRoutes.Pools || [], false);
  const inputOutputTokens = getInputOutputTokens(network, config);

  const repayerId = "Repayer";
  let repayer: Repayer;
  let repayerAdmin: ProxyAdmin;
  try {
    repayer = (await getContractAt(
      repayerVersion, await resolveProxyXAddress(repayerId), deployerWithNonce
    )) as Repayer;
    repayerAdmin = await getProxyXAdmin(repayerId, deployerWithNonce);
    console.log("Repayer was already deployed");
    console.log("Make sure to update the Repayer routes with the update-routes-repayer task");
    repayerRoutes.Pools = []; // We don't automatically update the routes so need to skip the logging in the end.
  } catch {
    const result = await deployProxyX<Repayer>(
      verifier.deployX,
      repayerVersion,
      deployerWithNonce,
      config.Admin,
      [
        DomainSolidity[network],
        config.Tokens.USDC.Address,
        config.AcrossV3SpokePool,
        config.WrappedNativeToken,
        config.StargateTreasurer,
        config.OptimismStandardBridge,
        config.BaseStandardBridge,
        config.ArbitrumGatewayRouter,
        config.Omnibridge,
        config.GnosisUSDCxDAI,
        config.GnosisUSDCTransmuter,
        config.GnosisAMB,
        config.USDT0OFT,
        config.USDT0FeeNativeToken,
        config.CCTPV2.TokenMessenger,
        config.CCTPV2.MessageTransmitter,
      ],
      [
        config.Admin,
        config.RepayerCaller,
        config.SetInputOutputTokens,
        repayerRoutes.Pools,
        repayerRoutes.Domains.map(el => DomainSolidity[el]),
        repayerRoutes.Providers.map(el => ProviderSolidity[el]),
        repayerRoutes.OnlySupportedTokens,
        inputOutputTokens,
      ],
      repayerId,
    );
    repayer = result.target;
    repayerAdmin = result.targetAdmin;
  }


  if (mainAssetConfig.Hub) {
    const assetsLimit = BigInt(mainAssetConfig.Hub.AssetsLimit) * 10n ** BigInt(mainAssetInfo.Decimals);

    const liquidityHubId = idWithMainAsset(mainAsset, "LiquidityHub");
    const liquidityHubAddress = await verifier.predictDeployProxyXAddress(liquidityHubId, deployer);
    const lpToken = (await verifier.deployX(
      `Sprinter${mainAsset}LPShare`,
      deployerWithNonce,
      {},
      [liquidityHubAddress],
      `Sprinter${mainAsset}LPShare`,
      `contracts/Sprinter${mainAsset}LPShare.sol:Sprinter${mainAsset}LPShare`
    )) as ManagedToken;

    const {target: liquidityHub, targetAdmin: liquidityHubAdmin} = await deployProxyX<LiquidityHub>(
      verifier.deployX,
      "LiquidityHub",
      deployerWithNonce,
      config.Admin,
      [lpToken, mainPool],
      [
        mainAssetInfo.Address,
        config.Admin,
        mainAssetConfig.Hub.AssetsAdjuster,
        mainAssetConfig.Hub.DepositProfit,
        mainAssetConfig.Hub.AssetsLimitSetter,
        assetsLimit
      ],
      liquidityHubId,
      verifier,
    );

    assert(liquidityHubAddress == liquidityHub.target, "LiquidityHub address mismatch");

    await mainPool.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub);

    console.log(`Sprinter${mainAsset}LPShare: ${lpToken.target}`);
    console.log(`${liquidityHubId}: ${liquidityHub.target}`);
    console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
    console.log(`LiquidityHub Adjuster: ${mainAssetConfig.Hub.AssetsAdjuster}`);
    console.log(`LiquidityHub DepositProfit: ${mainAssetConfig.Hub.DepositProfit}`);
    console.log(`LiquidityHub AssetsLimitSetter: ${mainAssetConfig.Hub.AssetsLimitSetter}`);
    console.log(`LiquidityHub Assets Limit: ${mainAssetConfig.Hub.AssetsLimit}`);

    if (mainAssetConfig.Hub.Tiers) {
      const tiers = mainAssetConfig.Hub.Tiers;
      const liquidityMining = (
        await verifier.deployX(
          "SprinterLiquidityMining",
          deployerWithNonce,
          {},
          [config.Admin, liquidityHub, tiers],
          idWithMainAsset(mainAsset, "SprinterLiquidityMining")
        )
      ) as SprinterLiquidityMining;

      console.log(`SprinterLiquidityMining: ${liquidityMining.target}`);
      console.log("Tiers:");
      console.table(tiers.map(el => {
        const multiplier = `${el.multiplier / 1000000000n}.${el.multiplier % 1000000000n}x`;
        return {seconds: Number(el.period), multiplier};
      }));
    }
  }

  if (!sameAddress(deployer.address, config.Admin)) {
    if (mainAssetConfig.AavePoolLongTerm) {
      await aavePoolLongTerm!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await aavePoolLongTerm!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (mainAssetConfig.AavePool) {
      await aavePool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await aavePool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (mainAssetConfig.BasicPool) {
      await basicPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await basicPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (mainAssetConfig.StablecoinPool) {
      await stablecoinPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await stablecoinPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (mainAssetConfig.PublicPool) {
      await publicPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await publicPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (mainAssetConfig.ERC4626AdapterTargetVault) {
      await erc4626Adapter!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await erc4626Adapter!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }
  }

  let multicall: string;
  try {
    multicall = await resolveXAddress("CensoredTransferFromMulticall");
    console.log("Multicall was already deployed");
  } catch {
    multicall = await (await verifier.deployX(
      "CensoredTransferFromMulticall",
      deployerWithNonce,
    )).getAddress();
  }

  console.log(`Multicall: ${multicall}`);
  console.log(`Admin: ${config.Admin}`);
  console.log(`LiquidityPool Withdraw Profit: ${config.WithdrawProfit}`);
  console.log(`LiquidityPool Pauser: ${config.Pauser}`);
  console.log(`MPC Address: ${config.MpcAddress}`);
  console.log(`${mainAsset}: ${config.Tokens[mainAsset]!.Address}`);
  console.log(`Signer Address: ${config.SignerAddress}`);
  console.log(`${rebalancerId}: ${rebalancer.target}`);
  console.log(`${rebalancerId}ProxyAdmin: ${rebalancerAdmin.target}`);
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
        OnlySupportedToken: repayerRoutes.OnlySupportedTokens[i],
      });
    }
    console.table(transposedRoutes);
  }
  if (inputOutputTokens.length > 0) {
    console.log("InputOutputTokens:");
    console.table(flattenInputOutputTokens(inputOutputTokens));
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
