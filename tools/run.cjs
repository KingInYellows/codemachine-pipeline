#!/usr/bin/env node

/**
 * tools/run.cjs
 *
 * Cross-platform project execution script.
 * Ensures dependencies are installed, builds the project, and runs the main application.
 */

const { execSync, spawnSync } = require('child_process');
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
 * Builds the TypeScript project
 */
function buildProject() {
  const projectRoot = path.join(__dirname, '..');
  const distPath = path.join(projectRoot, 'dist');

  console.log('Building TypeScript project...');
  try {
    execSync('npm run build', {
      cwd: projectRoot,
      stdio: 'inherit',
      encoding: 'utf8'
    });
    console.log('Build completed successfully.');
  } catch (error) {
    console.error('Error: Build failed');
    process.exit(1);
  }
}

/**
 * Runs the main application
 */
function runApplication() {
  const projectRoot = path.join(__dirname, '..');
  const binScript = path.join(projectRoot, 'bin', 'run.js');

  console.log('Starting application...');
  console.log('---');

  // Check if bin/run.js exists
  if (!fs.existsSync(binScript)) {
    console.error('Error: Main entry point not found at bin/run.js');
    console.error('Please ensure the project is built correctly.');
    process.exit(1);
  }

  try {
    // Run the bin script with all arguments passed to this script
    const args = process.argv.slice(2);
    const result = spawnSync('node', [binScript, ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
      encoding: 'utf8'
    });

    // Exit with the same code as the application
    process.exit(result.status || 0);
  } catch (error) {
    console.error('Error: Failed to run application');
    console.error(error.message);
    process.exit(1);
  }
}

/**
 * Main execution logic
 */
function main() {
  // Step 1: Ensure dependencies are installed
  ensureDependencies();

  // Step 2: Build the project
  buildProject();

  // Step 3: Run the application
  runApplication();
}

// Execute main function
main();
