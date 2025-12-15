#!/usr/bin/env node

/**
 * tools/install.cjs
 *
 * Cross-platform dependency installation script for Node.js projects.
 * Ensures all dependencies are installed and up-to-date.
 * This script is idempotent and can be safely re-run.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Determines if npm install is needed by checking package.json modification time
 * against node_modules timestamp
 */
function shouldInstall() {
  const projectRoot = path.join(__dirname, '..');
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  const timestampPath = path.join(nodeModulesPath, '.install-timestamp');

  // If node_modules doesn't exist, we need to install
  if (!fs.existsSync(nodeModulesPath)) {
    return true;
  }

  // If timestamp file doesn't exist, we need to install
  if (!fs.existsSync(timestampPath)) {
    return true;
  }

  try {
    const packageJsonTime = fs.statSync(packageJsonPath).mtime.getTime();
    const timestampContent = fs.readFileSync(timestampPath, 'utf8').trim();
    const lastInstallTime = parseInt(timestampContent, 10);

    // If package.json is newer than last install, we need to install
    if (packageJsonTime > lastInstallTime) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Warning: Error checking installation status:', error.message);
    return true; // Install on error to be safe
  }
}

/**
 * Writes a timestamp file to track when dependencies were last installed
 */
function writeTimestamp() {
  const projectRoot = path.join(__dirname, '..');
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  const timestampPath = path.join(nodeModulesPath, '.install-timestamp');

  try {
    fs.writeFileSync(timestampPath, Date.now().toString(), 'utf8');
  } catch (error) {
    console.error('Warning: Could not write install timestamp:', error.message);
  }
}

/**
 * Main installation logic
 */
function main() {
  const projectRoot = path.join(__dirname, '..');
  const packageJsonPath = path.join(projectRoot, 'package.json');

  // Verify package.json exists
  if (!fs.existsSync(packageJsonPath)) {
    console.error('Error: package.json not found in project root');
    process.exit(1);
  }

  console.log('Checking dependency installation status...');

  if (!shouldInstall()) {
    console.log('Dependencies are up-to-date. Skipping installation.');
    process.exit(0);
  }

  console.log('Installing/updating dependencies...');

  try {
    // Run npm install with proper options
    execSync('npm install', {
      cwd: projectRoot,
      stdio: 'inherit',
      encoding: 'utf8',
      env: {
        ...process.env,
        // Ensure npm uses default settings
        npm_config_progress: 'true'
      }
    });

    // Write timestamp after successful installation
    writeTimestamp();

    console.log('Dependencies installed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error: Failed to install dependencies');
    console.error(error.message);
    process.exit(1);
  }
}

// Execute main function
main();
