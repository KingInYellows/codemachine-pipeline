#!/usr/bin/env node

/**
 * install.cjs - Environment setup and dependency installation script
 *
 * This script is the single source of truth for environment setup and dependency installation.
 * It ensures all dependencies are correctly installed/updated and is idempotent.
 *
 * Features:
 * - Cross-platform compatible (Windows, macOS, Linux)
 * - Detects and installs missing dependencies
 * - Safe error handling with appropriate exit codes
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
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
 * Check if a command exists on the system
 */
function commandExists(command) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${cmd} ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the project root directory
 */
function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * Check if package.json exists
 */
function hasPackageJson() {
  const packageJsonPath = path.join(getProjectRoot(), 'package.json');
  return fs.existsSync(packageJsonPath);
}

/**
 * Check if node_modules exists and is not empty
 */
function hasNodeModules() {
  const nodeModulesPath = path.join(getProjectRoot(), 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    return false;
  }

  try {
    const contents = fs.readdirSync(nodeModulesPath);
    return contents.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if dependencies need to be installed/updated
 */
function needsDependencyInstall() {
  // If node_modules doesn't exist or is empty, definitely need install
  if (!hasNodeModules()) {
    return true;
  }

  // Check if package-lock.json is newer than node_modules
  const packageLockPath = path.join(getProjectRoot(), 'package-lock.json');
  const nodeModulesPath = path.join(getProjectRoot(), 'node_modules');

  if (fs.existsSync(packageLockPath)) {
    try {
      const packageLockStat = fs.statSync(packageLockPath);
      const nodeModulesStat = fs.statSync(nodeModulesPath);

      if (packageLockStat.mtime > nodeModulesStat.mtime) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

/**
 * Install npm dependencies
 */
function installDependencies() {
  const projectRoot = getProjectRoot();

  logInfo('Installing/updating dependencies...');

  try {
    // Use npm ci if package-lock.json exists and node_modules is empty/missing (for clean install)
    // Otherwise use npm install to update dependencies
    const packageLockPath = path.join(projectRoot, 'package-lock.json');
    const useCI = fs.existsSync(packageLockPath) && !hasNodeModules();

    const command = useCI ? 'npm ci' : 'npm install';
    logInfo(`Running: ${command}`);

    const result = spawnSync(command, {
      cwd: projectRoot,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env }
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`${command} exited with code ${result.status}`);
    }

    logSuccess('Dependencies installed successfully');
    return true;
  } catch (error) {
    logError(`Failed to install dependencies: ${error.message}`);
    return false;
  }
}

/**
 * Main installation logic
 */
function main() {
  try {
    logInfo('Starting environment setup and dependency installation...');

    // Check if Node.js is available
    if (!commandExists('node')) {
      logError('Node.js is not installed or not in PATH');
      process.exit(1);
    }

    // Check if npm is available
    if (!commandExists('npm')) {
      logError('npm is not installed or not in PATH');
      process.exit(1);
    }

    // Verify we're in a Node.js project
    if (!hasPackageJson()) {
      logError('package.json not found. Are you in the correct directory?');
      process.exit(1);
    }

    // Check Node.js version requirement
    const packageJsonPath = path.join(getProjectRoot(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    if (packageJson.engines && packageJson.engines.node) {
      const requiredVersion = packageJson.engines.node.replace(/[^\d.]/g, '');
      const currentVersion = process.version.replace('v', '');

      logInfo(`Node.js version: ${currentVersion} (required: ${packageJson.engines.node})`);
    }

    // Install/update dependencies if needed
    if (needsDependencyInstall()) {
      if (!installDependencies()) {
        process.exit(1);
      }
    } else {
      logSuccess('Dependencies are up to date');
    }

    logSuccess('Environment setup completed successfully');
    process.exit(0);

  } catch (error) {
    logError(`Unexpected error during installation: ${error.message}`);
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
  installDependencies,
  needsDependencyInstall,
  hasNodeModules,
  getProjectRoot,
  commandExists
};
