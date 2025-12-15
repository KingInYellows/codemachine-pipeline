#!/usr/bin/env node

/**
 * tools/test.cjs
 *
 * Cross-platform test execution script.
 * Ensures dependencies are installed, then runs the project test suite using Jest.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Executes install script to ensure dependencies are ready
 */
function ensureDependencies() {
  console.log('Ensuring dependencies are installed...');
  try {
    execSync('node tools/install.cjs', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      encoding: 'utf8'
    });
  } catch (error) {
    console.error('Error: Failed to install dependencies');
    process.exit(1);
  }
}

/**
 * Checks if Jest is available
 */
function isJestAvailable() {
  const projectRoot = path.join(__dirname, '..');
  const jestPath = path.join(projectRoot, 'node_modules', '.bin', 'jest');
  const jestCmdPath = path.join(projectRoot, 'node_modules', '.bin', 'jest.cmd');

  // Check for both Unix and Windows executables
  return fs.existsSync(jestPath) || fs.existsSync(jestCmdPath);
}

/**
 * Runs the test suite
 */
function runTests() {
  const projectRoot = path.join(__dirname, '..');

  console.log('Running tests...');
  console.log('---');

  try {
    // Get any additional arguments passed to the script
    const args = process.argv.slice(2);

    // Run npm test with any additional arguments
    const command = args.length > 0 ? `npm test -- ${args.join(' ')}` : 'npm test';

    execSync(command, {
      cwd: projectRoot,
      stdio: 'inherit',
      encoding: 'utf8'
    });

    console.log('---');
    console.log('Tests completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('---');
    console.error('Error: Tests failed');
    process.exit(1);
  }
}

/**
 * Main execution logic
 */
function main() {
  // Step 1: Ensure dependencies are installed
  ensureDependencies();

  // Step 2: Verify Jest is available
  if (!isJestAvailable()) {
    console.error('Error: Jest not found after dependency installation');
    console.error('Please check package.json and node_modules');
    process.exit(1);
  }

  // Step 3: Run tests
  runTests();
}

// Execute main function
main();
