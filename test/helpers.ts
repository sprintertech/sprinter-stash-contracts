import hre from "hardhat";
import {AddressLike, resolveAddress, Signer, BaseContract, zeroPadBytes, toUtf8Bytes, ContractMethodArgs} from "ethers";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function getCreateAddress(from: AddressLike, nonce: number): Promise<string> {
  return hre.ethers.getCreateAddress({from: await resolveAddress(from), nonce});
}

export async function getContractAt(contractName: string, address: AddressLike, signer: Signer): Promise<BaseContract> {
  return hre.ethers.getContractAt(contractName, await resolveAddress(address), signer);
}

export async function deploy(contractName: string, signer: Signer, txParams: object, ...params: ContractMethodArgs):
  Promise<BaseContract>
{
  const factory = await hre.ethers.getContractFactory(contractName, signer);
  const instance = await factory.deploy(...params, txParams);
  await instance.waitForDeployment();
  return instance;
}

export function toBytes32(str: string) {
  if (str.length > 32) throw new Error("String too long");
  return zeroPadBytes(toUtf8Bytes(str), 64);
}
