#!/usr/bin/env node

/**
 * lint.cjs - Code linting script with JSON output
 *
 * This script lints the project source code and outputs results in JSON format.
 *
 * Features:
 * - Ensures dependencies (including linting tools) are installed
 * - Runs ESLint on TypeScript source files
 * - Outputs results exclusively in JSON format to stdout
 * - Cross-platform compatible (Windows, macOS, Linux)
 * - Exits with 0 if no errors, non-zero if errors found
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Get the project root directory
 */
function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * Ensure environment is set up (run install.cjs silently)
 */
function ensureEnvironment() {
  const installScript = path.join(__dirname, 'install.cjs');

  try {
    const result = spawnSync('node', [installScript], {
      stdio: 'ignore', // Suppress all output from install
      shell: false,
      env: { ...process.env }
    });

    if (result.error || result.status !== 0) {
      console.error('Failed to set up environment');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to run install script');
    return false;
  }
}

/**
 * Check if ESLint is available
 */
function hasESLint() {
  const projectRoot = getProjectRoot();
  const eslintBinPath = path.join(projectRoot, 'node_modules', '.bin', 'eslint');
  const eslintBinPathCmd = process.platform === 'win32' ? `${eslintBinPath}.cmd` : eslintBinPath;

  return fs.existsSync(eslintBinPathCmd) || fs.existsSync(eslintBinPath);
}

/**
 * Get ESLint executable path
 */
function getESLintPath() {
  const projectRoot = getProjectRoot();
  const binName = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
  return path.join(projectRoot, 'node_modules', '.bin', binName);
}

/**
 * Parse ESLint JSON output and transform to required format
 */
function transformESLintOutput(eslintResults) {
  const errors = [];

  try {
    const results = JSON.parse(eslintResults);

    for (const file of results) {
      if (file.messages && file.messages.length > 0) {
        for (const msg of file.messages) {
          // Only include errors and warnings (severity 1 = warning, 2 = error)
          if (msg.severity >= 1) {
            errors.push({
              type: msg.severity === 2 ? 'error' : 'warning',
              path: file.filePath,
              obj: msg.ruleId || 'unknown',
              message: msg.message,
              line: msg.line ? String(msg.line) : '0',
              column: msg.column ? String(msg.column) : '0'
            });
          }
        }
      }
    }
  } catch (parseError) {
    console.error('Failed to parse ESLint output');
    return null;
  }

  return errors;
}

/**
 * Run ESLint and return results
 */
function runLint() {
  const projectRoot = getProjectRoot();

  if (!hasESLint()) {
    console.error('ESLint not found. Run install first.');
    return null;
  }

  const eslintPath = getESLintPath();

  // Run ESLint with JSON format output
  // Target TypeScript files in src directory (based on package.json lint script)
  const args = [
    '.',
    '--ext', '.ts',
    '--format', 'json',
    '--no-color'
  ];

  const result = spawnSync(eslintPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env }
  });

  // ESLint exits with 0 if no errors, 1 if errors found, 2 if fatal error
  if (result.error) {
    console.error('Failed to execute ESLint');
    return null;
  }

  // result.status === 2 means ESLint encountered a fatal error
  if (result.status === 2) {
    console.error('ESLint encountered a fatal error');
    return null;
  }

  // Parse and transform the output
  const transformed = transformESLintOutput(result.stdout);

  if (transformed === null) {
    return null;
  }

  return {
    errors: transformed,
    hasErrors: result.status !== 0
  };
}

/**
 * Main linting logic
 */
function main() {
  try {
    // Ensure environment is set up (silently)
    if (!ensureEnvironment()) {
      process.exit(1);
    }

    // Run linting
    const lintResults = runLint();

    if (lintResults === null) {
      process.exit(1);
    }

    // Output JSON to stdout
    console.log(JSON.stringify(lintResults.errors, null, 2));

    // Exit with appropriate code
    // 0 if no errors, 1 if errors found
    process.exit(lintResults.hasErrors ? 1 : 0);

  } catch (error) {
    console.error('Unexpected error during linting');
    process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main();
}

module.exports = {
  runLint,
  transformESLintOutput,
  hasESLint
};
