#!/usr/bin/env node

/**
 * test.cjs - Project testing script
 *
 * This script ensures the environment is set up correctly and runs the project tests.
 *
 * Features:
 * - Runs install.cjs to ensure dependencies are up to date
 * - Executes the project's test suite
 * - Cross-platform compatible (Windows, macOS, Linux)
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logError(message) {
  console.error(`${colors.red}ERROR: ${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logInfo(message) {
  log(`ℹ ${message}`, colors.blue);
}

/**
 * Get the project root directory
 */
function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * Run the install script to ensure dependencies are ready
 */
function ensureEnvironment() {
  logInfo('Ensuring environment is set up correctly...');

  const installScript = path.join(__dirname, 'install.cjs');

  try {
    const result = spawnSync('node', [installScript], {
      stdio: 'inherit',
      shell: false,
      env: { ...process.env }
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`install.cjs exited with code ${result.status}`);
    }

    return true;
  } catch (error) {
    logError(`Failed to run install script: ${error.message}`);
    return false;
  }
}

/**
 * Get the test command from package.json
 */
function getTestCommand() {
  const projectRoot = getProjectRoot();
  const packageJsonPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found');
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  // Check for test script in package.json
  if (packageJson.scripts && packageJson.scripts.test) {
    return { type: 'npm-script', command: 'test' };
  }

  // Check if jest is installed and has a config
  const jestConfigExists =
    fs.existsSync(path.join(projectRoot, 'jest.config.js')) ||
    fs.existsSync(path.join(projectRoot, 'jest.config.ts')) ||
    fs.existsSync(path.join(projectRoot, 'jest.config.json')) ||
    (packageJson.jest !== undefined);

  if (jestConfigExists) {
    return { type: 'jest' };
  }

  throw new Error('No test configuration found (no test script in package.json or Jest config)');
}

/**
 * Run the project tests
 */
function runTests() {
  try {
    const testConfig = getTestCommand();
    const projectRoot = getProjectRoot();

    let command, args;

    if (testConfig.type === 'npm-script') {
      logInfo('Running npm test script');
      command = 'npm';
      args = ['test'];
    } else if (testConfig.type === 'jest') {
      logInfo('Running Jest tests directly');
      const jestBin = process.platform === 'win32' ? 'jest.cmd' : 'jest';
      command = path.join(projectRoot, 'node_modules', '.bin', jestBin);
      args = [];
    }

    // Pass through any additional arguments
    const additionalArgs = process.argv.slice(2);
    if (additionalArgs.length > 0) {
      if (testConfig.type === 'npm-script') {
        args.push('--');
      }
      args.push(...additionalArgs);
    }

    const result = spawnSync(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        // Ensure tests run in test mode
        NODE_ENV: 'test'
      }
    });

    if (result.error) {
      throw result.error;
    }

    return result.status || 0;

  } catch (error) {
    logError(`Failed to run tests: ${error.message}`);
    return 1;
  }
}

/**
 * Main execution logic
 */
function main() {
  try {
    logInfo('Starting test execution...');

    // Ensure environment and dependencies are ready
    if (!ensureEnvironment()) {
      process.exit(1);
    }

    // Run the tests
    const exitCode = runTests();

    if (exitCode === 0) {
      logSuccess('All tests passed');
    } else {
      logError(`Tests failed with exit code ${exitCode}`);
    }

    process.exit(exitCode);

  } catch (error) {
    logError(`Unexpected error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main();
}

module.exports = {
  runTests,
  getTestCommand,
  ensureEnvironment
};
