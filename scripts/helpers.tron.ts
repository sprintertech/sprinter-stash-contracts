import {getContractAt} from "../test/helpers";
import {
  sameAddress, bytes32ToToken,
} from "../scripts/common";
import {
  ProxyAdmin,
} from "../typechain-types";
import {
  DEFAULT_PROXY_TYPE,
} from "../network.config";
import {BaseContract, ContractTransaction} from "ethers";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployOptions, DeployResult, TxOptions, Receipt} from "hardhat-deploy/types";

const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// Tron mainnet resource estimates for deploying/executing on the Tron network:
// Energy required ~= gasUsed (1:1).
// Bandwidth required ~= the input data size of the broadcast transaction, in bytes.
// Cost (in TRX, if unstaked/burned) = resource amount * price per unit.
const ENERGY_PRICE = 0.0001;
const BANDWIDTH_PRICE = 0.001;

// Transactions also include signatures and other data, so we add an approximate overhead to the data size.
const BANDWIDTH_OVERHEAD_PER_TX = 300;

function bytecodeSize(bytecode: string): number {
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  return hex.length / 2;
}

// Constructor args are ABI-encoded as 32-byte words, except dynamic-length args
// (eg. proxy init calldata), which are encoded at their own byte length.
function argsSize(args: any[]): number {
  return args.reduce((total: number, arg) => {
    const str = String(arg);
    return total + (str.length <= 66 ? 32 : str.length / 2);
  }, 0);
}

interface TrackedResource {
  Name: string;
  GasUsed: number;
  TxDataSize: number;
}

// Tracks Energy (from tx receipts' gasUsed) and Bandwidth spent across every
// deployments.deploy()/deployments.execute() call made through this singleton, so a deploy
// script can report its own total spend at the end.
export class ResourceCalculator {
  private static instance: ResourceCalculator;
  private records: TrackedResource[] = [];

  private constructor() {}

  static getInstance(): ResourceCalculator {
    if (!ResourceCalculator.instance) {
      ResourceCalculator.instance = new ResourceCalculator();
    }
    return ResourceCalculator.instance;
  }

  private record(name: string, gasUsed: number, txDataSize: number) {
    this.records.push({Name: name, GasUsed: gasUsed, TxDataSize: txDataSize});
  }

  private trackDeployment(name: string, gasUsed: number, bytecode?: string, args?: any[]) {
    if (!bytecode) {
      console.log(`Missing bytecode to measure bandwidth for ${name}.`);
      return;
    }
    const txDataSize = bytecodeSize(bytecode) + argsSize(args || []) + BANDWIDTH_OVERHEAD_PER_TX;
    this.record(name, gasUsed, txDataSize);
  }

  private async trackExecute(hre: HardhatRuntimeEnvironment, name: string, gasUsed: number, transactionHash: string) {
    const tx = await hre.ethers.provider.getTransaction(transactionHash);
    if (!tx) {
      console.log(`Could not fetch transaction ${transactionHash} to measure bandwidth for ${name}.`);
      return;
    }
    const txDataSize = (tx.data.length - 2) / 2 + BANDWIDTH_OVERHEAD_PER_TX;
    this.record(name, gasUsed, txDataSize);
  }

  async deploy(hre: HardhatRuntimeEnvironment, name: string, options: DeployOptions): Promise<DeployResult> {
    const result = await hre.deployments.deploy(name, options);
    if (result.newlyDeployed && result.receipt) {
      this.trackDeployment(name, Number(result.receipt.gasUsed.toString()), result.bytecode, result.args);
      if (options.proxy) {
        const implId = name + "_Implementation";
        const implementation = await hre.deployments.get(implId);
        if (implementation.receipt) {
          this.trackDeployment(
            implId, Number(implementation.receipt.gasUsed.toString()), implementation.bytecode, implementation.args
          );
        }
      }
    }
    return result;
  }

  async execute(
    hre: HardhatRuntimeEnvironment,
    name: string,
    options: TxOptions,
    methodName: string,
    ...args: any[]
  ): Promise<Receipt> {
    const receipt = await hre.deployments.execute(name, options, methodName, ...args);
    await this.trackExecute(hre, `${name}.${methodName}`, Number(receipt.gasUsed.toString()), receipt.transactionHash);
    return receipt;
  }

  // Prints the resources spent since the last report() call, then resets — so each deploy
  // script's own report reflects only what that script itself spent.
  report(): void {
    if (this.records.length === 0) {
      console.log("No Tron resources spent.");
      return;
    }
    console.table(this.records);

    const totalGasUsed = this.records.reduce((sum, el) => sum + el.GasUsed, 0);
    const totalBandwidth = this.records.reduce((sum, el) => sum + el.TxDataSize, 0);
    const totalEnergy = Number(totalGasUsed);
    const energyCost = totalEnergy * ENERGY_PRICE;
    const bandwidthCost = totalBandwidth * BANDWIDTH_PRICE;

    console.log(`Estimated Energy: ${totalEnergy}`);
    console.log(`Estimated Bandwidth: ${totalBandwidth}`);
    console.log(`Estimated Energy Cost: ${energyCost} TRX`);
    console.log(`Estimated Bandwidth Cost: ${bandwidthCost} TRX`);

    this.records = [];
  }
}

