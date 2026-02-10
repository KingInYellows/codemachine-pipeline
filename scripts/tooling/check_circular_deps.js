#!/usr/bin/env node
'use strict';

/**
 * Circular Dependency CI Check (CDMCH-66)
 *
 * Compares current circular dependencies against the baseline using set-based comparison.
 * Fails if NEW cycles are introduced (exit 1). Passes as long as all current cycles
 * are present in the baseline (no new cycles), even if the total count differs.
 */

const { execSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');
const BASELINE_PATH = resolve(ROOT, '.deps', 'cycles-baseline.json');

// Get current cycles
let currentCycles;
try {
  const output = execSync('npm exec -- madge --circular --json --extensions ts src', {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  currentCycles = JSON.parse(output);
} catch (err) {
  // madge exits 1 when cycles are found, but still outputs JSON to stdout
  if (err.stdout) {
    currentCycles = JSON.parse(err.stdout);
  } else {
    console.error('Failed to run madge:', err.message);
    process.exit(2);
  }
}

// Load baseline
let baselineCycles = [];
if (existsSync(BASELINE_PATH)) {
  baselineCycles = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
}

const currentCount = currentCycles.length;
const baselineCount = baselineCycles.length;

// Serialize cycles for comparison
const serialize = (cycle) => [...cycle].sort().join(' > ');
const baselineSet = new Set(baselineCycles.map(serialize));
const newCycles = currentCycles.filter((c) => !baselineSet.has(serialize(c)));

console.log(`Circular dependencies: ${currentCount} found, ${baselineCount} in baseline`);

if (newCycles.length > 0) {
  console.error(`\n✖ ${newCycles.length} NEW circular dependency(ies) introduced:\n`);
  for (const cycle of newCycles) {
    console.error(`  → ${cycle.join(' → ')}`);
  }
  console.error('\nFix the new cycles or update the baseline with: npm run deps:baseline');
  process.exit(1);
}

if (currentCount < baselineCount) {
  console.log(`✔ ${baselineCount - currentCount} cycle(s) resolved! Consider updating the baseline.`);
} else {
  console.log('✔ No new circular dependencies introduced.');
}

process.exit(0);

