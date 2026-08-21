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

const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

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

  // Deploy stub proxy admin.
  await deployments.deploy("ProxyAdmin", {
    from: deployer,
    args: [deployer],
    log: true,
  });

  const proxy = await deployments.deploy(id, {
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
  stubAdmin.address = admin;
  stubAdmin.transactionHash = proxy.transactionHash;
  stubAdmin.receipt = proxy.receipt;
  // Have to manually save ProxyAdmin artifact because hardhat-deploy doesn't support deploy from constructor.
  await deployments.save(`${id}ProxyAdmin`, stubAdmin);
  if (!sameAddress(await targetAdmin.owner(), upgradeAdmin)) {
    console.log(`Transferring ownership of ${id} to ${upgradeAdmin}`);
    await deployments.execute(`${id}ProxyAdmin`, {from: deployer, log: true}, "transferOwnership", upgradeAdmin);
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

  const proxyAddress = (await deployments.get(id)).address;

  const targetImpl = await deployments.deploy(id + "_Implementation", {
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
    await deployments.execute(
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
