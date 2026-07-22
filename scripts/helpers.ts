import hre from "hardhat";
import {Signer, BaseContract, AddressLike, resolveAddress, ContractTransaction, isAddress} from "ethers";
import {
  deploy, deployX, getContractAt, getCreateAddress, getDeployXAddressBase,
  resolveXAddress, resolveProxyXAddress, assertCode,
} from "../test/helpers";
import {
  TransparentUpgradeableProxy, ProxyAdmin, Repayer,
} from "../typechain-types";
import {
  sleep, assert, assertAddress, DomainSolidity, addressToBytes32, bytes32ToToken, SolidityDomain, ZERO_ADDRESS,
} from "./common";
import {
  prodNetworkConfig, stageNetworkConfig, Network, NetworkConfig, StandaloneRepayerEnv, StandaloneRepayerConfig,
  repayerConfig, DEFAULT_PROXY_TYPE,
  Provider,
  LiquidityPoolAaveUSDCVersions,
  LiquidityPoolUSDCVersions,
  LiquidityPoolUSDCStablecoinVersions,
  LiquidityPoolAaveUSDCLongTermVersions,
  ERC4626AdapterUSDCVersions,
  PartialNetworksConfig,
  Token,
  TokenInfo,
  RepayerProxy, USDCStashDexProcessorProxy,
  LiquidityPoolAaveUSDCProxy, LiquidityPoolUSDCProxy,
  MainAssetConfig,
  LiquidityPoolPublicProxy,
  LiquidityPoolId,
  LiquidityPoolAaveId,
  LiquidityPoolAaveLongTermId,
  LiquidityPoolStablecoinId,
  ERC4626AdapterId,
} from "../network.config";

// The token that Liquidity Pools/Hub/Rebalancer are denominated in for this deployment,
// e.g. "USDC" or "USDT". Set via the MAIN_ASSET env variable.
export function getMainAsset(config: NetworkConfig): {
  mainAsset: Token, mainAssetConfig: MainAssetConfig, mainAssetInfo: TokenInfo
} {
  const token = process.env.MAIN_ASSET;
  assert(token, "MAIN_ASSET must be set");
  const mainAsset = token as Token;
  assert(Object.values(Token).includes(mainAsset), `Invalid MAIN_ASSET: ${mainAsset}`);
  const mainAssetConfig = config.MainAssets[mainAsset];
  assert(mainAssetConfig, `${mainAsset} main asset config must be in config`);
  const mainAssetInfo = config.Tokens[mainAsset];
  assert(mainAssetInfo, `${mainAsset} token must be in config`);
  assertAddress(mainAssetInfo.Address, `${mainAsset} token address must be an address`);
  return {mainAsset: mainAsset, mainAssetConfig, mainAssetInfo};
}

export async function resolveAddresses(input: any[]): Promise<any[]> {
  return await Promise.all(input.map(async (el) => {
    // Resolving all Addressable into string addresses or ids.
    try {
      return await resolveAddress(el);
    } catch {
      return el;
    }
  }));
}

export function stringify(input?: any[]): string {
  return JSON.stringify(input, (key, value) => {
    if ((typeof value) == "bigint") {
      return value.toString();
    }
    return value;
  });
}

interface VerificationInput {
  address: string;
  constructorArguments: any[];
  contract?: string;
}

export class Verifier {
  private contracts: VerificationInput[] = [];
  private deployXPrefix: string;

  constructor(deployXPrefix: string = "") {
    this.deployXPrefix = deployXPrefix;
  }

  deploy = async(
    contractName: string,
    deployer: Signer,
    txParams: object = {},
    params: any[] = [],
    contractVerificationName?: string,
  ): Promise<BaseContract> => {
    const contract = await deploy(contractName, deployer, txParams, ...params);
    await this.addContractForVerification(contract, params, contractVerificationName);
    return contract;
  }

  deployX = async (
    contractName: string,
    deployer: Signer,
    txParams: object = {},
    params: any[] = [],
    id: string = contractName,
    contractVerificationName?: string,
  ): Promise<BaseContract> => {
    const contract = await deployX(contractName, deployer, this.deployXPrefix + id, txParams, ...params);
    await this.addContractForVerification(contract, params, contractVerificationName);
    return contract;
  }

