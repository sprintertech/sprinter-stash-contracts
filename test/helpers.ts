import hre from "hardhat";
import {
  AddressLike, resolveAddress, Signer, BaseContract, toUtf8Bytes, TypedDataDomain,
  keccak256, concat, dataSlice, AbiCoder, EventLog, encodeBytes32String, isAddress,
  ContractDeployTransaction,
} from "ethers";
import {assert, DEFAULT_PROXY_TYPE} from "../scripts/common";
import {ICreateX} from "../typechain-types";
import dotenv from "dotenv";
dotenv.config();

async function resolveAddresses(input: AddressLike[]): Promise<string[]> {
  return await Promise.all(input.map(el => resolveAddress(el)));
}

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

export async function assertCode(contract: AddressLike): Promise<string> {
  const result = await resolveAddress(contract);
  assert(
    await hre.ethers.provider.getCode(result) !== "0x",
    `${contract} does not have any code.`
  );
  return result;
}

export async function getDeployXAddressBase(
  deployer: AddressLike,
  id: string,
  codeCheck: boolean = true,
): Promise<string> {
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
  const result = await createX["computeCreate3Address(bytes32)"](guardedSalt);
  if (codeCheck) {
    await assertCode(result);
  }
  return result;
}

export async function getDeployXAddress(id: string, codeCheck: boolean = true): Promise<string> {
  return await getDeployXAddressBase(
    process.env.DEPLOYER_ADDRESS!,
    process.env.DEPLOY_ID! + id,
    codeCheck,
  );
}

export async function getDeployProxyXAddress(
  id: string,
  codeCheck: boolean = true,
  proxyType: string = DEFAULT_PROXY_TYPE,
): Promise<string> {
  return await getDeployXAddress(proxyType + id, codeCheck);
}

async function tryResolve(address: string, codeCheck: boolean = true): Promise<string | null> {
  if (isAddress(address)) {
    if (codeCheck) {
      return await assertCode(address);
    }
    return await resolveAddress(address);
  }
  return null;
}

export async function resolveXAddress(addressOrId: string, codeCheck: boolean = true): Promise<string> {
  const result = await tryResolve(addressOrId, codeCheck);
  return result || await getDeployXAddress(addressOrId, codeCheck);
}

export async function resolveProxyXAddress(addressOrId: string, codeCheck: boolean = true): Promise<string> {
  const result = await tryResolve(addressOrId, codeCheck);
  return result || await getDeployProxyXAddress(addressOrId, codeCheck);
}

export async function resolveXAddresses(addressOrIds: string[], codeCheck: boolean = true): Promise<string[]> {
  return await Promise.all(addressOrIds.map(el => resolveXAddress(el, codeCheck)));
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

export async function getDeployTx(
  contractName: string,
  signer: Signer,
  nonce: number,
  txParams: object = {},
  ...params: any[]
): Promise<{instance: BaseContract, transaction: ContractDeployTransaction}> {
  const factory = await hre.ethers.getContractFactory(contractName, signer);
  const transaction = await factory.getDeployTransaction(...params, txParams);
  const contractAddress = await hre.ethers.getCreateAddress({
    from: await resolveAddress(signer),
    nonce,
  });
  const instance = await getContractAt(contractName, contractAddress, signer);
  return {instance, transaction};
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
  const deployedTo = (deployTx!.logs.filter(el => el.address == createX.target).pop() as EventLog).args[0];
  const instance = await getContractAt(contractName, deployedTo, signer);
  return instance;
}

export async function getDeployXTx(
  contractName: string,
  signer: Signer,
  id: string = contractName,
  txParams: object = {},
  ...params: any[]
): Promise<{instance: BaseContract, transaction: ContractDeployTransaction}> {
  const factory = await hre.ethers.getContractFactory(contractName, signer);
  const deployCode = (await factory.getDeployTransaction(...params)).data;
  const createX = await getCreateX(signer);
  const salt = concat([
    await resolveAddress(signer),
    "0x00",
    dataSlice(keccak256(toUtf8Bytes(id)), 0, 11),
  ]);
  const transaction = await createX["deployCreate3(bytes32,bytes)"].populateTransaction(salt, deployCode, txParams);
  const contractAddress = await getDeployXAddressBase(signer, id, false);
  const instance = await getContractAt(contractName, contractAddress, signer);
  return {instance, transaction};
}

export function toBytes32(str: string) {
  return encodeBytes32String(str);
}

export function divCeil(a: bigint, b: bigint): bigint {
  if (a % b == 0n) {
    return a / b;
  }
  return a / b + 1n;
}

export async function signBorrow(
  signer: Signer,
  verifyingContract: AddressLike,
  caller: AddressLike,
  borrowToken: AddressLike,
  amount: bigint,
  target: AddressLike,
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
    verifyingContract: await resolveAddress(verifyingContract)
  };

  const types = {
    Borrow: [
      {name: "caller", type: "address"},
      {name: "borrowToken", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "target", type: "address"},
      {name: "targetCallData", type: "bytes"},
      {name: "nonce", type: "uint256"},
      {name: "deadline", type: "uint256"},
    ],
  };

  const value = {
    caller: await resolveAddress(caller),
    borrowToken: await resolveAddress(borrowToken),
    amount,
    target: await resolveAddress(target),
    targetCallData,
    nonce,
    deadline,
  };

  return signer.signTypedData(domain, types, value);
}

export async function signBorrowMany(
  signer: Signer,
  verifyingContract: AddressLike,
  caller: AddressLike,
  borrowTokens: AddressLike[],
  amounts: bigint[],
  target: AddressLike,
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
    verifyingContract: await resolveAddress(verifyingContract)
  };

  const types = {
    BorrowMany: [
      {name: "caller", type: "address"},
      {name: "borrowTokens", type: "address[]"},
      {name: "amounts", type: "uint256[]"},
      {name: "target", type: "address"},
      {name: "targetCallData", type: "bytes"},
      {name: "nonce", type: "uint256"},
      {name: "deadline", type: "uint256"},
    ],
  };

  const value = {
    caller: await resolveAddress(caller),
    borrowTokens: await resolveAddresses(borrowTokens),
    amounts,
    target: await resolveAddress(target),
    targetCallData,
    nonce,
    deadline,
  };

  return signer.signTypedData(domain, types, value);
}

export async function getBalance(addr: AddressLike): Promise<bigint> {
  return hre.ethers.provider.getBalance(addr);
}
