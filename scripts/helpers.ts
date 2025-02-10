import hre from "hardhat";
import {Signer} from "ethers";
import {deploy} from "../test/helpers";

export function assert(condition: boolean, message: string): void {
  if (condition) return;
  throw new Error(message);
};

export function sleep(msec: number): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(true), msec);
  });
};

export function isSet(input?: string): boolean {
  if (input) {
    return input.length > 0;
  }
  return false;
};

export function getVerifier() {
  interface VerificationInput {
    address: string;
    constructorArguments: any[];
  }

  const contracts: VerificationInput[] = [];
  return {
    deploy: async (contractName: string, signer: Signer, txParams: object, ...params: any[]) => {
      const contract = await deploy(contractName, signer, txParams, ...params);
      contracts.push({
        address: await contract.getAddress(),
        constructorArguments: params,
      });
      return contract;
    },
    verify: async () => {
      console.log("Waiting half a minute to start verification");
      await sleep(30000);
      for (const contract of contracts) {
        await hre.run("verify:verify", contract);
      }
    },
  };
};

export const ProviderSolidity = {
  CCTP: 0n,
};

export const DomainSolidity = {
  ETHEREUM: 0n,
  AVALANCHE: 1n,
  OP_MAINNET: 2n,
  ARBITRUM_ONE: 3n,
  BASE: 4n,
  POLYGON_MAINNET: 5n,
  ETHEREUM_SEPOLIA: 6n,
  AVALANCHE_FUJI: 7n,
  OP_SEPOLIA: 8n,
  ARBITRUM_SEPOLIA: 9n,
  BASE_SEPOLIA: 10n,
  POLYGON_AMOY: 11n,
};
