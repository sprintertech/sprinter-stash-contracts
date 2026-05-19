import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager, isAddress} from "ethers";
import {readFileSync} from "fs";
import {join} from "path";
import {DEFAULT_ADMIN_ROLE} from "./common";
import {toBytes32} from "../test/helpers";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require("js-yaml") as {load: (s: string) => unknown};

const WITHDRAW_PROFIT_ROLE    = toBytes32("WITHDRAW_PROFIT_ROLE");
const PAUSER_ROLE             = toBytes32("PAUSER_ROLE");
const REBALANCER_ROLE         = toBytes32("REBALANCER_ROLE");
const SET_TOKENS_ROLE         = toBytes32("SET_TOKENS_ROLE");
const REPAYER_ROLE            = toBytes32("REPAYER_ROLE");
const BORROW_LONG_TERM_ROLE   = toBytes32("BORROW_LONG_TERM_ROLE");
const FEE_SETTER_ROLE         = toBytes32("FEE_SETTER_ROLE");
const ASSETS_ADJUST_ROLE      = toBytes32("ASSETS_ADJUST_ROLE");
const DEPOSIT_PROFIT_ROLE     = toBytes32("DEPOSIT_PROFIT_ROLE");
const SET_ASSETS_LIMIT_ROLE   = toBytes32("SET_ASSETS_LIMIT_ROLE");

function getRoles(name: string): {roleName: string; role: string}[] {
  if (name.startsWith("LiquidityPoolAaveUSDCLongTerm")) {
    return [
      {roleName: "DEFAULT_ADMIN_ROLE",    role: DEFAULT_ADMIN_ROLE},
      {roleName: "WITHDRAW_PROFIT_ROLE",  role: WITHDRAW_PROFIT_ROLE},
      {roleName: "PAUSER_ROLE",           role: PAUSER_ROLE},
      {roleName: "REPAYER_ROLE",          role: REPAYER_ROLE},
      {roleName: "BORROW_LONG_TERM_ROLE", role: BORROW_LONG_TERM_ROLE},
    ];
  }
  if (name.startsWith("LiquidityPoolPublicUSDC")) {
    return [
      {roleName: "DEFAULT_ADMIN_ROLE",   role: DEFAULT_ADMIN_ROLE},
      {roleName: "WITHDRAW_PROFIT_ROLE", role: WITHDRAW_PROFIT_ROLE},
      {roleName: "PAUSER_ROLE",          role: PAUSER_ROLE},
      {roleName: "FEE_SETTER_ROLE",      role: FEE_SETTER_ROLE},
    ];
  }
  if (name.startsWith("LiquidityPool") || name.startsWith("ERC4626Adapter")) {
    return [
      {roleName: "DEFAULT_ADMIN_ROLE",   role: DEFAULT_ADMIN_ROLE},
      {roleName: "WITHDRAW_PROFIT_ROLE", role: WITHDRAW_PROFIT_ROLE},
      {roleName: "PAUSER_ROLE",          role: PAUSER_ROLE},
    ];
  }
  if (name === "LiquidityHub") {
    return [
      {roleName: "DEFAULT_ADMIN_ROLE",    role: DEFAULT_ADMIN_ROLE},
      {roleName: "ASSETS_ADJUST_ROLE",    role: ASSETS_ADJUST_ROLE},
      {roleName: "DEPOSIT_PROFIT_ROLE",   role: DEPOSIT_PROFIT_ROLE},
      {roleName: "SET_ASSETS_LIMIT_ROLE", role: SET_ASSETS_LIMIT_ROLE},
    ];
  }
  if (name === "Rebalancer") {
    return [
      {roleName: "DEFAULT_ADMIN_ROLE", role: DEFAULT_ADMIN_ROLE},
      {roleName: "REBALANCER_ROLE",    role: REBALANCER_ROLE},
    ];
  }
  if (name.startsWith("Repayer")) {
    return [
      {roleName: "DEFAULT_ADMIN_ROLE", role: DEFAULT_ADMIN_ROLE},
      {roleName: "SET_TOKENS_ROLE",    role: SET_TOKENS_ROLE},
    ];
  }
  if (name.startsWith("Processor")) {
    // CALLER_ROLE is held by RepayerCaller (0xc1d6EEa5...), not the admin EOA.
    return [
      {roleName: "DEFAULT_ADMIN_ROLE", role: DEFAULT_ADMIN_ROLE},
    ];
  }
  return [];
}

export async function main() {
  const forkSimulation = hre.network.name === "hardhat";

  const [signer] = await hre.ethers.getSigners();
  const oldAdmin = await signer.getAddress();

  const yamlPath = join(__dirname, "..", "deployments", "deployments.staging.yml");
  const deployments = yaml.load(readFileSync(yamlPath, "utf8")) as Record<string, Record<string, string>>;

  const chainId = (hre.network.config as {chainId?: number}).chainId;
  const networkKey = `eip155:${chainId}`;
  const networkDeployments = deployments[networkKey];
  if (!networkDeployments) {
    throw new Error(`No staging deployments found for chainId ${chainId} (key: ${networkKey})`);
  }

  console.log(`\nNetwork: ${networkDeployments.name} (chainId: ${chainId})`);
  console.log(`Renounce from: ${oldAdmin}`);
  if (forkSimulation) console.log("[FORK SIMULATION] Transactions execute on fork — no mainnet state will change.");

  const roleOps: {contractName: string; address: string; roleName: string; role: string}[] = [];

  for (const [name, address] of Object.entries(networkDeployments)) {
    if (!isAddress(address)) continue;
    const roles = getRoles(name);
    if (roles.length === 0) continue;
    for (const r of roles) {
      roleOps.push({contractName: name, address, roleName: r.roleName, role: r.role});
    }
  }

  console.log("Role renounce operations:");
  console.table(roleOps.map(op => ({
    contract:     op.contractName,
    address:      op.address,
    role:         op.roleName,
    renounceFrom: oldAdmin,
  })));

  const signerWithNonce = new NonceManager(signer);
  const skipped: string[] = [];

  for (const op of roleOps) {
    const contract = await hre.ethers.getContractAt("AccessControl", op.address, signerWithNonce);
    const holdsRole = await contract.hasRole(op.role, oldAdmin);
    if (!holdsRole) {
      console.warn(`  [SKIPPED] ${op.contractName}: does not hold ${op.roleName}`);
      skipped.push(`${op.contractName}.${op.roleName}`);
      continue;
    }
    const gasEstimate = await contract.renounceRole.estimateGas(op.role, oldAdmin);
    const tx = await contract.renounceRole(op.role, oldAdmin, {gasLimit: gasEstimate * 150n / 100n});
    await tx.wait();
    console.log(`Renounced ${op.roleName} from ${oldAdmin} on ${op.contractName} (${op.address})`);
  }

  if (skipped.length > 0) {
    console.warn(`\n[WARNING] ${skipped.length} operation(s) skipped (signer lacked permission):`);
    skipped.forEach(s => console.warn(`  - ${s}`));
  }
  console.log("\nAll role renouncements complete.");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
