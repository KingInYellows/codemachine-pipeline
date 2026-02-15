#!/usr/bin/env node
/* eslint-disable no-console -- CLI script */
/**
 * Validate that CLI command documentation matches oclif.manifest.json
 *
 * This script ensures docs don't drift from actual implementation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Read oclif manifest
const manifestPath = path.join(rootDir, 'oclif.manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ oclif.manifest.json not found');
  console.error('Run: npm run build to generate manifest');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const actualCommands = Object.keys(manifest.commands).sort();

console.log(`📋 Found ${actualCommands.length} commands in oclif.manifest.json`);
console.log(`Commands: ${actualCommands.join(', ')}\n`);

// Read CLI reference documentation
const cliRefPath = path.join(rootDir, 'docs/reference/cli/cli-reference.md');
if (!fs.existsSync(cliRefPath)) {
  console.warn('⚠️  CLI reference not found at docs/reference/cli/cli-reference.md');
  console.log('This is expected if documentation is not yet created.');
  process.exit(0);
}

const cliRefContent = fs.readFileSync(cliRefPath, 'utf-8');

// Check if all commands are documented
let errors = 0;
for (const cmd of actualCommands) {
  // Check if command appears in the documentation
  const cmdPattern = new RegExp(`codepipe\\s+${cmd}\\b`, 'i');
  if (!cmdPattern.test(cliRefContent)) {
    console.error(`❌ Command not found in docs: ${cmd}`);
    errors++;
  }
}

// Check for phantom commands (documented but don't exist)
const docCommandPattern = /codepipe\s+([a-z]+(?:\s[a-z-]+)*)/gi;
const matches = cliRefContent.matchAll(docCommandPattern);
const documentedCommands = new Set();

for (const match of matches) {
  const cmd = match[1];
  if (!cmd.startsWith('-')) {
    // Skip flags
    documentedCommands.add(cmd);
  }
}

for (const cmd of documentedCommands) {
  if (!actualCommands.includes(cmd)) {
    console.error(`❌ Phantom command in docs (not in manifest): ${cmd}`);
    errors++;
  }
}

// Summary
console.log('');
if (errors === 0) {
  console.log('✅ All commands validated successfully');
  console.log(`   ${actualCommands.length} commands documented`);
  console.log(`   0 phantom commands found`);
  process.exit(0);
} else {
  console.error(`❌ Found ${errors} validation errors`);
  console.error('');
  console.error('Fix these errors before merging documentation.');
  process.exit(1);
}
