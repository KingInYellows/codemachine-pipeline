#!/usr/bin/env node
'use strict';

/**
 * CLI Reference Generator (CDMCH-58 / #211)
 *
 * Reads oclif.manifest.json and generates docs/ops/cli-reference.md.
 * The output is fully auto-generated — do not manually edit the target file.
 *
 * Usage:
 *   node scripts/tooling/generate_cli_reference.js          # Generate/overwrite
 *   node scripts/tooling/generate_cli_reference.js --check   # Drift detection (CI)
 */

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');
const MANIFEST_PATH = resolve(ROOT, 'oclif.manifest.json');
const OUTPUT_PATH = resolve(ROOT, 'docs', 'ops', 'cli-reference.md');
const BIN_NAME = 'codepipe';

// ---------------------------------------------------------------------------
// 1. Read and validate manifest
// ---------------------------------------------------------------------------

if (!existsSync(MANIFEST_PATH)) {
  console.error('Error: oclif.manifest.json not found. Run "npm run build" first.');
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch (err) {
  console.error('Error: Failed to parse oclif.manifest.json:', err.message);
  process.exit(2);
}

if (!manifest.commands || typeof manifest.commands !== 'object') {
  console.error('Error: oclif.manifest.json has no "commands" object.');
  process.exit(2);
}

const commands = Object.values(manifest.commands).sort((a, b) =>
  a.id.localeCompare(b.id),
);

// ---------------------------------------------------------------------------
// 2. Group commands by topic
// ---------------------------------------------------------------------------

function groupCommands(cmds) {
  const groups = new Map();
  for (const cmd of cmds) {
    const parts = cmd.id.split(':');
    const topic = parts.length > 1 ? parts[0] : '_top';
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(cmd);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// 3. Markdown rendering helpers
// ---------------------------------------------------------------------------

function resolveExampleForCommand(example, cmd) {
  const displayId = cmd.id.replace(/:/g, ' ');
  return example
    .replace(/<%= config\.bin %>/g, BIN_NAME)
    .replace(/<%= command\.id %>/g, displayId);
}

function renderFlagsTable(flags) {
  const entries = Object.values(flags).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (entries.length === 0) return '';

  const lines = [];
  lines.push('| Option | Short | Type | Description | Default |');
  lines.push('|--------|-------|------|-------------|---------|');

  for (const flag of entries) {
    const name = `\`--${flag.name}\``;
    const short = flag.char ? `\`-${flag.char}\`` : '';
    const type = flag.type === 'boolean' ? 'boolean' : 'string';
    const desc = flag.description || '_No description_';
    const def = flag.default !== undefined ? `\`${flag.default}\`` : '';
    const required = flag.required ? ' **(required)**' : '';
    lines.push(`| ${name} | ${short} | ${type} | ${desc}${required} | ${def} |`);
  }

  return lines.join('\n');
}

function renderArgsTable(args) {
  const entries = Object.values(args).sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''),
  );
  if (entries.length === 0) return '';

  const lines = [];
  lines.push('| Argument | Description | Required | Options |');
  lines.push('|----------|-------------|----------|---------|');

  for (const arg of entries) {
    const name = `\`${arg.name}\``;
    const desc = arg.description || '_No description_';
    const required = arg.required ? 'Yes' : 'No';
    const options = arg.options ? arg.options.map((o) => `\`${o}\``).join(', ') : '';
    lines.push(`| ${name} | ${desc} | ${required} | ${options} |`);
  }

  return lines.join('\n');
}

function renderCommandSection(cmd) {
  const displayId = cmd.id.replace(/:/g, ' ');
  const lines = [];

  lines.push(`#### ${BIN_NAME} ${displayId}`);
  lines.push('');

  // Description
  if (cmd.description) {
    lines.push(cmd.description);
  } else {
    process.stderr.write(`Warning: Command "${cmd.id}" has no description.\n`);
    lines.push('_No description available._');
  }
  lines.push('');

  // Synopsis
  const argNames = Object.values(cmd.args || {})
    .map((a) => (a.required ? a.name.toUpperCase() : `[${a.name.toUpperCase()}]`))
    .join(' ');
  lines.push('##### Synopsis');
  lines.push('');
  lines.push('```bash');
  lines.push(`${BIN_NAME} ${displayId}${argNames ? ' ' + argNames : ''} [FLAGS]`);
  lines.push('```');
  lines.push('');

  // Arguments
  if (cmd.args && Object.keys(cmd.args).length > 0) {
    lines.push('##### Arguments');
    lines.push('');
    lines.push(renderArgsTable(cmd.args));
    lines.push('');
  }

  // Flags
  if (cmd.flags && Object.keys(cmd.flags).length > 0) {
    lines.push('##### Options');
    lines.push('');
    lines.push(renderFlagsTable(cmd.flags));
    lines.push('');
  }

  // Examples
  if (cmd.examples && cmd.examples.length > 0) {
    lines.push('##### Examples');
    lines.push('');
    lines.push('```bash');
    for (const ex of cmd.examples) {
      lines.push(resolveExampleForCommand(ex, cmd));
    }
    lines.push('```');
    lines.push('');
  } else {
    process.stderr.write(`Warning: Command "${cmd.id}" has no examples.\n`);
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 4. Generate full document
// ---------------------------------------------------------------------------

function generateDocument() {
  const groups = groupCommands(commands);
  const lines = [];

  // Header
  lines.push('<!-- AUTO-GENERATED from oclif.manifest.json. Do not edit manually. -->');
  lines.push('<!-- Run: npm run docs:cli to regenerate. -->');
  lines.push('');
  lines.push('# CLI Command Reference');
  lines.push('');
  lines.push(`The \`${BIN_NAME}\` CLI is the primary interface for managing feature development pipelines. This reference is auto-generated from the oclif command manifest.`);
  lines.push('');
  lines.push(`**Total commands:** ${commands.length}`);
  lines.push('');

  // Table of contents
  lines.push('## Table of Contents');
  lines.push('');

  const topicLabels = {
    _top: 'Core Commands',
    context: 'Context Commands',
    pr: 'Pull Request Commands',
    research: 'Research Commands',
    status: 'Status Commands',
  };

  for (const [topic, cmds] of groups) {
    const label = topicLabels[topic] || `${topic.charAt(0).toUpperCase() + topic.slice(1)} Commands`;
    lines.push(`### ${label}`);
    lines.push('');
    for (const cmd of cmds) {
      const displayId = cmd.id.replace(/:/g, ' ');
      const anchor = `${BIN_NAME}-${displayId}`.replace(/\s+/g, '-').toLowerCase();
      const desc = cmd.description ? ` — ${cmd.description}` : '';
      lines.push(`- [\`${BIN_NAME} ${displayId}\`](#${anchor})${desc}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Command sections
  lines.push('## Commands');
  lines.push('');

  for (const [topic, cmds] of groups) {
    const label = topicLabels[topic] || `${topic.charAt(0).toUpperCase() + topic.slice(1)} Commands`;

    lines.push(`### ${label}`);
    lines.push('');

    for (const cmd of cmds) {
      lines.push(renderCommandSection(cmd));
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 5. Main: generate or check
// ---------------------------------------------------------------------------

const markdown = generateDocument();

if (process.argv.includes('--check')) {
  // Drift detection mode
  if (!existsSync(OUTPUT_PATH)) {
    console.error('Drift detected: docs/ops/cli-reference.md does not exist.');
    console.error('Run "npm run docs:cli" and commit the generated file.');
    process.exit(1);
  }

  const committed = readFileSync(OUTPUT_PATH, 'utf8');
  if (committed !== markdown) {
    console.error('Drift detected: docs/ops/cli-reference.md is out of date.');
    console.error('Run "npm run docs:cli" and commit the updated file.');
    process.exit(1);
  }

  console.log('✔ No drift detected in docs/ops/cli-reference.md');
  process.exit(0);
}

// Generate mode
writeFileSync(OUTPUT_PATH, markdown);
console.log(`✔ Generated docs/ops/cli-reference.md (${commands.length} commands)`);