interface Initializable extends BaseContract {
  initialize: {
    populateTransaction: (...params: any[]) => Promise<ContractTransaction>
  }
}

export async function deployProxy<ContractType extends Initializable>(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  deployer: string,
  upgradeAdmin: string,
  contructorArgs: any[] = [],
  initArgs: any[] = [],
  id: string = contractName,
): Promise<{target: ContractType; targetAdmin: ProxyAdmin;}> {
  const {deployments} = hre;
  const calculator = ResourceCalculator.getInstance();

  // Deploy stub proxy admin.
  await calculator.deploy(hre, "ProxyAdmin", {
    from: deployer,
    args: [deployer],
    log: true,
    // skipIfAlreadyDeployed: true,
  });

  const proxy = await calculator.deploy(hre, id, {
    contract: contractName,
    from: deployer,
    args: contructorArgs,
    proxy: {
      proxyContract: DEFAULT_PROXY_TYPE,
      execute: {
        methodName: "initialize",
        args: initArgs,
      },
    },
    log: true,
  });

  const admin = bytes32ToToken(await hre.ethers.provider.getStorage(proxy.address, ADMIN_SLOT));
  const target = (await getContractAt(contractName, proxy.address)) as ContractType;
  const targetAdmin = (await getContractAt("ProxyAdmin", admin)) as ProxyAdmin;

  if (!proxy.newlyDeployed) {
    console.log(`${id} was already deployed: ${proxy.address}`);
  }
  const stubAdmin = await deployments.get("ProxyAdmin");
  const oldAddress = stubAdmin.address;
  const oldTransactionHash = stubAdmin.transactionHash;
  const oldReceipt = stubAdmin.receipt;
  stubAdmin.address = admin;
  stubAdmin.transactionHash = proxy.transactionHash;
  stubAdmin.receipt = proxy.receipt;
  // Have to manually save ProxyAdmin artifact because hardhat-deploy doesn't support deploy from constructor.
  await deployments.save(`${id}ProxyAdmin`, stubAdmin);
  // Restoring original values from the ProxyAdmin artifact.
  stubAdmin.address = oldAddress;
  stubAdmin.transactionHash = oldTransactionHash;
  stubAdmin.receipt = oldReceipt;
  if (!sameAddress(await targetAdmin.owner(), upgradeAdmin)) {
    console.log(`Transferring ownership of ${id} to ${upgradeAdmin}`);
    await calculator.execute(hre, `${id}ProxyAdmin`, {from: deployer, log: true}, "transferOwnership", upgradeAdmin);
  }

  return {target, targetAdmin};
}

export async function upgradeProxy<ContractType>(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  deployer: string,
  contructorArgs: any[] = [],
  id: string = contractName,
): Promise<{target?: ContractType; txRequired: boolean;}> {
  const {deployments} = hre;
  const calculator = ResourceCalculator.getInstance();

  const proxyAddress = (await deployments.get(id)).address;

  const targetImpl = await calculator.deploy(hre, id + "_Implementation", {
    contract: contractName,
    from: deployer,
    args: contructorArgs,
    log: true,
  });
  if (targetImpl.newlyDeployed) {
    console.log(`New ${id} implementation deployed to ${targetImpl.address}`);
  } else {
    console.log(`${id} implementation already deployed to ${targetImpl.address}`);
  }

  const admin = bytes32ToToken(await hre.ethers.provider.getStorage(proxyAddress, ADMIN_SLOT));
  const currentImpl = bytes32ToToken(await hre.ethers.provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT));
  if (sameAddress(currentImpl, targetImpl.address)) {
    console.log(`${id} implementation already up to date.`);
    return {txRequired: false};
  }

  const targetAdmin = (await getContractAt("ProxyAdmin", admin)) as ProxyAdmin;

  const adminOwner = await targetAdmin.owner();
  if (sameAddress(adminOwner, deployer)) {
    console.log(`Sending ${id} upgrade transaction.`);
    await calculator.execute(
      hre,
      id + "ProxyAdmin",
      {from: deployer, log: true},
      "upgradeAndCall",
      proxyAddress, targetImpl.address, "0x",
    );
    console.log(`${id} upgraded.`);
    const target = (await getContractAt(contractName, proxyAddress)) as ContractType;
    return {target, txRequired: false};
  } else {
    const tx = await targetAdmin.upgradeAndCall.populateTransaction(
      proxyAddress, targetImpl.address, "0x", {from: adminOwner}
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
