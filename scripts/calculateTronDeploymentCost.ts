import fs from "fs";
import path from "path";

// Tron mainnet resource estimates for deploying the localtron artifacts:
// Energy required ~= gasUsed (1:1)
// Bandwidth required ~= creation bytecode size (bytes) + per-tx overhead
// Cost (in TRX, if unstaked/burned) = resource amount * price per unit.
const BANDWIDTH_OVERHEAD_PER_DEPLOYMENT = 300;
const ENERGY_PRICE = 0.0001;
const BANDWIDTH_PRICE = 0.001;

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments", "localtron");

interface DeploymentArtifact {
  receipt: {gasUsed: string};
  bytecode: string;
  args: string[];
}

function bytecodeSize(bytecode: string): number {
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  return hex.length / 2;
}

// Constructor args are ABI-encoded as 32-byte words, except dynamic-length args
// (eg. proxy init calldata), which are encoded at their own byte length.
function argsSize(args: string[]): number {
  return args.reduce((total, arg) => total + (arg.length <= 66 ? 32 : arg.length / 2), 0);
}

function main() {
  const files = fs.readdirSync(DEPLOYMENTS_DIR)
    .filter(file =>
      file.endsWith(".json") &&
      !file.endsWith("_Proxy.json") &&
      (!file.endsWith("ProxyAdmin.json") || file == "ProxyAdmin.json")
    );

  let totalGasUsed = 0n;
  let totalBytecodeSize = 0;
  const rows: {Contract: string, GasUsed: string, BytecodeSize: number, ArgsSize: number}[] = [];

  for (const file of files) {
    const artifact: DeploymentArtifact = JSON.parse(
      fs.readFileSync(path.join(DEPLOYMENTS_DIR, file), "utf8")
    );
    const gasUsed = BigInt(artifact.receipt.gasUsed);
    const size = bytecodeSize(artifact.bytecode);
    const argsBytes = argsSize(artifact.args);

    totalGasUsed += gasUsed;
    totalBytecodeSize += size + argsBytes;
    rows.push({
      Contract: path.basename(file, ".json"), GasUsed: gasUsed.toString(), BytecodeSize: size, ArgsSize: argsBytes,
    });
  }

  console.table(rows);

  const totalEnergy = Number(totalGasUsed);
  const totalBandwidth = totalBytecodeSize + rows.length * BANDWIDTH_OVERHEAD_PER_DEPLOYMENT;
  const energyCost = totalEnergy * ENERGY_PRICE;
  const bandwidthCost = totalBandwidth * BANDWIDTH_PRICE;

  console.log(`Total gasUsed: ${totalGasUsed}`);
  console.log(`Total bytecode size: ${totalBytecodeSize} bytes`);
  console.log(`Estimated Energy: ${totalEnergy}`);
  console.log(`Estimated Bandwidth: ${totalBandwidth}`);
  console.log(`Estimated Energy Cost: ${energyCost} TRX`);
  console.log(`Estimated Bandwidth Cost: ${bandwidthCost} TRX`);
}

main();
