export function assert(condition: boolean, message: string): void {
  if (condition) return;
  throw new Error(message);
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
