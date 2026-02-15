#!/usr/bin/env node
/**
 * Test code examples in documentation
 *
 * Extracts bash/shell code blocks from markdown and validates they're safe.
 * Does NOT execute code (security risk), but checks syntax and patterns.
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

console.log('🧪 Testing documentation code examples\n');

// Find all markdown files
const markdownFiles = glob.sync('docs/**/*.md', {
  cwd: rootDir,
  absolute: true,
  ignore: ['**/node_modules/**', '**/archive/**'],
});

console.log(`📄 Found ${markdownFiles.length} markdown files\n`);

let totalBlocks = 0;
let errors = 0;
const unsafePatterns = [
  { pattern: /rm\s+-rf\s+\//, message: 'Dangerous rm -rf on root' },
  { pattern: /:\(\)\{\s*:\|\:&\s*\};:/, message: 'Fork bomb detected' },
  { pattern: /chmod\s+777/, message: 'Insecure permissions (chmod 777)' },
  { pattern: /curl.*\|\s*bash/, message: 'Pipe to bash (security risk)' },
  { pattern: /eval\s+\$\(/, message: 'Eval with command substitution' },
  {
    pattern: /(ghp_[A-Za-z0-9]{36}|sk-ant-[A-Za-z0-9]{48}|lin_api_[A-Za-z0-9]{40})/,
    message: 'Real API token detected',
  },
];

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const relativePath = path.relative(rootDir, file);

  // Extract code blocks (bash, shell, json, javascript)
  const codeBlockPattern = /```(bash|shell|json|javascript|js)\n([\s\S]*?)```/g;
  const matches = content.matchAll(codeBlockPattern);

  for (const match of matches) {
    totalBlocks++;
    const [, lang, code] = match;

    // Check for unsafe patterns in bash/shell blocks
    if (lang === 'bash' || lang === 'shell') {
      for (const { pattern, message } of unsafePatterns) {
        if (pattern.test(code)) {
          console.error(`❌ ${relativePath}:`);
          console.error(`   ${message}`);
          console.error(`   Code: ${code.split('\n')[0].substring(0, 80)}...`);
          errors++;
        }
      }
    }

    // Check JSON syntax
    if (lang === 'json') {
      try {
        JSON.parse(code);
      } catch (e) {
        console.error(`❌ ${relativePath}:`);
        console.error(`   Invalid JSON syntax`);
        console.error(`   Error: ${e.message}`);
        errors++;
      }
    }
  }
}

// Summary
console.log('');
console.log(`📊 Summary:`);
console.log(`   ${totalBlocks} code blocks checked`);
console.log(`   ${markdownFiles.length} files scanned`);

if (errors === 0) {
  console.log('');
  console.log('✅ All code examples passed validation');
  process.exit(0);
} else {
  console.log('');
  console.error(`❌ Found ${errors} issues in code examples`);
  console.error('Fix these before merging.');
  process.exit(1);
}
