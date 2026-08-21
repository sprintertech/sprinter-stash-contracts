import dotenv from "dotenv";
dotenv.config();
import {toBytes32, resolveXAddresses} from "../test/helpers";
import {
  getHardhatNetworkConfig, getNetworkConfig,
  getInputOutputTokens, flattenInputOutputTokens,
  logDeployers, getMainAsset, idWithMainAsset, resolveOnlySupportedToken,
  getDestinationRebalancerAddresses,
  getDestinationRepayerAddresses,
} from "../scripts/helpers";
import {
  assert, isSet, ProviderSolidity, DomainSolidity, DEFAULT_ADMIN_ROLE, ZERO_ADDRESS,
  sameAddress, assertAddress, SolidityDomain,
} from "../scripts/common";
import {
  Rebalancer, Repayer, LiquidityPool, AccessControlUpgradeable, ProxyAdmin,
} from "../typechain-types";
import {
  Network, Provider, NetworkConfig,
  LiquidityPoolId,
} from "../network.config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {deployProxy} from "../scripts/helpers.tron";

const main: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await hre.getUnnamedAccounts();
  const {deployments} = hre;
  const validateDeployers = hre.network.name !== "localtron";
  const deployEnv = process.env.DEPLOY_TYPE === "STAGE" ? "Stage_" : "Prod_";

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying contracts set");
  ({network, config} = await getNetworkConfig(validateDeployers));
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(validateDeployers);

  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);

  assert(mainAssetConfig.BasicPool, "BasicPool should be present.");
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
  if (!config.PolygonPosRootChainManager) config.PolygonPosRootChainManager = ZERO_ADDRESS;

  let mainPool: AccessControlUpgradeable | undefined = undefined;

  const basicPoolId = deployEnv + idWithMainAsset(mainAsset, LiquidityPoolId);
  let basicPool: LiquidityPool;
  let basicPoolAdmin: ProxyAdmin;
  if (mainAssetConfig.BasicPool) {
    console.log(`Deploying ${basicPoolId}`);
    ({target: basicPool, targetAdmin: basicPoolAdmin} = await deployProxy<LiquidityPool>(
      hre,
      "LiquidityPool",
      deployer,
      config.Admin,
      [mainAssetInfo.Address, config.WrappedNativeToken],
      [deployer, config.MpcAddress, config.SignerAddress],
      basicPoolId,
    ));

    console.log(`${basicPoolId}Proxy: ${basicPool.target}`);
    console.log(`${basicPoolId}ProxyAdmin: ${basicPoolAdmin.target}`);

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

  assert(mainPool, "Main pool is not defined");

  rebalancerRoutes.Pools = await resolveXAddresses(rebalancerRoutes.Pools, false, false);

  const rebalancerId = deployEnv + idWithMainAsset(mainAsset, "Rebalancer");
  const destinationRebalancerAddresses = await getDestinationRebalancerAddresses(network, mainAsset);
  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxy<Rebalancer>(
    hre,
    "Rebalancer",
    deployer,
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
      destinationRebalancerAddresses,
    ],
    rebalancerId,
  );

  console.log(`RebalancerProxy: ${rebalancer.target}`);
  console.log(`RebalancerProxyAdmin: ${rebalancerAdmin.target}`);

  if (mainAssetConfig.BasicPool && await basicPool!.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
    await deployments.execute(
      basicPoolId,
      {
        from: deployer,
        log: true,
      },
      "grantRole",
      LIQUIDITY_ADMIN_ROLE, rebalancer.target,
    );
    await deployments.execute(
      basicPoolId,
      {
        from: deployer,
        log: true,
      },
      "grantRole",
      WITHDRAW_PROFIT_ROLE, config.WithdrawProfit,
    );
    await deployments.execute(
      basicPoolId,
      {
        from: deployer,
        log: true,
      },
      "grantRole",
      PAUSER_ROLE, config.Pauser,
    );
  }

  repayerRoutes.Pools = await resolveXAddresses(repayerRoutes.Pools || [], false, false);
  const inputOutputTokens = getInputOutputTokens(network, config);

  const repayerId = deployEnv + "Repayer";
  const destinationRepayerAddresses = await getDestinationRepayerAddresses(network);
  const {target: repayer, targetAdmin: repayerAdmin} = await deployProxy<Repayer>(
    hre,
    "Repayer",
    deployer,
    config.Admin,
    [
      DomainSolidity[network],
      usdcAddress,
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
      config.PolygonPosRootChainManager,
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
      destinationRepayerAddresses,
    ],
    repayerId,
  );

  console.log(`RepayerProxy: ${repayer.target}`);
  console.log(`RepayerProxyAdmin: ${repayerAdmin.target}`);

  if (!sameAddress(deployer, config.Admin)) {
    if (mainAssetConfig.BasicPool && await basicPool!.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
      await deployments.execute(
        basicPoolId,
        {
          from: deployer,
          log: true,
        },
        "grantRole",
        DEFAULT_ADMIN_ROLE, config.Admin,
      );
      await deployments.execute(
        basicPoolId,
        {
          from: deployer,
          log: true,
        },
        "renounceRole",
        DEFAULT_ADMIN_ROLE, deployer,
      );
    }
  }

  const multicall = (await deployments.deploy("CensoredTransferFromMulticall", {
    from: deployer,
  })).address;

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
  if (destinationRebalancerAddresses.length > 0) {
    console.log("Destination Rebalancer Addresses:");
    console.table(destinationRebalancerAddresses.map(el => ({
      Network: SolidityDomain[Number(el.domain)],
      ThisAddress: el.thisAddress,
    })));
  } else {
    console.log("No Destination Rebalancer Addresses");
  }
  if (destinationRepayerAddresses.length > 0) {
    console.log("Destination Repayer Addresses:");
    console.table(destinationRepayerAddresses.map(el => ({
      Network: SolidityDomain[Number(el.domain)],
      ThisAddress: el.thisAddress,
    })));
  } else {
    console.log("No Destination Repayer Addresses");
  }

  const REBALANCER_ROLE = toBytes32("REBALANCER_ROLE");
  const REPAYER_ROLE = toBytes32("REPAYER_ROLE");
  const SET_TOKENS_ROLE = toBytes32("SET_TOKENS_ROLE");

  assert(await basicPoolAdmin!.owner() === config.Admin, "Basic pool admin owner mismatch");
  assert(await basicPool!.mpcAddress() === config.MpcAddress, "Basic pool MPC address mismatch");
  assert(await basicPool!.signerAddress() === config.SignerAddress, "Basic pool admin signer address mismatch");
  assert(await basicPool!.hasRole(DEFAULT_ADMIN_ROLE, config.Admin), "Basic pool admin default admin role mismatch");
  assert(
    sameAddress(deployer, config.Admin) || await basicPool!.hasRole(DEFAULT_ADMIN_ROLE, deployer) === false,
    "Basic pool admin default admin role mismatch",
  );
  assert(
    await basicPool!.hasRole(LIQUIDITY_ADMIN_ROLE, rebalancer.target),
    "Basic pool admin liquidity admin role mismatch",
  );
  assert(
    await basicPool!.hasRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit),
    "Basic pool admin withdraw profit role mismatch",
  );
  assert(await basicPool!.hasRole(PAUSER_ROLE, config.Pauser), "Basic pool admin pauser role mismatch");
  assert(await rebalancerAdmin!.owner() === config.Admin, "Rebalancer admin owner mismatch");
  assert(await rebalancer!.DOMAIN() === DomainSolidity[network], "Rebalancer domain mismatch");
  assert(await rebalancer!.ASSETS() === mainAssetInfo.Address, "Rebalancer assets mismatch");
  assert(await rebalancer!.hasRole(DEFAULT_ADMIN_ROLE, config.Admin), "Rebalancer default admin role mismatch");
  assert(
    sameAddress(deployer, config.Admin) || await rebalancer!.hasRole(DEFAULT_ADMIN_ROLE, deployer) === false,
    "Rebalancer default admin role mismatch"
  );
  assert(await rebalancer!.hasRole(REBALANCER_ROLE, config.RebalanceCaller), "Rebalancer rebalancer role mismatch");
  assert(await rebalancer!.USDT0_OFT() === config.USDT0OFT, "Rebalancer USDT0 OFT mismatch");
  assert(await repayerAdmin!.owner() === config.Admin, "Repayer admin owner mismatch");
  assert(await repayer!.DOMAIN() === DomainSolidity[network], "Repayer domain mismatch");
  assert(await repayer!.USDT0_OFT() === config.USDT0OFT, "Rebalancer USDT0 OFT mismatch");
  assert(await repayer!.hasRole(DEFAULT_ADMIN_ROLE, config.Admin), "Repayer default admin role mismatch");
  assert(
    sameAddress(deployer, config.Admin) || await repayer!.hasRole(DEFAULT_ADMIN_ROLE, deployer) === false,
    "Repayer default admin role mismatch"
  );
  assert(await repayer!.hasRole(REPAYER_ROLE, config.RepayerCaller), "Repayer repayer role mismatch");
  assert(await repayer!.hasRole(SET_TOKENS_ROLE, config.SetInputOutputTokens), "Repayer set tokens role mismatch");
};

main.tags = ["Deploy"];
export default main;
