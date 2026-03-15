import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { validateCliPath } from './types.js';

/**
 * Platform-specific binary package mapping for CodeMachine-CLI.
 *
 * CodeMachine-CLI publishes platform packages that follow the
 * esbuild/turbo optionalDependencies pattern. When one of those
 * packages is present in node_modules, we bypass the wrapper package's
 * `#!/usr/bin/env bun` entrypoint and execute the compiled binary directly.
 */
const PLATFORM_MAP: Record<string, { pkg: string; bin: string }> = {
  'linux-x64': { pkg: 'codemachine-linux-x64', bin: 'codemachine' },
  'linux-arm64': { pkg: 'codemachine-linux-arm64', bin: 'codemachine' },
  'darwin-arm64': { pkg: 'codemachine-darwin-arm64', bin: 'codemachine' },
  'darwin-x64': { pkg: 'codemachine-darwin-x64', bin: 'codemachine' },
  'win32-x64': { pkg: 'codemachine-windows-x64', bin: 'codemachine.exe' },
};

export interface BinaryResolutionResult {
  resolved: boolean;
  binaryPath?: string;
  source?: 'env' | 'optionalDep' | 'path';
  error?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedResult: BinaryResolutionResult | undefined;
let cachedAt = 0;

/**
 * Resolve the CodeMachine-CLI binary path.
 *
 * Resolution order:
 * 1. `CODEMACHINE_BIN_PATH` env var (user override, must pass validateCliPath)
 * 2. Platform binary from `node_modules/codemachine-<platform>-<arch>/codemachine`
 * 3. Global `codemachine` in PATH (fallback)
 * 4. Not found — caller should skip this strategy
 */
export async function resolveBinary(): Promise<BinaryResolutionResult> {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  const result = await resolveBinaryUncached();
  if (result.resolved) {
    cachedResult = result;
    cachedAt = Date.now();
  }
  return result;
}

/** Clear the cached binary resolution (useful for testing). */
export function clearBinaryCache(): void {
  cachedResult = undefined;
  cachedAt = 0;
}

async function resolveBinaryUncached(): Promise<BinaryResolutionResult> {
  // 1. Check env var override
  const envPath = process.env.CODEMACHINE_BIN_PATH;
  if (envPath) {
    const pathCheck = validateCliPath(envPath);
    if (!pathCheck.valid) {
      return { resolved: false, error: `CODEMACHINE_BIN_PATH invalid: ${pathCheck.error}` };
    }
    const exists = await isExecutable(envPath);
    if (exists) {
      return { resolved: true, binaryPath: envPath, source: 'env' };
    }
    return { resolved: false, error: `CODEMACHINE_BIN_PATH not executable: ${envPath}` };
  }

  // 2. Resolve from platform package installed in node_modules
  const platformKey = `${process.platform}-${process.arch}`;
  const platformEntry = PLATFORM_MAP[platformKey];

  if (platformEntry) {
    try {
      // Resolve the platform package's directory via require.resolve
      const pkgJsonPath = require.resolve(`${platformEntry.pkg}/package.json`);
      const pkgDir = path.dirname(pkgJsonPath);
      const binaryPath = path.join(pkgDir, platformEntry.bin);

      const exists = await isExecutable(binaryPath);
      if (exists) {
        return { resolved: true, binaryPath, source: 'optionalDep' };
      }
    } catch {
      // Platform package not installed — fall through to PATH
    }
  }

  // 3. Check global PATH
  const globalBinaryName = process.platform === 'win32' ? 'codemachine.exe' : 'codemachine';
  const globalPath = await findInPath(globalBinaryName);
  if (globalPath) {
    return { resolved: true, binaryPath: globalPath, source: 'path' };
  }

  // 4. Not found
  return {
    resolved: false,
    error:
      `CodeMachine-CLI binary not found. Platform: ${platformKey}. ` +
      'Install CodeMachine CLI separately (for example `npm install -g codemachine@^0.8.0`) or set CODEMACHINE_BIN_PATH.',
  };
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findInPath(name: string): Promise<string | undefined> {
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
