import {ethers} from "ethers";

const chains = {
  "BASE": process.env.BASE_RPC || "https://base-mainnet.public.blastapi.io",
  "ETHEREUM": process.env.ETHEREUM_RPC || "https://eth-mainnet.public.blastapi.io",
  "ARBITRUM_ONE": process.env.ARBITRUM_ONE_RPC || "https://arbitrum-one.public.blastapi.io",
  "OP_MAINNET": process.env.OP_MAINNET_RPC || "https://public-op-mainnet.fastnode.io",
  "POLYGON_MAINNET": process.env.POLYGON_MAINNET_RPC || "https://polygon-bor-rpc.publicnode.com",
  "AVALANCHE": process.env.AVALANCHE_RPC || "https://avalanche-c-chain-rpc.publicnode.com",
  "BSC": process.env.BSC_RPC || "https://bsc-mainnet.public.blastapi.io",
  "LINEA": process.env.LINEA_RPC || "https://linea-rpc.publicnode.com",
};

async function getBlockNumber(name, url) {
  try {
    const provider = new ethers.JsonRpcProvider(url);
    const blockNumber = await provider.getBlockNumber();
    // Subtract 100 blocks for minimal safety margin (contracts are recent)
    const safeBlock = blockNumber - 100;
    console.log(`FORK_BLOCK_NUMBER_${name}=${safeBlock}`);
    return safeBlock;
  } catch (error) {
    console.error(`# Error fetching ${name}: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log("# Fetching current block numbers...");
  for (const [name, url] of Object.entries(chains)) {
    await getBlockNumber(name, url);
  }
}

main().catch(console.error);
