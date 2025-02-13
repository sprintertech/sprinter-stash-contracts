import hre from "hardhat";
import {Signer, BaseContract, AddressLike, resolveAddress, ContractTransaction} from "ethers";
import {deploy, getContractAt, getCreateAddress} from "../test/helpers";
import {
  TransparentUpgradeableProxy, ProxyAdmin,
} from "../typechain-types";
import {sleep} from "./common";

export function getVerifier() {
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
        address: await contract.getAddress(),
        constructorArguments: await Promise.all(params.map(async (el) => {
          // Resolving all Addressable into string addresses.
          try {
            return await resolveAddress(el);
          } catch {
            return el;
          }
        })),
        contract: contractVerificationName,
      });
      return contract;
    },
    verify: async (performVerification: boolean) => {
      if (performVerification) {
        console.log("Waiting half a minute to start verification");
        await sleep(30000);
        for (const contract of contracts) {
          try {
            await hre.run("verify:verify", contract);
          } catch(error) {
            console.error(error);
            console.log(`Failed to verify: ${contract.address}`);
            console.log(JSON.stringify(contract.constructorArguments));
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
            console.log(JSON.stringify(contract.constructorArguments, (key, value) => {
              if ((typeof value) == "bigint") {
                return value.toString();
              }
              return value;
            }));
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

export async function deployProxy<ContractType extends Initializable>(
  deployFunc: (contractName: string, deployer: Signer, txParams: object, ...params: any[]) => Promise<BaseContract>,
  contractName: string,
  deployer: Signer,
  upgradeAdmin: AddressLike,
  contructorArgs: any[],
  initArgs: any[]
): Promise<{target: ContractType; targetAdmin: ProxyAdmin;}> {
  const targetImpl = (
    await deployFunc(contractName, deployer, {}, contructorArgs)
  ) as ContractType;
  const targetInit = (await targetImpl.initialize.populateTransaction(...initArgs)).data;
  const targetProxy = (await deployFunc(
    "TransparentUpgradeableProxy", deployer, {},
    [targetImpl.target, await resolveAddress(upgradeAdmin), targetInit]
  )) as TransparentUpgradeableProxy;
  const target = (await getContractAt(contractName, targetProxy, deployer)) as ContractType;
  const targetProxyAdminAddress = await getCreateAddress(targetProxy, 1);
  const targetAdmin = (await getContractAt("ProxyAdmin", targetProxyAdminAddress)) as ProxyAdmin;
  return {target, targetAdmin};
}

export async function upgradeProxy<ContractType extends Initializable>(
  deployFunc: (contractName: string, deployer: Signer, txParams: object, ...params: any[]) => Promise<BaseContract>,
  contractName: string,
  deployer: Signer,
  contructorArgs: any[],
  proxyAddress: AddressLike
): Promise<{target?: ContractType; txRequired: boolean}> {
  const targetImpl = (
    await deployFunc(contractName, deployer, {}, contructorArgs)
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
