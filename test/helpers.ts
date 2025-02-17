import hre from "hardhat";
import {
  AddressLike, resolveAddress, Signer, BaseContract, zeroPadBytes, toUtf8Bytes, TypedDataDomain,
  keccak256, concat, dataSlice, AbiCoder, EventLog,
} from "ethers";
import {
  assert,
} from "../scripts/common";
import {
  ICreateX,
} from "../typechain-types";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function getCreateAddress(from: AddressLike, nonce: number): Promise<string> {
  return hre.ethers.getCreateAddress({from: await resolveAddress(from), nonce});
}

export async function getCreateX(deployer?: Signer): Promise<ICreateX> {
  const createX = await getContractAt("ICreateX", "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed", deployer) as ICreateX;
  const expectedBytecodeHash = "0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f";
  const actualBytecode = await hre.ethers.provider.getCode(createX);
  const actualBytecodeHash = keccak256(actualBytecode);
  assert(actualBytecodeHash === expectedBytecodeHash, `Unexpected CreateX bytecode: ${actualBytecode}`);
  return createX;
};

export async function getDeployXAddress(deployer: AddressLike, id: string): Promise<string> {
  const salt = concat([
    await resolveAddress(deployer),
    "0x00",
    dataSlice(keccak256(toUtf8Bytes(id)), 0, 11),
  ]);
  const guardedSalt = keccak256(AbiCoder.defaultAbiCoder().encode(
    ["address", "bytes32"],
    [await resolveAddress(deployer), salt],
  ));
  const createX = await getCreateX();
  return await createX["computeCreate3Address(bytes32)"](guardedSalt);
}

export async function getContractAt(
  contractName: string,
  address: AddressLike,
  signer?: Signer
): Promise<BaseContract> {
  return hre.ethers.getContractAt(contractName, await resolveAddress(address), signer);
}

export async function deploy(
  contractName: string,
  signer: Signer,
  txParams: object = {},
  ...params: any[]
): Promise<BaseContract> {
  const factory = await hre.ethers.getContractFactory(contractName, signer);
  const instance = await factory.deploy(...params, txParams);
  await instance.waitForDeployment();
  return instance;
}

export async function deployX(
  contractName: string,
  signer: Signer,
  id: string = contractName,
  txParams: object = {},
  ...params: any[]
): Promise<BaseContract> {
  const factory = await hre.ethers.getContractFactory(contractName, signer);
  const deployCode = (await factory.getDeployTransaction(...params)).data;
  const createX = await getCreateX(signer);
  const salt = concat([
    await resolveAddress(signer),
    "0x00",
    dataSlice(keccak256(toUtf8Bytes(id)), 0, 11),
  ]);
  const deployTx = await (await createX["deployCreate3(bytes32,bytes)"](salt, deployCode, txParams)).wait();
  const deployedTo = (deployTx!.logs[deployTx!.logs.length - 1] as EventLog).args[0];
  const instance = await getContractAt(contractName, deployedTo, signer);
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
  chainId: number = 1,
  nonce: bigint = 0n,
  deadline: bigint = 2000000000n
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
      {name: "nonce", type: "uint256"},
      {name: "deadline", type: "uint256"},
    ],
  };

  const value = {
    borrowToken: borrowToken.toLowerCase(),
    amount,
    target: target.toLowerCase(),
    targetCallData,
    nonce,
    deadline,
  };

  return signer.signTypedData(domain, types, value);
}
