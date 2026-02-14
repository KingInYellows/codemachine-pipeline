import * as os from 'node:os';

/**
 * Base set of environment variables always passed to child processes.
 */
const BASE_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'NODE_ENV', 'LOG_LEVEL',
] as const;

/**
 * Filter process environment to an allowlist of safe variables.
 *
 * @param options.additional - Extra keys to allow beyond the base set
 * @param options.includeDebug - Include DEBUG env var (default: false)
 * @param options.includeTmpdir - Include TMPDIR from os.tmpdir() (default: false)
 */
export function filterEnvironment(options: {
  additional?: string[];
  includeDebug?: boolean;
  includeTmpdir?: boolean;
} = {}): Record<string, string> {
  const filtered: Record<string, string> = {};
  const keys = new Set<string>([
    ...BASE_ENV_ALLOWLIST,
    ...(options.additional ?? []),
  ]);

  if (options.includeDebug) {
    keys.add('DEBUG');
  }

  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  if (options.includeTmpdir) {
    const tmpDir = os.tmpdir();
    if (tmpDir) {
      filtered.TMPDIR = tmpDir;
    }
  }

  return filtered;
}
