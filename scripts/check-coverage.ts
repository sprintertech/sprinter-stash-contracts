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
    lines: linesFound > 0 ? (linesHit / linesFound * 100).toFixed(2) : "0",
    functions: functionsFound > 0 ? (functionsHit / functionsFound * 100).toFixed(2) : "0",
    branches: branchesFound > 0 ? (branchesHit / branchesFound * 100).toFixed(2) : "0",
    statements: linesFound > 0 ? (linesHit / linesFound * 100).toFixed(2) : "0",
  };
}

// Main
const lcovPath = path.join(__dirname, "..", "coverage", "lcov.info");

const baselineArg = process.argv.find(arg => arg.startsWith("--baseline="));
const baselinePath = baselineArg
  ? baselineArg.split("=")[1]
  : path.join(__dirname, "..", "coverage-baseline.json");

const mainBaselineArg = process.argv.find(arg => arg.startsWith("--main-baseline="));
const mainBaselinePath = mainBaselineArg
  ? mainBaselineArg.split("=")[1]
  : path.join(__dirname, "..", "coverage-baseline-main.json");

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

// Load PR baseline
let prBaseline: CoverageData = {
  lines: "0",
  functions: "0",
  branches: "0",
  statements: "0",
};

if (fs.existsSync(baselinePath)) {
  prBaseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as CoverageData;
}

// Load main baseline
let mainBaseline: CoverageData | null = null;
if (fs.existsSync(mainBaselinePath)) {
  mainBaseline = JSON.parse(fs.readFileSync(mainBaselinePath, "utf8")) as CoverageData;
}

// Display comparison
console.log("\n📊 Coverage Comparison:");
console.log("─".repeat(50));
console.log(`Lines:      ${prBaseline.lines}% → ${current.lines}%`);
console.log(`Functions:  ${prBaseline.functions}% → ${current.functions}%`);
console.log(`Branches:   ${prBaseline.branches}% → ${current.branches}%`);
console.log(`Statements: ${prBaseline.statements}% → ${current.statements}%`);
console.log("─".repeat(50));

// Tolerant comparison
function checkDrop(
  metric: keyof CoverageData,
  baseline: CoverageData,
  current: CoverageData,
  label: string
): string | null {
  const base = parseFloat(baseline[metric]);
  const curr = parseFloat(current[metric]);
  const diff = curr - base;

  if (diff < -COVERAGE_TOLERANCE) {
    return `${metric} dropped below ${label}: ${base}% → ${curr}% (Δ ${diff.toFixed(2)}%)`;
  }

  return null;
}

// Check against PR baseline
const prDrops = [
  checkDrop("lines", prBaseline, current, "PR baseline"),
  checkDrop("functions", prBaseline, current, "PR baseline"),
  checkDrop("branches", prBaseline, current, "PR baseline"),
  checkDrop("statements", prBaseline, current, "PR baseline"),
].filter(Boolean) as string[];

// Check against main baseline
const mainDrops: string[] = [];
if (mainBaseline) {
  console.log("\n📊 Coverage vs Main Branch:");
  console.log("─".repeat(50));
  console.log(`Lines:      ${mainBaseline.lines}% → ${current.lines}%`);
  console.log(`Functions:  ${mainBaseline.functions}% → ${current.functions}%`);
  console.log(`Branches:   ${mainBaseline.branches}% → ${current.branches}%`);
  console.log(`Statements: ${mainBaseline.statements}% → ${current.statements}%`);
  console.log("─".repeat(50));

  mainDrops.push(
    ...([
      checkDrop("lines", mainBaseline, current, "main baseline"),
      checkDrop("functions", mainBaseline, current, "main baseline"),
      checkDrop("branches", mainBaseline, current, "main baseline"),
      checkDrop("statements", mainBaseline, current, "main baseline"),
    ].filter(Boolean) as string[])
  );
}

const allDrops = [...prDrops, ...mainDrops];

if (allDrops.length > 0) {
  console.log("\n❌ Coverage decreased beyond tolerance:\n");
  allDrops.forEach(d => console.log(`  • ${d}`));
  console.log(`\n💡 Allowed tolerance: ±${COVERAGE_TOLERANCE}%\n`);
  process.exit(1);
}

console.log(
  `\n✅ Coverage maintained within tolerance (±${COVERAGE_TOLERANCE}%)\n`
);
process.exit(0);