  predictDeployXAddresses = async (
    idsContractNamesOrAddresses: string[],
    deployer: Signer,
  ): Promise<string[]> => {
    return await Promise.all(idsContractNamesOrAddresses.map(idOrNameOrAddress => {
      if (isAddress(idOrNameOrAddress)) {
        return idOrNameOrAddress;
      }
      return getDeployXAddressBase(deployer, this.deployXPrefix + idOrNameOrAddress, false);
    }));
  }

  predictDeployXAddress = async (
    idOrContractName: string,
    deployer: Signer,
  ): Promise<string> => {
    return await getDeployXAddressBase(deployer, this.deployXPrefix + idOrContractName, false);
  }

  predictDeployProxyXAddress = async (
    idOrContractName: string,
    deployer: Signer,
    proxyType: string = DEFAULT_PROXY_TYPE,
  ): Promise<string> => {
    return await getDeployXAddressBase(deployer, this.deployXPrefix + proxyType + idOrContractName, false);
  }

  addContractForVerification = async (address: AddressLike, constructorArguments: any[], contract?: string) => {
    this.contracts.push({
      address: await resolveAddress(address),
      constructorArguments: await resolveAddresses(constructorArguments),
      contract: contract,
    });
  }

  verify = async (performVerification: boolean) => {
    if (hre.network.name === "hardhat") {
      return;
    }
    if (performVerification) {
      console.log("Waiting half a minute to start verification");
      await sleep(30000);
      for (const contract of this.contracts) {
        try {
          await hre.run("verify:verify", contract);
        } catch(error) {
          console.error(error);
          console.log(`Failed to verify: ${contract.address}`);
          console.log(stringify(contract.constructorArguments));
        }
      }
    } else {
      console.log();
      console.log("Verification skipped");
      for (const contract of this.contracts) {
        console.log(`Contract: ${contract.address}`);
        if (contract.contract) {
          console.log(`Name: ${contract.contract}`);
        }
        if (contract.constructorArguments.length > 0) {
          console.log("Constructor args:");
          console.log(stringify(contract.constructorArguments));
        }
        console.log();
      }
    }
  }
}

export function getVerifier(deployXPrefix: string = "") {
  return new Verifier(deployXPrefix);
}

interface Initializable extends BaseContract {
  initialize: {
    populateTransaction: (...params: any[]) => Promise<ContractTransaction>
  }
}

type DeployXFunction = (
  contractName: string,
  deployer: Signer,
  txParams: object,
  params: any[],
  id: string,
  contractVerificationName?: string,
) => Promise<BaseContract>;

export async function deployProxyX<ContractType extends Initializable>(
  deployFunc: DeployXFunction,
  contractName: string,
  deployer: Signer,
  upgradeAdmin: AddressLike,
  contructorArgs: any[] = [],
  initArgs: any[] = [],
  id: string = contractName,
  verifier?: Verifier,
  contractsDeployedInInit: number = 0,
  contractVerificationName?: string,
): Promise<{target: ContractType; targetAdmin: ProxyAdmin;}> {
  const targetImpl = (
    await deployFunc(contractName, deployer, {}, contructorArgs, "Implementation" + id, contractVerificationName)
  ) as ContractType;
  const targetInit = (await targetImpl.initialize.populateTransaction(...initArgs)).data;
  const targetProxy = (await deployFunc(
    DEFAULT_PROXY_TYPE, deployer, {},
    [targetImpl, await resolveAddress(upgradeAdmin), targetInit],
    DEFAULT_PROXY_TYPE + id,
  )) as TransparentUpgradeableProxy;
  const target = (await getContractAt(contractName, targetProxy, deployer)) as ContractType;
  const targetProxyAdminAddress = await getCreateAddress(targetProxy, contractsDeployedInInit + 1);
  const targetAdmin = (await getContractAt("ProxyAdmin", targetProxyAdminAddress)) as ProxyAdmin;
  await verifier?.addContractForVerification(targetProxyAdminAddress, [upgradeAdmin]);
  return {target, targetAdmin};
}

