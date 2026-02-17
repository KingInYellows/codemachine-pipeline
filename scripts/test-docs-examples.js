#!/usr/bin/env node
/* eslint-disable no-console -- CLI script, not browser code */
'use strict';

/**
 * Test code examples in documentation
 *
 * Extracts common code blocks from markdown and validates they're safe.
 * Does NOT execute code (security risk), but checks syntax and patterns.
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

console.log('Testing documentation code examples\n');

const isExcludedMarkdownPath = (entry) =>
  /(^|\/)node_modules\//.test(entry) ||
  /(^|\/)archive\//.test(entry) ||
  /(^|\/)research\//.test(entry) ||
  /(^|\/)solutions\//.test(entry) ||
  /(^|\/)plans\//.test(entry) ||
  /(^|\/)brainstorms\//.test(entry);

// Find all markdown files using Node 24 built-in globSync.
// Filter exclusions in userland to avoid relying on Node's glob `exclude` option semantics.
const markdownFiles = fs
  .globSync('docs/**/*.md', { cwd: rootDir })
  .filter((entry) => !isExcludedMarkdownPath(entry))
  .map((f) => path.join(rootDir, f));

// Also scan README.md at root
const readmePath = path.join(rootDir, 'README.md');
if (fs.existsSync(readmePath)) {
  markdownFiles.push(readmePath);
}

console.log('Found %d markdown files\n', markdownFiles.length);

let totalBlocks = 0;
let errors = 0;

// Safety patterns — always checked, even in placeholder blocks
const safetyPatterns = [
  { pattern: /\brm\s+-rf\s+\/(\*|[\s;]|$)/, message: 'Dangerous rm -rf on root' },
  { pattern: /:\(\)\{\s*:\|:&\s*\};:/, message: 'Fork bomb detected' },
  { pattern: /chmod\s+777/, message: 'Insecure permissions (chmod 777)' },
  { pattern: /\b(curl|wget)[\s\S]*\|\s*bash/, message: 'Pipe to bash (security risk)' },
  { pattern: /eval\s+\$\(/, message: 'Eval with command substitution' },
];

// Credential patterns — skipped when placeholder markers are present
const credentialPatterns = [
  { pattern: /ghp_[A-Za-z0-9]{36}/, message: 'Real GitHub token detected' },
  { pattern: /github_pat_[A-Za-z0-9_]{82}/, message: 'Real GitHub fine-grained token detected' },
  { pattern: /sk-ant-[A-Za-z0-9_-]{48,}/, message: 'Real Anthropic API key detected' },
  { pattern: /sk-(proj|svcacct)-[A-Za-z0-9_-]{32,}/, message: 'Real OpenAI API key detected' },
  { pattern: /sk-(?!ant-)[A-Za-z0-9]{48}/, message: 'Real OpenAI API key detected' },
  { pattern: /lin_api_[A-Za-z0-9]{40}/, message: 'Real Linear API key detected' },
  { pattern: /(AKIA|ASIA)[0-9A-Z]{16}/, message: 'Real AWS access key detected' },
];

// Patterns that indicate placeholder/example tokens
const placeholderPatterns = [
  /EXAMPLE/i,
  /PLACEHOLDER/i,
  /DO_NOT_USE/i,
  /ghp_[xX]{8,}/,
  /github_pat_[xX_]{16,}/,
];

function hasPlaceholderMarker(code) {
  return placeholderPatterns.some((p) => p.test(code));
}

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const relativePath = path.relative(rootDir, file);

  // Extract fenced code blocks (language tag may be anything, or omitted).
  // Handles optional metadata after language, trailing spaces, and CRLF.
  const codeBlockPattern = /```[^\S\r\n]*[^\r\n]*\r?\n([\s\S]*?)```/g;
  const matches = content.matchAll(codeBlockPattern);

  for (const match of matches) {
    totalBlocks++;
    const [, code] = match;

    const normalizedCode = code.replace(/\r\n?/g, '\n');

    // Always check safety patterns (rm -rf, fork bomb, etc.); a block's language tag can be wrong.
    for (const { pattern, message } of safetyPatterns) {
      if (pattern.test(normalizedCode)) {
        console.error('%s:', relativePath);
        console.error('   %s', message);
        errors++;
      }
    }

    // Check credential patterns per-line (placeholder markers only exempt the line they appear on,
    // not the entire block — prevents a placeholder on one line from hiding a real key on another)
    const lines = normalizedCode.split('\n');
    for (const line of lines) {
      if (hasPlaceholderMarker(line)) continue;
      for (const { pattern, message } of credentialPatterns) {
        if (pattern.test(line)) {
          console.error('%s:', relativePath);
          console.error('   %s', message);
          // Do NOT log the matched line — it may contain the credential
          errors++;
        }
      }
    }

    // Intentionally skip strict JSON parsing: docs frequently include JSONC-style comments,
    // trailing commas, or partial snippets for explanation.
  }
}

// Summary
console.log('');
console.log('Summary:');
console.log('   %d code blocks checked', totalBlocks);
console.log('   %d files scanned', markdownFiles.length);

if (errors === 0) {
  console.log('');
  console.log('All code examples passed validation');
  process.exit(0);
} else {
  console.log('');
  console.error('Found %d issues in code examples', errors);
  console.error('Fix these before merging.');
  process.exit(1);
}
