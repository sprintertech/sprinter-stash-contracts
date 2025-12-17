#!/usr/bin/env ts-node

import fs from "fs";
import path from "path";

interface CoverageData {
  lines: string;
  functions: string;
  branches: string;
  statements: string;
}

// Allowed coverage drift (percent)
const COVERAGE_TOLERANCE = 0.2;

/**
 * Parses coverage from lcov.info file
 */
function parseLcovCoverage(lcovPath: string): CoverageData {
  const content = fs.readFileSync(lcovPath, "utf8").replace(/\r\n/g, "\n");

  let linesFound = 0;
  let linesHit = 0;
  let functionsFound = 0;
  let functionsHit = 0;
  let branchesFound = 0;
  let branchesHit = 0;

  const lines = content.split("\n");
  for (const line of lines) {
    if (line.startsWith("LF:")) {
      linesFound += parseInt(line.substring(3), 10);
    } else if (line.startsWith("LH:")) {
      linesHit += parseInt(line.substring(3), 10);
    } else if (line.startsWith("BRF:")) {
      branchesFound += parseInt(line.substring(4), 10);
    } else if (line.startsWith("BRH:")) {
      branchesHit += parseInt(line.substring(4), 10);
    } else if (line.startsWith("FNF:")) {
      functionsFound += parseInt(line.substring(4), 10);
    } else if (line.startsWith("FNH:")) {
      functionsHit += parseInt(line.substring(4), 10);
    }
  }

  return {
    lines: linesFound > 0 ? ((linesHit / linesFound) * 100).toFixed(2) : "0",
    functions: functionsFound > 0 ? ((functionsHit / functionsFound) * 100).toFixed(2) : "0",
    branches: branchesFound > 0 ? ((branchesHit / branchesFound) * 100).toFixed(2) : "0",
    statements: linesFound > 0 ? ((linesHit / linesFound) * 100).toFixed(2) : "0",
  };
}

// Main
const lcovPath = path.join(__dirname, "..", "coverage", "lcov.info");

const baselineArg = process.argv.find(arg => arg.startsWith("--baseline="));
const baselinePath = baselineArg
  ? baselineArg.split("=")[1]
  : path.join(__dirname, "..", "coverage-baseline.json");

const isUpdatingBaseline = process.argv.includes("--update-baseline");

if (!fs.existsSync(lcovPath)) {
  console.error("❌ Coverage file not found. Run: npm run coverage");
  process.exit(1);
}

const current = parseLcovCoverage(lcovPath);

// Update baseline mode
if (isUpdatingBaseline) {
  fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2));
  console.log("\n✅ Coverage baseline updated:");
  console.log(`   Lines: ${current.lines}%`);
  console.log(`   Functions: ${current.functions}%`);
  console.log(`   Branches: ${current.branches}%`);
  console.log(`   Statements: ${current.statements}%\n`);
  process.exit(0);
}

// Load baseline
let baseline: CoverageData = {
  lines: "0",
  functions: "0",
  branches: "0",
  statements: "0",
};

if (fs.existsSync(baselinePath)) {
  baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as CoverageData;
}

// Display comparison
console.log("\n📊 Coverage Comparison:");
console.log("─".repeat(50));
console.log(`Lines:      ${baseline.lines}% → ${current.lines}%`);
console.log(`Functions:  ${baseline.functions}% → ${current.functions}%`);
console.log(`Branches:   ${baseline.branches}% → ${current.branches}%`);
console.log(`Statements: ${baseline.statements}% → ${current.statements}%`);
console.log("─".repeat(50));

// Tolerant comparison
function checkDrop(metric: keyof CoverageData): string | null {
  const base = parseFloat(baseline[metric]);
  const curr = parseFloat(current[metric]);
  const diff = curr - base;

  if (diff < -COVERAGE_TOLERANCE) {
    return `${metric} dropped: ${base}% → ${curr}% (Δ ${diff.toFixed(2)}%)`;
  }

  return null;
}

const drops = [
  checkDrop("lines"),
  checkDrop("functions"),
  checkDrop("branches"),
  checkDrop("statements"),
].filter(Boolean) as string[];

if (drops.length > 0) {
  console.log("\n❌ Coverage decreased beyond tolerance:\n");
  drops.forEach(d => console.log(`  • ${d}`));
  console.log(`\n💡 Allowed tolerance: ±${COVERAGE_TOLERANCE}%\n`);
  process.exit(1);
}

console.log(
  `\n✅ Coverage maintained within tolerance (±${COVERAGE_TOLERANCE}%)\n`
);
process.exit(0);
