import * as fs from "fs";
import * as path from "path";
import {networkConfig, NetworkConfig, Provider} from "../network.config";

// Validates risk/scores/*.json against network.config.ts per risk/RISK_FRAMEWORK.md:
// - every Provider used in a non-test Rebalancer/Repayer route has a score entry;
// - every non-test network with an Aave pool has an entry in aave.json;
// - oracles referenced by StashDex configs have entries in oracles.json;
// - riskLevel matches the recomputed sum of dimension scores;
// - Level 4 integrations are not in use unless explicitly excepted.

const SCORES_DIR = path.join(__dirname, "..", "risk", "scores");

const DIMENSIONS = [
  "audits",
  "centralization",
  "valueSecured",
  "longevity",
  "trustModel",
  "oracleDependency",
] as const;

interface ScoreEntry {
  name: string;
  scores: Record<(typeof DIMENSIONS)[number], number | null>;
  riskLevel: number | null;
  comment: string;
  sources: string[];
  status: "draft" | "reviewed";
  reviewers: string[];
  lastReviewed: string;
}

interface ScoreFile {
  exceptions?: Record<string, string>;
  [key: string]: ScoreEntry | Record<string, string> | undefined;
}

const errors: string[] = [];
const warnings: string[] = [];

function loadScoreFile(filename: string): ScoreFile {
  const filePath = path.join(SCORES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing score file: risk/scores/${filename}`);
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function riskLevelFromTotal(total: number): number {
  if (total <= 12) return 1;
  if (total <= 18) return 2;
  if (total <= 24) return 3;
  return 4;
}

// Collects usage from a NetworkConfig and its Stage sub-config, non-test only.
function collectUsage(
  network: string,
  config: NetworkConfig,
  usedProviders: Map<string, Set<string>>,
  aaveNetworks: Set<string>,
  usedOracles: Set<string>,
) {
  if (!config.IsTest) {
    const addProviders = (providers: Provider[]) => {
      for (const provider of providers) {
        if (provider === Provider.LOCAL) continue; // same-chain, no external dependency
        if (!usedProviders.has(provider)) usedProviders.set(provider, new Set());
        usedProviders.get(provider)!.add(network);
      }
    };
    for (const pool of Object.values(config.RebalancerRoutes ?? {})) {
      for (const providers of Object.values(pool)) {
        addProviders(providers ?? []);
      }
    }
    for (const pool of Object.values(config.RepayerRoutes ?? {})) {
      for (const providers of Object.values(pool.Domains)) {
        addProviders(providers ?? []);
      }
    }
    if (config.AavePool || config.AavePoolLongTerm) {
      aaveNetworks.add(network);
      usedOracles.add("AaveOracle");
    }
    if (config.StashDex) {
      usedOracles.add(config.StashDex.Oracle);
    }
  }
  if (config.Stage) {
    collectUsage(network, config.Stage, usedProviders, aaveNetworks, usedOracles);
  }
}

function validateEntry(
  file: string,
  key: string,
  entry: ScoreEntry | undefined,
  exceptions: Record<string, string>,
  usedBy: string,
) {
  if (!entry) {
    errors.push(`${file}: missing entry "${key}" (used by ${usedBy})`);
    return;
  }
  const values: number[] = [];
  for (const dimension of DIMENSIONS) {
    const value = entry.scores?.[dimension];
    if (value === null || value === undefined) {
      if (entry.status === "draft") {
        warnings.push(`${file}: "${key}" has unscored dimension "${dimension}" (draft)`);
      } else {
        errors.push(`${file}: "${key}" is reviewed but dimension "${dimension}" is unscored`);
      }
      return;
    }
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      errors.push(`${file}: "${key}" dimension "${dimension}" must be an integer 1-5, got ${value}`);
      return;
    }
    values.push(value);
  }
  if (!entry.sources || entry.sources.length === 0) {
    errors.push(`${file}: "${key}" has no sources`);
  }
  const total = values.reduce((a, b) => a + b, 0);
  const expectedLevel = riskLevelFromTotal(total);
  if (entry.riskLevel !== expectedLevel) {
    errors.push(
      `${file}: "${key}" riskLevel is ${entry.riskLevel} but scores sum to ${total} => level ${expectedLevel}`,
    );
    return;
  }
  if (expectedLevel >= 4) {
    if (exceptions[key]) {
      warnings.push(`${file}: "${key}" is Level ${expectedLevel} but excepted: ${exceptions[key]}`);
    } else {
      errors.push(
        `${file}: "${key}" is Level ${expectedLevel} and in use (${usedBy}) - ` +
        "forbidden by RISK_FRAMEWORK.md without an \"exceptions\" entry",
      );
    }
  }
  if (entry.status === "draft") {
    warnings.push(`${file}: "${key}" is a draft pending review`);
  }
}

function main() {
  const usedProviders = new Map<string, Set<string>>();
  const aaveNetworks = new Set<string>();
  const usedOracles = new Set<string>();
  for (const [network, config] of Object.entries(networkConfig)) {
    collectUsage(network, config, usedProviders, aaveNetworks, usedOracles);
  }

  const providersFile = loadScoreFile("providers.json");
  const providerExceptions = (providersFile.exceptions ?? {}) as Record<string, string>;
  for (const [provider, networks] of usedProviders) {
    validateEntry(
      "providers.json",
      provider,
      providersFile[provider] as ScoreEntry | undefined,
      providerExceptions,
      `routes on ${[...networks].join(", ")}`,
    );
  }

  const aaveFile = loadScoreFile("aave.json");
  const aaveExceptions = (aaveFile.exceptions ?? {}) as Record<string, string>;
  for (const network of aaveNetworks) {
    validateEntry(
      "aave.json",
      network,
      aaveFile[network] as ScoreEntry | undefined,
      aaveExceptions,
      `Aave pool config on ${network}`,
    );
  }

  const oraclesFile = loadScoreFile("oracles.json");
  const oracleExceptions = (oraclesFile.exceptions ?? {}) as Record<string, string>;
  for (const oracle of usedOracles) {
    validateEntry(
      "oracles.json",
      oracle,
      oraclesFile[oracle] as ScoreEntry | undefined,
      oracleExceptions,
      "StashDex/Aave pool configs",
    );
  }

  for (const warning of warnings) {
    console.warn(`WARN: ${warning}`);
  }
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`ERROR: ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `Risk scores OK: ${usedProviders.size} providers, ${aaveNetworks.size} Aave markets, ` +
    `${usedOracles.size} oracles checked (${warnings.length} warnings).`,
  );
}

main();
