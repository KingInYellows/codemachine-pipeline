#!/usr/bin/env node
/* eslint-disable no-console -- CLI script, not browser code */
'use strict';

/**
 * Test code examples in documentation
 *
 * Extracts bash/shell code blocks from markdown and validates they're safe.
 * Does NOT execute code (security risk), but checks syntax and patterns.
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

console.log('Testing documentation code examples\n');

// Find all markdown files using Node 24 built-in globSync
const markdownFiles = fs.globSync('docs/**/*.md', {
  cwd: rootDir,
  exclude: (name) => name === 'node_modules' || name === 'archive',
}).map((f) => path.join(rootDir, f));

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
  { pattern: /rm\s+-rf\s+\//, message: 'Dangerous rm -rf on root' },
  { pattern: /:\(\)\{\s*:\|:&\s*\};:/, message: 'Fork bomb detected' },
  { pattern: /chmod\s+777/, message: 'Insecure permissions (chmod 777)' },
  { pattern: /curl.*\|\s*bash/, message: 'Pipe to bash (security risk)' },
  { pattern: /eval\s+\$\(/, message: 'Eval with command substitution' },
];

// Credential patterns — skipped when placeholder markers are present
const credentialPatterns = [
  { pattern: /ghp_[A-Za-z0-9]{36}/, message: 'Real GitHub token detected' },
  { pattern: /github_pat_[A-Za-z0-9_]{82}/, message: 'Real GitHub fine-grained token detected' },
  { pattern: /sk-ant-[A-Za-z0-9_-]{48,}/, message: 'Real Anthropic API key detected' },
  { pattern: /sk-(?!ant-)[A-Za-z0-9]{32,}/, message: 'Potential real OpenAI API key detected' },
  { pattern: /lin_api_[A-Za-z0-9]{40}/, message: 'Real Linear API key detected' },
  { pattern: /AKIA[0-9A-Z]{16}/, message: 'Real AWS access key detected' },
];

// Patterns that indicate placeholder/example tokens
const placeholderPatterns = [/EXAMPLE/i, /PLACEHOLDER/i, /DO_NOT_USE/i];

function hasPlaceholderMarker(code) {
  return placeholderPatterns.some((p) => p.test(code));
}

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const relativePath = path.relative(rootDir, file);

  // Extract code blocks (bash, shell, json, javascript)
  // Handles optional metadata after language, trailing spaces, and CRLF
  const codeBlockPattern = /```(bash|shell|json|javascript|js)[^\S\r\n]*\r?\n([\s\S]*?)```/g;
  const matches = content.matchAll(codeBlockPattern);

  for (const match of matches) {
    totalBlocks++;
    const [, lang, code] = match;

    // Check for unsafe patterns in bash/shell blocks
    if (lang === 'bash' || lang === 'shell') {
      // Always check safety patterns (rm -rf, fork bomb, etc.)
      for (const { pattern, message } of safetyPatterns) {
        if (pattern.test(code)) {
          console.error('%s:', relativePath);
          console.error('   %s', message);
          errors++;
        }
      }

      // Check credential patterns only if no placeholder markers
      if (!hasPlaceholderMarker(code)) {
        for (const { pattern, message } of credentialPatterns) {
          if (pattern.test(code)) {
            console.error('%s:', relativePath);
            console.error('   %s', message);
            // Do NOT log the matched code — it may contain the credential
            errors++;
          }
        }
      }
    }

    // Check JSON syntax
    if (lang === 'json') {
      try {
        JSON.parse(code);
      } catch (e) {
        console.error('%s:', relativePath);
        console.error('   Invalid JSON syntax');
        console.error('   Error: %s', e.message);
        errors++;
      }
    }
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