export async function upgradeProxyX<ContractType extends Initializable>(
  deployFunc: DeployXFunction,
  proxyAddress: AddressLike,
  contractName: string,
  deployer: Signer,
  contructorArgs: any[] = [],
  id: string = contractName,
  contractVerificationName?: string,
): Promise<{target?: ContractType; txRequired: boolean}> {
  const targetImpl = (
    await deployFunc(contractName, deployer, {}, contructorArgs, "Implementation" + id, contractVerificationName)
  ) as ContractType;
  console.log(`New ${contractName} implementation deployed to ${await resolveAddress(targetImpl)}`);
  const targetAdmin = await getProxyXAdmin(await resolveAddress(proxyAddress), deployer);
  const adminOwner = await targetAdmin.owner();
  if (adminOwner == await resolveAddress(deployer)) {
    console.log(`Sending ${contractName} upgrade transaction.`);
    const upgradeTx = await targetAdmin.upgradeAndCall(proxyAddress, targetImpl, "0x");
    console.log(upgradeTx.hash);
    await upgradeTx.wait();
    console.log(`${contractName} upgraded.`);
    const target = (await getContractAt(contractName, proxyAddress, deployer)) as ContractType;
    return {target, txRequired: false};
  } else {
    const tx = await targetAdmin.upgradeAndCall.populateTransaction(
      proxyAddress, targetImpl, "0x", {from: adminOwner}
    );
    console.log(`Simulating ${contractName} upgrade.`);
    await hre.ethers.provider.call(tx);
    console.log("Success.");
    console.log(`To finalize upgrade send the following transaction from ProxyAdmin owner: ${adminOwner}`);
    console.log(`To: ${tx.to}`);
    console.log("Value: 0");
    console.log(`Data: ${tx.data}`);
    return {txRequired: true};
  }
}

export async function getProxyXAdmin(idOrAddress: string, signer?: Signer): Promise<ProxyAdmin> {
  const adminAddress = await resolveAddress(
    "0x" +
    (await hre.ethers.provider.getStorage(
      await resolveProxyXAddress(idOrAddress), "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103")
    ).slice(-40)
  );
  await assertCode(adminAddress);
  return (await getContractAt("ProxyAdmin", adminAddress, signer)) as ProxyAdmin;
}

export async function addLocalPoolUSDC(
  condition: any,
  network: Network,
  routes: {Pool: string, Domain: Network, Provider: Provider, OnlySupportedToken?: string}[],
  versions: (typeof LiquidityPoolUSDCVersions)
    | (typeof LiquidityPoolAaveUSDCVersions)
    | (typeof LiquidityPoolUSDCStablecoinVersions)
    | (typeof LiquidityPoolAaveUSDCLongTermVersions)
    | (typeof ERC4626AdapterUSDCVersions),
  config: NetworkConfig,
  poolName: string,
  onlySupportedToken?: Token,
): Promise<void> {
  if (condition) {
    let pool = "";
    for (const version of versions.slice().reverse()) {
      try {
        pool = await resolveXAddress(version);
        break;
      } catch {
        // Try older version.
      }
    }
    assertAddress(pool, `${poolName} pool not found`);
    let onlySupportedTokenAddress = ZERO_ADDRESS;
    if (onlySupportedToken) {
      assert(
        config.Tokens[onlySupportedToken],
        `Token ${onlySupportedToken} is not found in the network config`
      );
      onlySupportedTokenAddress = config.Tokens[onlySupportedToken]!.Address;
    }
    routes.push({
      Pool: pool,
      Domain: network,
      Provider: Provider.LOCAL,
      OnlySupportedToken: onlySupportedTokenAddress,
    });
  }
}

export async function addLocalPoolProxy(
  condition: any,
  network: Network,
  routes: {Pool: string, Domain: Network, Provider: Provider, OnlySupportedToken?: string}[],
  id: string,
  config: NetworkConfig,
  onlySupportedToken?: Token,
): Promise<void> {
  if (condition) {
    const pool = await resolveProxyXAddress(id);
    let onlySupportedTokenAddress = ZERO_ADDRESS;
    if (onlySupportedToken) {
      assert(
        config.Tokens[onlySupportedToken],
        `Token ${onlySupportedToken} is not found in the network config`
      );
      onlySupportedTokenAddress = config.Tokens[onlySupportedToken].Address;
    }
    routes.push({
      Pool: pool,
      Domain: network,
      Provider: Provider.LOCAL,
      OnlySupportedToken: onlySupportedTokenAddress,
    });
  }
}

