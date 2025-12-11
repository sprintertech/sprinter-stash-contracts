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
  sleep, DEFAULT_PROXY_TYPE, assert, assertAddress, DomainSolidity, addressToBytes32, bytes32ToToken, SolidityDomain
} from "./common";
import {
  networkConfig, Network, NetworkConfig, StandaloneRepayerEnv, StandaloneRepayerConfig,
  repayerConfig,
  Provider,
  LiquidityPoolAaveUSDCVersions,
  LiquidityPoolUSDCVersions,
  LiquidityPoolUSDCStablecoinVersions,
  LiquidityPoolAaveUSDCLongTermVersions,
  LiquidityPoolPublicUSDCVersions,
  ERC4626AdapterUSDCVersions,
  PartialNetworksConfig,
  Token,
} from "../network.config";

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
): Promise<{target: ContractType; targetAdmin: ProxyAdmin;}> {
  const targetImpl = (
    await deployFunc(contractName, deployer, {}, contructorArgs, id)
  ) as ContractType;
  const targetInit = (await targetImpl.initialize.populateTransaction(...initArgs)).data;
  const targetProxy = (await deployFunc(
    DEFAULT_PROXY_TYPE, deployer, {},
    [targetImpl, await resolveAddress(upgradeAdmin), targetInit],
    DEFAULT_PROXY_TYPE + id,
  )) as TransparentUpgradeableProxy;
  const target = (await getContractAt(contractName, targetProxy, deployer)) as ContractType;
  const targetProxyAdminAddress = await getCreateAddress(targetProxy, 1);
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
): Promise<{target?: ContractType; txRequired: boolean}> {
  const targetImpl = (
    await deployFunc(contractName, deployer, {}, contructorArgs, id)
  ) as ContractType;
  console.log(`New ${contractName} implementation deployed to ${await resolveAddress(targetImpl)}`);
  const targetAdmin = await getProxyXAdmin(await resolveAddress(proxyAddress), deployer);
  const adminOwner = await targetAdmin.owner();
  if (adminOwner == await resolveAddress(deployer)) {
    console.log(`Sending ${contractName} upgrade transaction.`);
    const upgradeTx = await targetAdmin.upgradeAndCall(proxyAddress, targetImpl, "0x");
    console.log(upgradeTx.hash);
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

export async function addLocalPool(
  condition: any,
  network: Network,
  routes: {Pool: string, Domain: Network, Provider: Provider, SupportsAllTokens?: boolean}[],
  versions: (typeof LiquidityPoolUSDCVersions)
    | (typeof LiquidityPoolAaveUSDCVersions)
    | (typeof LiquidityPoolUSDCStablecoinVersions)
    | (typeof LiquidityPoolAaveUSDCLongTermVersions)
    | (typeof ERC4626AdapterUSDCVersions),
  supportsAllTokens: boolean,
  poolName: string,
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
    routes.push({
      Pool: pool,
      Domain: network,
      Provider: Provider.LOCAL,
      SupportsAllTokens: supportsAllTokens,
    });
  }
}

export async function addLocalPools(
  config: NetworkConfig,
  network: Network,
  routes: {Pool: string, Domain: Network, Provider: Provider, SupportsAllTokens?: boolean}[],
  isRebalancer: boolean = true,
): Promise<void> {
  await addLocalPool(
    config.AavePoolLongTerm, network, routes, LiquidityPoolAaveUSDCLongTermVersions, true, "Aave USDC Long Term"
  );
  await addLocalPool(config.AavePool, network, routes, LiquidityPoolAaveUSDCVersions, true, "Aave USDC");
  await addLocalPool(config.USDCPool, network, routes, LiquidityPoolUSDCVersions, false, "USDC");
  await addLocalPool(
    config.USDCStablecoinPool, network, routes, LiquidityPoolUSDCStablecoinVersions, true, "USDC stablecoin"
  );
  if (isRebalancer) {
    await addLocalPool(
      config.ERC4626AdapterUSDCTargetVault, network, routes, ERC4626AdapterUSDCVersions, false, "ERC4626 Adapter USDC"
    );
  }
}

export function getNetworkConfigsForCurrentEnv(config: NetworkConfig): PartialNetworksConfig {
  const networkConfigs: PartialNetworksConfig = {};
  let isTest = false;
  let isStage = false;
  if (config.IsTest) {
    isTest = true;
  } else if (process.env.DEPLOY_TYPE === "STAGE") {
    isStage = true;
  }
  for (const network of Object.values(Network)) {
    if (isTest === networkConfig[network].IsTest) {
      networkConfigs[network] = networkConfig[network];
    } else if (isStage && networkConfig[network].Stage) {
      networkConfigs[network] = networkConfig[network].Stage;
    }
  }
  return networkConfigs;
}

export function getInputOutputTokens(network: Network, config: NetworkConfig) {
  const envConfigs = getNetworkConfigsForCurrentEnv(config);
  const inputOutputTokens: Repayer.InputOutputTokenStruct[] = [];
  for (const [tokenSymbol, tokenAddress] of Object.entries(config.Tokens) as [Token, string][]) {
    const inputToken: Repayer.InputOutputTokenStruct = {
      inputToken: tokenAddress,
      destinationTokens: [],
    };
    for (const [envNetwork, envConfig] of Object.entries(envConfigs) as [Network, NetworkConfig][]) {
      if (envNetwork === network) continue;
      if (envConfig.Tokens[tokenSymbol]) {
        inputToken.destinationTokens.push({
          destinationDomain: DomainSolidity[envNetwork],
          outputToken: addressToBytes32(envConfig.Tokens[tokenSymbol]),
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
  }[] = [];
  for (const entry of inputOutputTokens) {
    for (const destinationToken of entry.destinationTokens) {
      flatInputOutputTokens.push({
        InputToken: entry.inputToken as string,
        Domain: SolidityDomain[Number(destinationToken.destinationDomain)],
        OutputToken: bytes32ToToken(destinationToken.outputToken),
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
    config = networkConfig[network];
  } else if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = networkConfig[network];
  }
  if (config! && network!) {
    if (process.env.DEPLOY_TYPE === "STAGE") {
      assert(config.Stage, "Stage config must be defined");
      message += "stage, ";
      config = config.Stage;
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
  const config = networkConfig[network];
  config.ChainId = 31337;
  assert(config.Hub, "Hub must be in config");
  config.Hub.AssetsAdjuster = superAdmin.address;
  config.Hub.DepositProfit = opsAdmin.address;
  config.Hub.AssetsLimitSetter = opsAdmin.address;
  config.Admin = superAdmin.address;
  config.WithdrawProfit = opsAdmin.address;
  config.Pauser = opsAdmin.address;
  config.RebalanceCaller = opsAdmin.address;
  config.RepayerCaller = opsAdmin.address;
  config.MpcAddress = mpc.address;
  config.SignerAddress = opsAdmin.address;
  config.USDCStablecoinPool = true;
  if (!config.AavePoolLongTerm) {
    if (config.AavePool) {
      config.AavePoolLongTerm = {
        ...config.AavePool,
        BorrowLongTermAdmin: opsAdmin.address,
        RepayCaller: opsAdmin.address,
      };
    }
  }
  if (!config.USDCPublicPool) {
    config.USDCPublicPool = {
      Name: "Public Liquidity Pool USDC",
      Symbol: "PLPUSDC",
      ProtocolFeeRate: 20,
      FeeSetter: opsAdmin.address,
    };
  }
  if (!config.ERC4626AdapterUSDCTargetVault) {
    config.ERC4626AdapterUSDCTargetVault = LiquidityPoolPublicUSDCVersions.at(-1);
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

export async function logDeployers() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`DEPLOYER_ADDRESS: ${process.env.DEPLOYER_ADDRESS}`);
}
