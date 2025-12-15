#!/usr/bin/env node

/**
 * run.cjs - Project execution script
 *
 * This script ensures the environment is set up correctly and runs the main project application.
 *
 * Features:
 * - Runs install.cjs to ensure dependencies are up to date
 * - Executes the project's main entry point
 * - Cross-platform compatible (Windows, macOS, Linux)
 */

const { spawnSync, execSync } = require('child_process');
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
 * Get the main script to run from package.json
 */
function getMainScript() {
  const projectRoot = getProjectRoot();
  const packageJsonPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found');
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  // Check for start script in package.json
  if (packageJson.scripts && packageJson.scripts.start) {
    return { type: 'npm-script', command: 'start' };
  }

  // Check for dev script as fallback
  if (packageJson.scripts && packageJson.scripts.dev) {
    return { type: 'npm-script', command: 'dev' };
  }

  // Check for bin entry (CLI tool)
  if (packageJson.bin) {
    const binEntry = typeof packageJson.bin === 'string'
      ? packageJson.bin
      : Object.values(packageJson.bin)[0];

    if (binEntry) {
      return { type: 'bin', path: path.join(projectRoot, binEntry) };
    }
  }

  // Check for main entry
  if (packageJson.main) {
    return { type: 'main', path: path.join(projectRoot, packageJson.main) };
  }

  throw new Error('No runnable entry point found in package.json (no start/dev script, bin, or main field)');
}

/**
 * Run the main project
 */
function runProject() {
  try {
    const mainScript = getMainScript();
    const projectRoot = getProjectRoot();

    let command, args;

    if (mainScript.type === 'npm-script') {
      logInfo(`Running npm script: ${mainScript.command}`);
      command = 'npm';
      args = ['run', mainScript.command];
    } else if (mainScript.type === 'bin') {
      logInfo(`Running bin script: ${mainScript.path}`);
      command = 'node';
      args = [mainScript.path];
    } else if (mainScript.type === 'main') {
      logInfo(`Running main entry: ${mainScript.path}`);
      command = 'node';
      args = [mainScript.path];
    }

    // Pass through any additional arguments
    const additionalArgs = process.argv.slice(2);
    if (additionalArgs.length > 0) {
      args.push(...additionalArgs);
    }

    const result = spawnSync(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env }
    });

    if (result.error) {
      throw result.error;
    }

    return result.status || 0;

  } catch (error) {
    logError(`Failed to run project: ${error.message}`);
    return 1;
  }
}

/**
 * Main execution logic
 */
function main() {
  try {
    logInfo('Starting project execution...');

    // Ensure environment and dependencies are ready
    if (!ensureEnvironment()) {
      process.exit(1);
    }

    // Run the project
    const exitCode = runProject();

    if (exitCode === 0) {
      logSuccess('Project execution completed successfully');
    } else {
      logError(`Project exited with code ${exitCode}`);
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
  runProject,
  getMainScript,
  ensureEnvironment
};
