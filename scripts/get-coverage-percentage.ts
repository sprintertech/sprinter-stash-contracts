#!/usr/bin/env ts-node

import fs from "fs";
import path from "path";

/**
 * Extracts line coverage percentage from lcov.info
 * Outputs just the percentage number (e.g., "96.03")
 */

const lcovPath = path.join(__dirname, "..", "coverage", "lcov.info");

// Check if file exists
if (!fs.existsSync(lcovPath)) {
  console.error("Error: coverage/lcov.info not found");
  process.exit(1);
}

// Read and parse lcov file
const content = fs.readFileSync(lcovPath, "utf8");
const lines = content.split("\n");

let linesFound = 0;
let linesHit = 0;

for (const line of lines) {
  if (line.startsWith("LF:")) {
    linesFound += parseInt(line.substring(3), 10);
  } else if (line.startsWith("LH:")) {
    linesHit += parseInt(line.substring(3), 10);
  }
}

// Calculate percentage
const percentage = linesFound > 0 ? (linesHit / linesFound * 100).toFixed(2) : "0";

// Output only the percentage (no extra text)
console.log(percentage);
