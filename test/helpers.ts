import hre from "hardhat";
import {AddressLike, resolveAddress, Signer, BaseContract, zeroPadBytes, toUtf8Bytes, TypedDataDomain} from "ethers";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function getCreateAddress(from: AddressLike, nonce: number): Promise<string> {
  return hre.ethers.getCreateAddress({from: await resolveAddress(from), nonce});
}

export async function getContractAt(contractName: string, address: AddressLike, signer?: Signer):
  Promise<BaseContract>
{
  return hre.ethers.getContractAt(contractName, await resolveAddress(address), signer);
}

export async function deploy(contractName: string, signer: Signer, txParams: object, ...params: any[]):
  Promise<BaseContract>
{
  const factory = await hre.ethers.getContractFactory(contractName, signer);
  const instance = await factory.deploy(...params, txParams);
  await instance.waitForDeployment();
  return instance;
}

export function toBytes32(str: string) {
  if (str.length > 32) throw new Error("String too long");
  return zeroPadBytes(toUtf8Bytes(str), 32);
}

export function divCeil(a: bigint, b: bigint): bigint {
  if (a % b == 0n) {
    return a / b;
  }
  return a / b + 1n;
}

export async function signBorrow(
  signer: Signer,
  verifyingContract: string,
  borrowToken: string,
  amount: string,
  target: string,
  targetCallData: string,
  chainId: number = 1
) {
  const name = "LiquidityPool";
  const version = "1.0.0";

  const domain: TypedDataDomain = {
    name,
    version,
    chainId,
    verifyingContract
  };

  const types = {
    Borrow: [
      {name: "borrowToken", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "target", type: "address"},
      {name: "targetCallData", type: "bytes"},
    ],
  };

  const value = {
    borrowToken: borrowToken.toLowerCase(),
    amount,
    target: target.toLowerCase(),
    targetCallData
  };

  return signer.signTypedData(domain, types, value);
};