export async function addLocalPools(
  config: NetworkConfig,
  network: Network,
  routes: {Pool: string, Domain: Network, Provider: Provider, OnlySupportedToken?: string}[],
  isRebalancer: boolean = true,
): Promise<void> {
  const {mainAsset} = getMainAsset(config);
  let mainAssets = Object.entries(config.MainAssets) as [Token, MainAssetConfig][];
  // If isRebalancer only add mainAsset pools.
  if (isRebalancer) {
    mainAssets = mainAssets.filter(([token]) => token === mainAsset);
  }
  // Otherwise local pools for all main assets.
  for (const [token, tokenConfig] of mainAssets) {
    if (token === Token.USDC) {
      // USDC still has active not upgradable pools, so uses multi version approach.
      await addLocalPoolUSDC(
        tokenConfig.AavePoolLongTerm, network, routes, LiquidityPoolAaveUSDCLongTermVersions,
        config, "Aave USDC Long Term"
      );
      await addLocalPoolUSDC(tokenConfig.AavePool, network, routes, LiquidityPoolAaveUSDCVersions, config, "Aave USDC");
      await addLocalPoolUSDC(
        tokenConfig.BasicPool, network, routes, LiquidityPoolUSDCVersions, config, "USDC", token
      );
      await addLocalPoolUSDC(
        tokenConfig.StablecoinPool, network, routes, LiquidityPoolUSDCStablecoinVersions,
        config, "USDC stablecoin"
      );
      if (isRebalancer) {
        await addLocalPoolUSDC(
          tokenConfig.ERC4626AdapterTargetVault, network, routes, ERC4626AdapterUSDCVersions,
          config, "ERC4626 Adapter USDC", token
        );
      }
    } else {
      await addLocalPoolProxy(
        tokenConfig.BasicPool, network, routes, idWithMainAsset(token, LiquidityPoolId), config, token
      );
      await addLocalPoolProxy(
        tokenConfig.AavePool, network, routes, idWithMainAsset(token, LiquidityPoolAaveId), config
      );
      await addLocalPoolProxy(
        tokenConfig.AavePoolLongTerm, network, routes, idWithMainAsset(token, LiquidityPoolAaveLongTermId), config
      );
      await addLocalPoolProxy(
        tokenConfig.StablecoinPool, network, routes, idWithMainAsset(token, LiquidityPoolStablecoinId), config
      );
      if (isRebalancer) {
        await addLocalPoolProxy(
          tokenConfig.ERC4626AdapterTargetVault, network, routes, idWithMainAsset(token, ERC4626AdapterId),
          config, token
        );
      }
    }
    const legacyPools = tokenConfig.ActiveLegacyPools;
    if (legacyPools) {
      for (const [pool, supportsAllTokens] of Object.entries(legacyPools) as [string, boolean][]) {
        assert(config.Tokens[token], `Token ${token} not found in config`);
        routes.push({
          Pool: await resolveXAddress(pool),
          Domain: network,
          Provider: Provider.LOCAL,
          OnlySupportedToken: supportsAllTokens ? ZERO_ADDRESS : config.Tokens[token].Address,
        });
      }
    }
  }
}

export function getNetworkConfigsForCurrentEnv(): PartialNetworksConfig {
  if (process.env.DEPLOY_TYPE === "STAGE") {
    return stageNetworkConfig;
  }
  return prodNetworkConfig;
}

