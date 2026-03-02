/**
 * CLI path validation utility.
 *
 * Validates filesystem paths for safe use in process spawning,
 * preventing shell injection via metacharacters, path traversal, etc.
 */

/**
 * Allowlist regex for safe CLI path characters.
 * Uses an allowlist instead of a blocklist to prevent bypass
 * via `$()`, backticks, or Unicode homoglyphs.
 */
const SAFE_CLI_PATH_PATTERN = /^[a-zA-Z0-9_\-./:\\]+$/;

export function validateCliPath(cliPath: string): { valid: boolean; error?: string } {
  if (cliPath.length === 0) {
    return { valid: false, error: 'CLI path is empty' };
  }
  if (cliPath.trim() !== cliPath) {
    return { valid: false, error: 'CLI path contains leading or trailing whitespace' };
  }
  if (!SAFE_CLI_PATH_PATTERN.test(cliPath)) {
    if (/[\n\r]/.test(cliPath)) {
      return { valid: false, error: 'CLI path contains newline characters' };
    }
    if (/[;|&`$(){}]/.test(cliPath)) {
      return { valid: false, error: 'CLI path contains shell metacharacters' };
    }
    return { valid: false, error: 'CLI path contains invalid characters' };
  }
  if (cliPath.split(/[\\/]/).includes('..')) {
    return { valid: false, error: 'CLI path contains path traversal segments (..)' };
  }
  return { valid: true };
}
