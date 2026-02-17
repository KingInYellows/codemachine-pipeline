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
  console.error('CLI reference not found at docs/reference/cli/cli-reference.md');
  console.error('This file is required for command drift detection.');
  process.exit(1);
}

const cliRefContent = fs.readFileSync(cliRefPath, 'utf-8');

// Normalize colon-separated manifest commands to space-separated (matching docs format).
// oclif manifest uses ":" (e.g. "pr:create") but topicSeparator is " " so docs say "pr create".
const manifestDisplayCommands = new Set(
  actualCommands.map((cmd) => cmd.replace(/:/g, ' ').toLowerCase())
);

// Topics are the first word of any multi-word command in the manifest (e.g. "pr" in "pr create").
// Used to avoid misclassifying positional arguments as subcommands.
const manifestTopics = new Set(
  Array.from(manifestDisplayCommands)
    .map((cmd) => cmd.split(/\s+/).filter(Boolean))
    .filter((parts) => parts.length >= 2)
    .map((parts) => parts[0])
);

// Check if all commands are documented
let errors = 0;
for (const cmd of actualCommands) {
  const displayCmd = cmd.replace(/:/g, ' ');
  const escaped = displayCmd.replace(/\s+/g, '\\s+');
  const cmdPattern = new RegExp(`codepipe\\s+${escaped}\\b`, 'i');
  if (!cmdPattern.test(cliRefContent)) {
    console.error('Command not found in docs: %s', displayCmd);
    errors++;
  }
}

// Check for phantom commands (documented but don't exist).
// Parse only tokens that look like command words and stop at flags/arguments.
const docCommandPattern = /codepipe[ \t]+([^\n`]+)/gi;
const matches = cliRefContent.matchAll(docCommandPattern);
const phantomCommands = new Set();

for (const match of matches) {
  const tail = match[1].trim();
  if (!tail) continue;

  const tokens = tail
    .split(/\s+/)
    .map((token) => token.replace(/[`,.;:()]/g, '').toLowerCase())
    .filter(Boolean);

  const commandTokens = [];
  for (const token of tokens) {
    if (
      token.startsWith('-') ||
      token.startsWith('<') ||
      token.startsWith('[') ||
      token.includes('=')
    )
      break;
    if (!/^[a-z][a-z0-9-]*$/.test(token)) break;
    commandTokens.push(token);

    // If the first token isn't a known topic, treat this as non-command prose.
    if (commandTokens.length === 1 && !manifestTopics.has(commandTokens[0])) break;
  }

  if (commandTokens.length === 0) continue;

  // Accept the longest prefix that matches a real CLI command.
  // Also allow single-word topic mentions (e.g., "codepipe pr") without flagging as phantom.
  let matched = false;
  for (let i = commandTokens.length; i >= 1; i--) {
    const candidate = commandTokens.slice(0, i).join(' ');
    if (manifestDisplayCommands.has(candidate)) {
      matched = true;
      break;
    }
    if (i === 1 && manifestTopics.has(candidate)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    phantomCommands.add(commandTokens.join(' '));
  }
}

for (const cmd of phantomCommands) {
  console.error('Phantom command in docs (not in manifest): %s', cmd);
  errors++;
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
