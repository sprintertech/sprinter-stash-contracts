import hre from "hardhat";
import {Signer, BaseContract, AddressLike, resolveAddress, ContractTransaction} from "ethers";
import {deploy, deployX, getContractAt, getCreateAddress, getDeployXAddressBase} from "../test/helpers";
import {
  TransparentUpgradeableProxy, ProxyAdmin,
} from "../typechain-types";
import {sleep, DEFAULT_PROXY_TYPE} from "./common";

export async function resolveAddresses(input: any[]): Promise<any[]> {
  return await Promise.all(input.map(async (el) => {
    // Resolving all Addressable into string addresses.
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

export function getVerifier(deployXPrefix: string = "") {
  interface VerificationInput {
    address: string;
    constructorArguments: any[];
    contract?: string;
  }

  const contracts: VerificationInput[] = [];
  return {
    deploy: async (
      contractName: string,
      deployer: Signer,
      txParams: object = {},
      params: any[] = [],
      contractVerificationName?: string,
    ): Promise<BaseContract> => {
      const contract = await deploy(contractName, deployer, txParams, ...params);
      contracts.push({
        address: await resolveAddress(contract),
        constructorArguments: await resolveAddresses(params),
        contract: contractVerificationName,
      });
      return contract;
    },
    deployX: async (
      contractName: string,
      deployer: Signer,
      txParams: object = {},
      params: any[] = [],
      id: string = contractName,
      contractVerificationName?: string,
    ): Promise<BaseContract> => {
      const contract = await deployX(contractName, deployer, deployXPrefix + id, txParams, ...params);
      contracts.push({
        address: await resolveAddress(contract),
        constructorArguments: await resolveAddresses(params),
        contract: contractVerificationName,
      });
      return contract;
    },
    predictDeployXAddress: async (
      idOrContractName: string,
      deployer: Signer,
    ): Promise<string> => {
      return await getDeployXAddressBase(deployer, deployXPrefix + idOrContractName, false);
    },
    predictDeployProxyXAddress: async (
      idOrContractName: string,
      deployer: Signer,
      proxyType: string = DEFAULT_PROXY_TYPE,
    ): Promise<string> => {
      return await getDeployXAddressBase(deployer, deployXPrefix + proxyType + idOrContractName, false);
    },
    verify: async (performVerification: boolean) => {
      if (hre.network.name === "hardhat") {
        return;
      }
      if (performVerification) {
        console.log("Waiting half a minute to start verification");
        await sleep(30000);
        for (const contract of contracts) {
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
        for (const contract of contracts) {
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
    },
  };
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
): Promise<{target: ContractType; targetAdmin: ProxyAdmin;}> {
  const targetImpl = (
    await deployFunc(contractName, deployer, {}, contructorArgs, id)
  ) as ContractType;
  const targetInit = (await targetImpl.initialize.populateTransaction(...initArgs)).data;
  const targetProxy = (await deployFunc(
    DEFAULT_PROXY_TYPE, deployer, {},
    [targetImpl.target, await resolveAddress(upgradeAdmin), targetInit],
    DEFAULT_PROXY_TYPE + id,
  )) as TransparentUpgradeableProxy;
  const target = (await getContractAt(contractName, targetProxy, deployer)) as ContractType;
  const targetProxyAdminAddress = await getCreateAddress(targetProxy, 1);
  const targetAdmin = (await getContractAt("ProxyAdmin", targetProxyAdminAddress)) as ProxyAdmin;
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
  const targetProxyAdminAddress = await resolveAddress(
    "0x" +
    (await hre.ethers.provider.getStorage(
      proxyAddress, "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103")
    ).slice(-40)
  );
  const targetAdmin = (await getContractAt("ProxyAdmin", targetProxyAdminAddress, deployer)) as ProxyAdmin;
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

export async function getProxyCreateAddress(deployer: Signer, startingNonce: number) {
  return await getCreateAddress(deployer, startingNonce + 1);
}