export function getInputOutputTokens(network: Network, config: NetworkConfig) {
  const envConfigs = getNetworkConfigsForCurrentEnv();
  const inputOutputTokens: Repayer.InputOutputTokenStruct[] = [];
  for (const [tokenSymbol, token] of Object.entries(config.Tokens) as [Token, TokenInfo][]) {
    const inputToken: Repayer.InputOutputTokenStruct = {
      inputToken: token.Address,
      destinationTokens: [],
    };
    for (const [envNetwork, envConfig] of Object.entries(envConfigs) as [Network, NetworkConfig][]) {
      if (envNetwork === network) continue;
      if (envConfig.Tokens[tokenSymbol]) {
        inputToken.destinationTokens.push({
          destinationDomain: DomainSolidity[envNetwork],
          outputToken: addressToBytes32(envConfig.Tokens[tokenSymbol].Address),
          localDecimalsGreaterBy: token.Decimals - envConfig.Tokens[tokenSymbol].Decimals,
        });
      }
    }
    if (inputToken.destinationTokens.length > 0) {
      inputOutputTokens.push(inputToken);
    }
  }
  return inputOutputTokens;
}

export function flattenInputOutputTokens(inputOutputTokens: Repayer.InputOutputTokenStruct[]) {
  const flatInputOutputTokens: {
    InputToken: string;
    Domain: Network;
    OutputToken: string;
    DecimalsDiff: number;
  }[] = [];
  for (const entry of inputOutputTokens) {
    for (const destinationToken of entry.destinationTokens) {
      flatInputOutputTokens.push({
        InputToken: entry.inputToken as string,
        Domain: SolidityDomain[Number(destinationToken.destinationDomain)],
        OutputToken: bytes32ToToken(destinationToken.outputToken),
        DecimalsDiff: Number(destinationToken.localDecimalsGreaterBy),
      });
    }
  }
  return flatInputOutputTokens;
}

export async function getNetworkConfig() {
  let network: Network;
  let config: NetworkConfig;
  let message = "Using config for: ";
  if (hre.network.name === "hardhat" && Object.values(Network).includes(process.env.DRY_RUN as Network)) {
    message += "dry run, ";
    network = process.env.DRY_RUN as Network;
    config = prodNetworkConfig[network];
  } else if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = prodNetworkConfig[network];
  }
  if (config! && network!) {
    if (process.env.DEPLOY_TYPE === "STAGE") {
      assert(
        process.env.DEPLOYER_ADDRESS === process.env.STAGE_DEPLOYER_ADDRESS,
        `DEPLOYER_ADDRESS(${process.env.DEPLOYER_ADDRESS}) must match
         STAGE_DEPLOYER_ADDRESS(${process.env.STAGE_DEPLOYER_ADDRESS})`
      );
      assert(stageNetworkConfig[network], "Stage config must be defined");
      message += "stage, ";
      config = stageNetworkConfig[network]!;
    } else {
      assert(
        process.env.DEPLOYER_ADDRESS !== process.env.STAGE_DEPLOYER_ADDRESS,
        `DEPLOYER_ADDRESS(${process.env.DEPLOYER_ADDRESS}) must not match
         STAGE_DEPLOYER_ADDRESS(${process.env.STAGE_DEPLOYER_ADDRESS})`
      );
    }
    console.log(`${message}${network}`);
  }
  return {network: network!, config: config!};
}

