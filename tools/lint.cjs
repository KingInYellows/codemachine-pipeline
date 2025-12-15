#!/usr/bin/env node

/**
 * tools/lint.cjs
 *
 * Cross-platform linting script with JSON output.
 * Ensures dependencies and linting tools are installed, then runs ESLint.
 * Outputs results exclusively in JSON format to stdout.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Executes install script silently to ensure dependencies are ready
 */
function ensureDependencies() {
  try {
    execSync('node tools/install.cjs', {
      cwd: path.join(__dirname, '..'),
      stdio: 'ignore',
      encoding: 'utf8'
    });
  } catch (error) {
    console.error('Failed to install dependencies');
    process.exit(1);
  }
}

/**
 * Checks if ESLint is available
 */
function isEslintAvailable() {
  const projectRoot = path.join(__dirname, '..');
  const eslintPath = path.join(projectRoot, 'node_modules', '.bin', 'eslint');
  const eslintCmdPath = path.join(projectRoot, 'node_modules', '.bin', 'eslint.cmd');

  // Check for both Unix and Windows executables
  return fs.existsSync(eslintPath) || fs.existsSync(eslintCmdPath);
}

/**
 * Gets the ESLint executable command
 */
function getEslintCommand() {
  const projectRoot = path.join(__dirname, '..');

  // Use npx to run eslint, which handles cross-platform execution
  return 'npx eslint';
}

/**
 * Transforms ESLint results to the required format
 */
function transformEslintResults(eslintOutput) {
  const results = [];

  try {
    const eslintResults = JSON.parse(eslintOutput);

    for (const file of eslintResults) {
      const filePath = file.filePath;

      for (const message of file.messages) {
        // Only include errors and warnings (severity 2 = error, 1 = warning)
        // Filter to only critical issues as specified
        if (message.severity === 2) {
          results.push({
            type: message.ruleId || 'error',
            path: filePath,
            obj: message.ruleId || '',
            message: message.message,
            line: message.line || 0,
            column: message.column || 0
          });
        }
      }
    }
  } catch (error) {
    console.error('Failed to parse ESLint output:', error.message);
    process.exit(1);
  }

  return results;
}

/**
 * Runs ESLint and returns results
 */
function runLint() {
  const projectRoot = path.join(__dirname, '..');
  const eslintCommand = getEslintCommand();

  // ESLint command with JSON format output
  // Using --ext .ts to lint TypeScript files
  // Using --format json for structured output
  const command = `${eslintCommand} . --ext .ts --format json`;

  try {
    const output = execSync(command, {
      cwd: projectRoot,
      encoding: 'utf8',
      // Don't inherit stdio - we need to capture output
      stdio: ['pipe', 'pipe', 'pipe']
    });

    return transformEslintResults(output);
  } catch (error) {
    // ESLint exits with non-zero when it finds issues
    if (error.stdout) {
      return transformEslintResults(error.stdout);
    }

    // If there's a real error (not just lint failures)
    if (error.stderr && !error.stdout) {
      console.error('ESLint execution failed:', error.stderr);
      process.exit(1);
    }

    // Parse whatever output we got
    return transformEslintResults(error.stdout || '[]');
  }
}

/**
 * Main execution logic
 */
function main() {
  // Step 1: Ensure dependencies are installed (silent)
  ensureDependencies();

  // Step 2: Verify ESLint is available
  if (!isEslintAvailable()) {
    console.error('ESLint not found. Installing dependencies...');
    ensureDependencies();
  }

  // Step 3: Run linting
  const results = runLint();

  // Step 4: Output results as JSON to stdout
  console.log(JSON.stringify(results, null, 2));

  // Step 5: Exit with appropriate code
  if (results.length > 0) {
    process.exit(1); // Non-zero exit if errors found
  } else {
    process.exit(0); // Success if no errors
  }
}

// Execute main function
main();
