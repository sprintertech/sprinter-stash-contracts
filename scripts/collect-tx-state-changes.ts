import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import {promises as fs} from "fs";
import * as path from "path";

interface StorageChange {
  address: string;
  slots: { slot: string; from: string; to: string }[];
}

interface TxResult {
  txHash: string;
  networkId: string;
  status: boolean;
  stateChanges: StorageChange[];
  error?: string;
}

async function fetchTxStateChanges(txHash: string, networkId: string): Promise<TxResult> {
  const {TENDERLY_ACCESS_KEY, TENDERLY_PROJECT, TENDERLY_ACCOUNT} = process.env;
  if (!TENDERLY_ACCESS_KEY || !TENDERLY_PROJECT || !TENDERLY_ACCOUNT) {
    throw new Error("Missing TENDERLY_ACCESS_KEY, TENDERLY_PROJECT, or TENDERLY_ACCOUNT");
  }

  const url = `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT}/project/` +
    `${TENDERLY_PROJECT}/network/${networkId}/trace/${txHash}`;

  try {
    const {data} = await axios.get(url, {
      headers: {"X-Access-Key": TENDERLY_ACCESS_KEY},
    });

    const callTrace = data.call_trace;
    const status = !(callTrace?.error || callTrace?.error_reason);

    const stateChanges: StorageChange[] = (data.state_diff || [])
      .filter((d: any) => d.raw?.length > 0)
      .map((d: any) => ({
        address: d.address,
        slots: d.raw.map((r: any) => ({slot: r.key, from: r.original, to: r.dirty})),
      }));

    return {txHash, networkId, status, stateChanges};
  } catch (error: any) {
    return {txHash, networkId, status: false, stateChanges: [], error: error.message};
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npx ts-node scripts/collect-tx-state-changes.ts --file <path> | <txHash:networkId> ...");
    process.exit(1);
  }

  let transactions: { txHash: string; networkId: string }[] = [];
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") {
      transactions = JSON.parse(await fs.readFile(args[++i], "utf8"));
    } else if (args[i] === "--output") {
      outputPath = args[++i];
    } else if (args[i].includes(":")) {
      const [txHash, networkId] = args[i].split(":");
      transactions.push({txHash, networkId});
    }
  }

  if (!transactions.length) {
    console.error("No transactions provided");
    process.exit(1);
  }

  console.log(`\nCollecting state changes for ${transactions.length} transaction(s)...\n`);

  const results: TxResult[] = [];
  for (const tx of transactions) {
    console.log(`Fetching ${tx.txHash}...`);
    const result = await fetchTxStateChanges(tx.txHash, tx.networkId);
    results.push(result);
    const statusMsg = result.status ? "Success" : "Failed";
    const msg = result.error ? `Error: ${result.error}` : `${statusMsg}, ${result.stateChanges.length} addresses`;
    console.log(`  ${msg}`);
  }

  // Aggregate storage changes by address
  const aggregated = new Map<string, StorageChange>();
  for (const r of results) {
    for (const c of r.stateChanges) {
      const addr = c.address.toLowerCase();
      if (!aggregated.has(addr)) {
        aggregated.set(addr, {address: c.address, slots: []});
      }
      const existing = aggregated.get(addr)!;
      for (const s of c.slots) {
        const idx = existing.slots.findIndex((x) => x.slot === s.slot);
        if (idx >= 0) existing.slots[idx].to = s.to;
        else existing.slots.push({...s});
      }
    }
  }

  const output = {transactions: results, aggregatedStateChanges: Array.from(aggregated.values())};

  if (!outputPath) {
    const dir = path.join(process.cwd(), "./scripts/results/tx-state-changes");
    await fs.mkdir(dir, {recursive: true});
    outputPath = path.join(dir, `tx-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  }
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outputPath}`);

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Successful: ${results.filter((t) => t.status).length}/${results.length}`);
  console.log(`Addresses with changes: ${aggregated.size}`);

  for (const [, change] of aggregated) {
    console.log(`\n${change.address}: ${change.slots.length} slot(s)`);
    for (const s of change.slots.slice(0, 5)) {
      console.log(`  ${s.slot}: ${s.from} -> ${s.to}`);
    }
    if (change.slots.length > 5) console.log(`  ... +${change.slots.length - 5} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
