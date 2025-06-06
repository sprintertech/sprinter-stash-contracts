import {isAddress, getAddress} from "ethers";

export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertAddress(address: any, message: string): asserts address {
  assert(isAddress(address), message);
}

export function sameAddress(a: any, b: any): boolean {
  return getAddress(a) === getAddress(b);
}

export function sleep(msec: number): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(true), msec);
  });
}

export function isSet(input?: string): boolean {
  if (input) {
    return input.length > 0;
  }
  return false;
}

export const ProviderSolidity = {
  LOCAL: 0n,
  CCTP: 1n,
  ACROSS: 2n,
  STARGATE: 3n,
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

export const DEFAULT_PROXY_TYPE = "TransparentUpgradeableProxy";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const DEFAULT_ADMIN_ROLE = ZERO_BYTES32;
export const ETH = 1000000000000000000n;
