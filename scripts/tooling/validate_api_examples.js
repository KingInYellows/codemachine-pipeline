#!/usr/bin/env node
'use strict';

/**
 * Validate API reference config examples against the RepoConfig Zod schema.
 *
 * Usage:
 *   node scripts/tooling/validate_api_examples.js          # validate and report
 *   node scripts/tooling/validate_api_examples.js --check   # exit 1 if invalid (CI mode)
 *
 * Validates:
 *   - .codepipe/templates/config.example.json (strip _comment fields, then parse)
 */

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');
const EXAMPLE_CONFIG_PATH = resolve(ROOT, '.codepipe', 'templates', 'config.example.json');

const isCheck = process.argv.includes('--check');

/**
 * Recursively strip keys starting with "_comment" or "_footer" from an object.
 * These are documentation-only fields not part of the Zod schema.
 */
function stripCommentFields(obj) {
  if (Array.isArray(obj)) {
    return obj.map(stripCommentFields);
  }
  if (obj !== null && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('_comment') || key.startsWith('_footer')) continue;
      cleaned[key] = stripCommentFields(value);
    }
    return cleaned;
  }
  return obj;
}

async function main() {
  const errors = [];

  // --- Validate config.example.json ---
  try {
    const raw = readFileSync(EXAMPLE_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const cleaned = stripCommentFields(parsed);

    // Dynamic import the compiled schema
    const distPath = resolve(ROOT, 'dist', 'core', 'config', 'RepoConfig.js');
    try {
      readFileSync(distPath);
    } catch {
      console.error('ERROR: dist/ not built. Run "npm run build" first.');
      process.exit(2);
    }

    const { RepoConfigSchema } = await import(distPath);
    const result = RepoConfigSchema.safeParse(cleaned);

    if (result.success) {
      console.log('OK  config.example.json validates against RepoConfigSchema');
    } else {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      errors.push(`FAIL  config.example.json:\n${issues}`);
    }
  } catch (err) {
    errors.push(`ERROR  config.example.json: ${err.message}`);
  }

  // --- Report ---
  if (errors.length > 0) {
    console.error('\nValidation failures:\n');
    for (const e of errors) {
      console.error(e);
    }
    if (isCheck) {
      process.exit(1);
    }
  } else {
    console.log('\nAll API reference examples valid.');
  }
}

main();