export async function getHardhatNetworkConfig() {
  assert(hre.network.name === "hardhat" || hre.network.name === "localhost", "Only for Hardhat or localhost network");
  const network = Network.BASE;
  const [deployer, opsAdmin, superAdmin, mpc] = await hre.ethers.getSigners();
  process.env.DEPLOYER_ADDRESS = await resolveAddress(deployer);
  const config = prodNetworkConfig[network];
  config.ChainId = 31337;
  const {mainAsset, mainAssetConfig} = getMainAsset(config);
  assert(mainAssetConfig.Hub, "Hub must be in config");
  mainAssetConfig.Hub.AssetsAdjuster = superAdmin.address;
  mainAssetConfig.Hub.DepositProfit = opsAdmin.address;
  mainAssetConfig.Hub.AssetsLimitSetter = opsAdmin.address;
  config.Admin = superAdmin.address;
  config.WithdrawProfit = opsAdmin.address;
  config.Pauser = opsAdmin.address;
  config.RebalanceCaller = opsAdmin.address;
  config.RepayerCaller = opsAdmin.address;
  config.MpcAddress = mpc.address;
  config.SignerAddress = opsAdmin.address;
  mainAssetConfig.StablecoinPool = true;
  if (!mainAssetConfig.AavePoolLongTerm) {
    if (mainAssetConfig.AavePool) {
      mainAssetConfig.AavePoolLongTerm = {
        ...mainAssetConfig.AavePool,
        BorrowLongTermAdmin: opsAdmin.address,
        RepayCaller: opsAdmin.address,
      };
    }
  }
  if (!mainAssetConfig.PublicPool) {
    mainAssetConfig.PublicPool = {
      Name: `Public Liquidity Pool ${mainAsset}`,
      Symbol: `PLP${mainAsset}`,
      ProtocolFeeRate: 20,
      FeeSetter: opsAdmin.address,
    };
  }
  if (!mainAssetConfig.ERC4626AdapterTargetVault) {
    mainAssetConfig.ERC4626AdapterTargetVault = idWithMainAsset(mainAsset, LiquidityPoolPublicProxy);
  }
  if (!config.StashDex) {
    config.StashDex = {
      Oracle: "PaxosOracle",
      Receiver: RepayerProxy,
      ConfigAdmin: opsAdmin.address,
      Forwarder: opsAdmin.address,
      Pools: {
        USDC: LiquidityPoolUSDCProxy,
        USDT: LiquidityPoolAaveUSDCProxy,
      },
      Routes: [
        {TokenIn: Token.USDT, TokenOut: Token.USDC, FeeBps: 3, Processor: USDCStashDexProcessorProxy},
      ],
    };
  }

  console.log("Using config for: hardhat");
  return {
    network, config, opsAdmin, superAdmin, mpc,
  };
}

export async function getStandaloneRepayerConfig(repayerEnv: StandaloneRepayerEnv) {
  let network: Network;
  let config: StandaloneRepayerConfig;
  let message = `Using config for: ${repayerEnv}, `;
  if (hre.network.name === "hardhat" && repayerConfig[process.env.DRY_RUN as Network]) {
    message += "dry run, ";
    network = process.env.DRY_RUN as Network;
    config = repayerConfig[network]![repayerEnv]!;
  } else if (repayerConfig[hre.network.name as Network]) {
    network = hre.network.name as Network;
    config = repayerConfig[network]![repayerEnv]!;
  }
  if (config! && network!) {
    console.log(`${message}${network}`);
  }
  return {network: network!, config: config!};
}

export async function getHardhatStandaloneRepayerConfig(repayerEnv: StandaloneRepayerEnv) {
  assert(hre.network.name === "hardhat", "Only for Hardhat network");
  const network = Network.BASE;
  const [deployer, opsAdmin, superAdmin] = await hre.ethers.getSigners();
  process.env.DEPLOYER_ADDRESS = await resolveAddress(deployer);
  const config = repayerConfig[network]![repayerEnv];
  assert(config, `No config for repayer env ${repayerEnv}`);
  config.ChainId = 31337;
  config.Admin = superAdmin.address;
  config.RepayerCallers = [opsAdmin.address];

  console.log(`Using config for: ${repayerEnv}, hardhat`);
  return {
    network, config, opsAdmin, superAdmin,
  };
}

export function percentsToBps(input: number[]): bigint[] {
  return input.map(el => BigInt(el) * 10000n / 100n);
}

export async function logDeployers(mustMatch: boolean = true) {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer        : ${deployer.address}`);
  console.log(`DEPLOYER_ADDRESS: ${process.env.DEPLOYER_ADDRESS}`);
  if (mustMatch) {
    assert(
      deployer.address === process.env.DEPLOYER_ADDRESS,
      "Deployer address must match DEPLOYER_ADDRESS for new deployments",
    );
  }
}

export function idWithMainAsset(mainAsset: Token, id: string): string {
  assert(id !== "Repayer", "Repayer is common for all main assets");
  // Historically USDC main asset didn't use suffixes on every contract id.
  if (mainAsset === Token.USDC) {
    if (id === "Rebalancer" || id === "LiquidityHub" || id === "SprinterLiquidityMining") {
      return id;
    }
  }
  return id + mainAsset;
}
