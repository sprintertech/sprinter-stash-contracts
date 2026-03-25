import {isAddress, getAddress, zeroPadValue, stripZerosLeft} from "ethers";
import {Network, Provider} from "../network.config";

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

export function addressToBytes32(address: any) {
  return zeroPadValue(address.toString(), 32);
}

export function bytes32ToToken(bytes32: any) {
  // Making sure vanity addresses are not truncated.
  const token = zeroPadValue(stripZerosLeft(bytes32), 20);
  if (isAddress(token)) {
    return getAddress(token); // Checksum.
  }
  return token;
}

export const ProviderSolidity = {
  LOCAL: 0n,
  CCTP: 1n,
  ACROSS: 2n,
  STARGATE: 3n,
  EVERCLEAR: 4n,
  SUPERCHAIN_STANDARD_BRIDGE: 5n,
  ARBITRUM_GATEWAY: 6n,
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
  UNICHAIN: 12n,
  BSC: 13n,
  LINEA: 14n,
};

export const SolidityDomain: { [n: number]: Network } = {
  0: Network.ETHEREUM,
  1: Network.AVALANCHE,
  2: Network.OP_MAINNET,
  3: Network.ARBITRUM_ONE,
  4: Network.BASE,
  5: Network.POLYGON_MAINNET,
  6: Network.ETHEREUM_SEPOLIA,
  7: Network.AVALANCHE_FUJI,
  8: Network.OP_SEPOLIA,
  9: Network.ARBITRUM_SEPOLIA,
  10: Network.BASE_SEPOLIA,
  11: Network.POLYGON_AMOY,
  12: Network.UNICHAIN,
  13: Network.BSC,
  14: Network.LINEA,
};

export const SolidityProvider: { [n: number]: Provider } = {
  0: Provider.LOCAL,
  1: Provider.CCTP,
  2: Provider.ACROSS,
  3: Provider.STARGATE,
  4: Provider.EVERCLEAR,
  5: Provider.SUPERCHAIN_STANDARD_BRIDGE,
  6: Provider.ARBITRUM_GATEWAY,
};

export const CCTPDomain: { [n: number]: Network } = {
  0: Network.ETHEREUM,
  1: Network.AVALANCHE,
  2: Network.OP_MAINNET,
  3: Network.ARBITRUM_ONE,
  6: Network.BASE,
  7: Network.POLYGON_MAINNET,
  10: Network.UNICHAIN,
};

export const DEFAULT_PROXY_TYPE = "TransparentUpgradeableProxy";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const DEFAULT_ADMIN_ROLE = ZERO_BYTES32;
export const ETH = 1000000000000000000n;
export const NATIVE_TOKEN = ZERO_ADDRESS;
