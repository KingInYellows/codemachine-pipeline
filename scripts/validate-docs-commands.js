#!/usr/bin/env node
/* eslint-disable no-console -- CLI script, not browser code */
'use strict';

/**
 * Validate that CLI command documentation matches oclif.manifest.json
 *
 * This script ensures docs don't drift from actual implementation.
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

// Read oclif manifest
const manifestPath = path.join(rootDir, 'oclif.manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('oclif.manifest.json not found');
  console.error('Run: npm run build to generate manifest');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const actualCommands = Object.keys(manifest.commands).sort();

console.log('Found %d commands in oclif.manifest.json', actualCommands.length);
console.log('Commands: %s\n', actualCommands.join(', '));

// Read CLI reference documentation
const cliRefPath = path.join(rootDir, 'docs/reference/cli/cli-reference.md');
if (!fs.existsSync(cliRefPath)) {
  console.warn('CLI reference not found at docs/reference/cli/cli-reference.md');
  console.log('This is expected if documentation is not yet created.');
  process.exit(0);
}

const cliRefContent = fs.readFileSync(cliRefPath, 'utf-8');

// Normalize colon-separated manifest commands to space-separated (matching docs format).
// oclif manifest uses ":" (e.g. "pr:create") but topicSeparator is " " so docs say "pr create".
const manifestToDisplay = new Map();
for (const cmd of actualCommands) {
  const displayCmd = cmd.replace(/:/g, ' ');
  manifestToDisplay.set(displayCmd, cmd);
}

// Check if all commands are documented
let errors = 0;
for (const [displayCmd] of manifestToDisplay) {
  const escaped = displayCmd.replace(/\s+/g, '\\s+');
  const cmdPattern = new RegExp(`codepipe\\s+${escaped}\\b`, 'i');
  if (!cmdPattern.test(cliRefContent)) {
    console.error('Command not found in docs: %s', displayCmd);
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
    documentedCommands.add(cmd);
  }
}

for (const cmd of documentedCommands) {
  if (!manifestToDisplay.has(cmd)) {
    console.error('Phantom command in docs (not in manifest): %s', cmd);
    errors++;
  }
}

// Summary
console.log('');
if (errors === 0) {
  console.log('All commands validated successfully');
  console.log('   %d commands documented', actualCommands.length);
  console.log('   0 phantom commands found');
  process.exit(0);
} else {
  console.error('Found %d validation errors', errors);
  console.error('');
  console.error('Fix these errors before merging documentation.');
  process.exit(1);
}
