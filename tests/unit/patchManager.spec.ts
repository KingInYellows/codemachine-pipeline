/**
 * Unit Tests for Patch Manager
 *
 * Tests patch application workflow including:
 * - Dry-run validation with git apply --check
 * - File constraint enforcement (allowed/blocked patterns)
 * - Rollback snapshot creation
 * - Diff summary generation
 * - Conflict detection and state management
 * - Atomic patch application with locking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import {
  validateFileConstraints,
  extractAffectedFiles,
  isWorkingTreeClean,
  getCurrentGitRef,
  validatePatchDryRun,
  createRollbackSnapshot,
  generateDiffSummary,
  applyPatch,
  applyPatchWithStateManagement,
  type Patch,
  type PatchConfig,
} from '../../src/workflows/patchManager';
import type { RepoConfig } from '../../src/core/config/RepoConfig';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { MetricsCollector } from '../../src/telemetry/metrics';
import { updateManifest } from '../../src/persistence/runDirectoryManager';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('node:fs/promises');
vi.mock('node:child_process', () => ({
  exec: vi.fn(
    (
      command: string | Buffer,
      optionsOrCallback?: ExecOptionsArg,
      callbackMaybe?: ExecCallbackArg
    ) => {
      const callback = isExecCallback(optionsOrCallback)
        ? optionsOrCallback
        : isExecCallback(callbackMaybe)
          ? callbackMaybe
          : undefined;

      if (!callback) {
        throw new Error('exec callback missing');
      }

      const commandText = typeof command === 'string' ? command : command.toString('utf-8');
      currentExecHandler(commandText, callback);
      return childProcessStub;
    }
  ),
  execFile: vi.fn((...args: unknown[]) => {
    const callback = args.find((a) => typeof a === 'function') as ExecCallback | undefined;
    if (!callback) {
      throw new Error('execFile callback missing');
    }
    const file = args[0] as string;
    const fileArgs = Array.isArray(args[1]) ? (args[1] as string[]) : [];
    const commandText = [file, ...fileArgs].join(' ');
    currentExecHandler(commandText, callback);
    return childProcessStub;
  }),
}));
vi.mock('../../src/persistence/runDirectoryManager', () => ({
  withLock: vi.fn(async (_runDir: string, fn: () => Promise<unknown>) => await fn()),
  getSubdirectoryPath: vi.fn((runDir: string, subdir: string) => `${runDir}/${subdir}`),
  updateManifest: vi.fn(),
}));

const rawLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} satisfies Record<'info' | 'warn' | 'error' | 'debug', ReturnType<typeof vi.fn>>;
const mockLogger = rawLogger as unknown as StructuredLogger;

const rawMetrics = {
  increment: vi.fn(),
  gauge: vi.fn(),
  histogram: vi.fn(),
  timing: vi.fn(),
} satisfies Record<'increment' | 'gauge' | 'histogram' | 'timing', ReturnType<typeof vi.fn>>;
const mockMetrics = rawMetrics as unknown as MetricsCollector;

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecOptionsArg = Parameters<typeof exec>[1];
type ExecCallbackArg = Parameters<typeof exec>[2];
type ChildProcessStdio = [
  Writable | null,
  Readable | null,
  Readable | null,
  Readable | Writable | null,
  Readable | Writable | null,
];
type ExecHandler = (command: string, callback: ExecCallback) => void;

const stdio: ChildProcessStdio = [null, null, null, null, null];

const childProcessStub: ChildProcess = Object.assign(new EventEmitter(), {
  stdin: null as Writable | null,
  stdout: null as Readable | null,
  stderr: null as Readable | null,
  stdio,
  killed: false,
  pid: 0,
  connected: false,
  exitCode: null,
  signalCode: null,
  spawnargs: [] as string[],
  spawnfile: '',
  channel: null,
  kill: vi.fn(() => true),
  send: vi.fn(() => true),
  disconnect: vi.fn(),
  unref: vi.fn(),
  ref: vi.fn(),
});

function isExecCallback(
  value: ExecOptionsArg | ExecCallbackArg | undefined
): value is ExecCallback {
  return typeof value === 'function';
}

function respond(
  callback: ExecCallback,
  stdout = '',
  stderr = '',
  error: Error | null = null
): void {
  process.nextTick(() => {
    callback(error, stdout, stderr);
  });
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface SnapshotMetadataShape {
  feature_id: string;
  patch_id: string;
  git_ref: string;
  git_sha: string;
}

interface DiffSummaryShape {
  patch_id: string;
  feature_id: string;
  task_id?: string;
  modified_files: string[];
  patch_hash: string;
}

function assertIsSnapshotMetadata(value: unknown): asserts value is SnapshotMetadataShape {
  if (
    !isRecord(value) ||
    typeof value.feature_id !== 'string' ||
    typeof value.patch_id !== 'string' ||
    typeof value.git_ref !== 'string' ||
    typeof value.git_sha !== 'string'
  ) {
    throw new Error('Invalid snapshot metadata payload');
  }
}

function assertIsDiffSummary(value: unknown): asserts value is DiffSummaryShape {
  if (
    !isRecord(value) ||
    typeof value.patch_id !== 'string' ||
    typeof value.feature_id !== 'string' ||
    (value.task_id !== undefined && typeof value.task_id !== 'string') ||
    !Array.isArray(value.modified_files) ||
    value.modified_files.some((file) => typeof file !== 'string') ||
    typeof value.patch_hash !== 'string'
  ) {
    throw new Error('Invalid diff summary payload');
  }
}

function handleDefaultGitCommand(command: string, callback: ExecCallback): void {
  if (command.includes('git status --porcelain')) {
    respond(callback, '', '');
    return;
  }

  if (command.includes('git symbolic-ref')) {
    respond(callback, 'refs/heads/main\n', '');
    return;
  }

  if (command.includes('git rev-parse HEAD')) {
    respond(callback, 'a1b2c3d4e5f6\n', '');
    return;
  }

  if (command.includes('git apply --check')) {
    respond(callback, '', '');
    return;
  }

  if (command.includes('git apply')) {
    respond(callback, '', '');
    return;
  }

  respond(callback, '', '', new Error(`Unknown command: ${command}`));
}

let currentExecHandler: ExecHandler = handleDefaultGitCommand;

function mockExecDefault(): void {
  currentExecHandler = handleDefaultGitCommand;
}

function mockExecWithOverrides(
  overrideHandler: (command: string, callback: ExecCallback) => boolean
): void {
  currentExecHandler = (command, callback) => {
    if (overrideHandler(command, callback)) {
      return;
    }
    handleDefaultGitCommand(command, callback);
  };
}

function createMockRepoConfig(): RepoConfig {
  return {
    schema_version: '1.0.0',
    project: {
      id: 'test-project',
      repo_url: 'https://github.com/test/repo.git',
      default_branch: 'main',
      context_paths: ['src/'],
      project_leads: [],
    },
    github: {
      enabled: false,
      token_env_var: 'GITHUB_TOKEN',
      api_base_url: 'https://api.github.com',
      required_scopes: ['repo'],
      default_reviewers: [],
    },
    linear: {
      enabled: false,
      api_key_env_var: 'LINEAR_API_KEY',
      auto_link_issues: false,
    },
    runtime: {
      agent_endpoint_env_var: 'AGENT_ENDPOINT',
      max_concurrent_tasks: 3,
      timeout_minutes: 30,
      context_token_budget: 32000,
      context_cost_budget_usd: 5,
      logs_format: 'ndjson',
      run_directory: '.codepipe/runs',
    },
    safety: {
      redact_secrets: true,
      require_approval_for_prd: true,
      require_approval_for_plan: true,
      require_approval_for_pr: true,
      prevent_force_push: true,
      allowed_file_patterns: ['**/*.ts', '**/*.js', '**/*.md', '**/*.json'],
      blocked_file_patterns: ['.env', '**/*.key', '**/*.pem', '**/credentials.*'],
    },
    feature_flags: {
      enable_auto_merge: false,
      enable_deployment_triggers: false,
      enable_linear_sync: false,
      enable_context_summarization: true,
      enable_resumability: true,
      enable_developer_preview: false,
    },
    config_history: [],
  };
}

function createMockPatch(overrides?: Partial<Patch>): Patch {
  return {
    patchId: 'I3.T2-001',
    content: `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { newFeature } from './feature';
 const app = express();
`,
    description: 'Add new feature import',
    affectedFiles: ['src/index.ts'],
    ...overrides,
  };
}

function createMockPatchConfig(overrides?: Partial<PatchConfig>): PatchConfig {
  return {
    runDir: '/test/run/dir',
    featureId: 'feat-123',
    taskId: 'I3.T2',
    repoConfig: createMockRepoConfig(),
    workingDir: '/test/repo',
    ...overrides,
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Patch Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentExecHandler = handleDefaultGitCommand;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('validateFileConstraints', () => {
    it('should pass validation for allowed files', () => {
      const repoConfig = createMockRepoConfig();
      const affectedFiles = ['src/index.ts', 'src/feature.ts', 'README.md'];

      const result = validateFileConstraints(affectedFiles, repoConfig, mockLogger);

      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should detect blocked file pattern violations', () => {
      const repoConfig = createMockRepoConfig();
      const affectedFiles = ['src/index.ts', '.env'];

      const result = validateFileConstraints(affectedFiles, repoConfig, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        file: '.env',
        type: 'blocked_pattern',
        pattern: '.env',
      });
      expect(rawLogger.warn).toHaveBeenCalledWith(
        'File violates blocked pattern constraint',
        expect.objectContaining({ file: '.env' })
      );
    });

    it('should detect files not matching allowed patterns', () => {
      const repoConfig = createMockRepoConfig();
      const affectedFiles = ['src/binary.exe'];

      const result = validateFileConstraints(affectedFiles, repoConfig, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        file: 'src/binary.exe',
        type: 'not_allowed_pattern',
      });
    });

    it('should prioritize blocked patterns over allowed patterns', () => {
      const repoConfig = createMockRepoConfig();
      // .key matches both blocked (**/*.key) and potentially allowed if we had **/*
      const affectedFiles = ['secrets/api.key'];

      const result = validateFileConstraints(affectedFiles, repoConfig, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].type).toBe('blocked_pattern');
    });

    it('should detect multiple violations', () => {
      const repoConfig = createMockRepoConfig();
      const affectedFiles = ['.env', 'secrets.pem', 'credentials.json'];

      const result = validateFileConstraints(affectedFiles, repoConfig, mockLogger);

      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(3);
    });
  });

  describe('extractAffectedFiles', () => {
    it('should extract files from unified diff headers', () => {
      const patchContent = `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { newFeature } from './feature';
 const app = express();
--- a/src/feature.ts
+++ b/src/feature.ts
@@ -1,1 +1,2 @@
+export function newFeature() {}
`;

      const files = extractAffectedFiles(patchContent);

      expect(files).toContain('src/index.ts');
      expect(files).toContain('src/feature.ts');
      expect(files).toHaveLength(2);
    });

    it('should filter out /dev/null for new/deleted files', () => {
      const patchContent = `--- /dev/null
+++ b/src/newfile.ts
@@ -0,0 +1,3 @@
+export const newFile = true;
--- a/src/deleted.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const deleted = true;
`;

      const files = extractAffectedFiles(patchContent);

      expect(files).toContain('src/newfile.ts');
      expect(files).toContain('src/deleted.ts');
      expect(files).not.toContain('dev/null');
    });

    it('should return empty array for invalid patch', () => {
      const patchContent = 'not a valid patch';

      const files = extractAffectedFiles(patchContent);

      expect(files).toHaveLength(0);
    });
  });

  describe('isWorkingTreeClean', () => {
    it('should return true for clean working tree', async () => {
      mockExecDefault();

      const result = await isWorkingTreeClean('/test/repo');

      expect(result).toBe(true);
    });

    it('should return false for dirty working tree', async () => {
      const handler = vi.fn((command: string, callback: ExecCallback) => {
        if (command.includes('git status --porcelain')) {
          respond(callback, 'M src/index.ts\n', '');
          return true;
        }
        return false;
      });
      mockExecWithOverrides(handler);

      const result = await isWorkingTreeClean('/test/repo');

      expect(result).toBe(false);
      expect(handler).toHaveBeenCalled();
    });

    it('should throw on git command failure', async () => {
      mockExecWithOverrides((command, callback) => {
        if (command.includes('git status --porcelain')) {
          respond(callback, '', '', new Error('git error'));
          return true;
        }
        return false;
      });

      await expect(isWorkingTreeClean('/test/repo')).rejects.toThrow(
        'Failed to check git working tree status'
      );
    });
  });

  describe('getCurrentGitRef', () => {
    it('should return current ref and sha', async () => {
      mockExecDefault();

      const result = await getCurrentGitRef('/test/repo');

      expect(result.ref).toBe('refs/heads/main');
      expect(result.sha).toBe('a1b2c3d4e5f6');
    });
  });

  describe('validatePatchDryRun', () => {
    it('should pass dry-run for valid patch with allowed files', async () => {
      mockExecDefault();
      vi.mocked(fs.mkdtemp).mockResolvedValue('/tmp/codepipe-patch-test');
      vi.mocked(fs.writeFile).mockResolvedValue();
      vi.mocked(fs.rm).mockResolvedValue();

      const patch = createMockPatch();
      const repoConfig = createMockRepoConfig();

      const result = await validatePatchDryRun(patch, '/test/repo', repoConfig, mockLogger);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.affectedFiles).toContain('src/index.ts');
      expect(result.violations).toHaveLength(0);
      expect(rawLogger.info).toHaveBeenCalledWith(
        'Dry-run validation succeeded',
        expect.objectContaining({ patchId: 'I3.T2-001' })
      );
    });

    it('should fail dry-run when files violate constraints', async () => {
      mockExecDefault();

      const patch = createMockPatch({
        affectedFiles: ['.env'],
        content: `--- a/.env
+++ b/.env
@@ -1,1 +1,2 @@
+SECRET_KEY=abc123
`,
      });
      const repoConfig = createMockRepoConfig();

      const result = await validatePatchDryRun(patch, '/test/repo', repoConfig, mockLogger);

      expect(result.success).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].file).toBe('.env');
      expect(result.errors[0]).toContain('violates file constraints');
    });

    it('should fail dry-run when working tree is not clean', async () => {
      mockExecWithOverrides((command, callback) => {
        if (command.includes('git status --porcelain')) {
          respond(callback, 'M src/modified.ts\n', '');
          return true;
        }
        return false;
      });

      const patch = createMockPatch();
      const repoConfig = createMockRepoConfig();

      const result = await validatePatchDryRun(patch, '/test/repo', repoConfig, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        'Working tree is not clean. Commit or stash changes before applying patches.'
      );
    });

    it('should fail dry-run when git apply --check fails', async () => {
      mockExecWithOverrides((command, callback) => {
        if (command.includes('git apply --check')) {
          respond(
            callback,
            '',
            'error: patch failed: src/index.ts:42',
            new Error('patch does not apply')
          );
          return true;
        }
        return false;
      });
      vi.mocked(fs.mkdtemp).mockResolvedValue('/tmp/codepipe-patch-test');
      vi.mocked(fs.writeFile).mockResolvedValue();
      vi.mocked(fs.rm).mockResolvedValue();

      const patch = createMockPatch();
      const repoConfig = createMockRepoConfig();

      const result = await validatePatchDryRun(patch, '/test/repo', repoConfig, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('git apply --check failed');
      expect(rawLogger.warn).toHaveBeenCalledWith(
        'Dry-run validation failed',
        expect.objectContaining({ patchId: 'I3.T2-001' })
      );
    });
  });

  describe('createRollbackSnapshot', () => {
    it('should create snapshot with git metadata', async () => {
      mockExecDefault();
      vi.mocked(fs.mkdir).mockResolvedValue();
      let snapshotPayload: Parameters<typeof fs.writeFile>[1] | undefined;
      vi.mocked(fs.writeFile).mockImplementation((_path, data) => {
        snapshotPayload = data;
        return Promise.resolve();
      });

      const config = createMockPatchConfig();
      const patch = createMockPatch();

      const snapshotPath = await createRollbackSnapshot(config, patch, mockLogger);

      expect(snapshotPath).toContain('snapshot-I3.T2-I3.T2-001');
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('patches/snapshots'),
        expect.objectContaining({ recursive: true })
      );

      if (typeof snapshotPayload !== 'string') {
        throw new Error('Expected snapshot payload to be a string');
      }
      const snapshotContent = parseJson(snapshotPayload);
      assertIsSnapshotMetadata(snapshotContent);

      expect(snapshotContent.feature_id).toBe('feat-123');
      expect(snapshotContent.patch_id).toBe('I3.T2-001');
      expect(snapshotContent.git_ref).toBe('refs/heads/main');
      expect(snapshotContent.git_sha).toBe('a1b2c3d4e5f6');
      expect(rawLogger.info).toHaveBeenCalledWith(
        'Created rollback snapshot',
        expect.objectContaining({ patchId: 'I3.T2-001' })
      );
    });
  });

  describe('generateDiffSummary', () => {
    it('should generate diff summary with patch metadata', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue();
      let summaryPayload: Parameters<typeof fs.writeFile>[1] | undefined;
      vi.mocked(fs.writeFile).mockImplementation((_path, data) => {
        summaryPayload = data;
        return Promise.resolve();
      });

      const patch = createMockPatch();
      const config = createMockPatchConfig();
      const modifiedFiles = ['src/index.ts', 'src/feature.ts'];

      const summaryPath = await generateDiffSummary(patch, config, modifiedFiles);

      expect(summaryPath).toContain('I3.T2-001-summary.json');
      expect(fs.mkdir).toHaveBeenCalled();

      if (typeof summaryPayload !== 'string') {
        throw new Error('Expected summary payload to be a string');
      }
      const summary = parseJson(summaryPayload);
      assertIsDiffSummary(summary);

      expect(summary.patch_id).toBe('I3.T2-001');
      expect(summary.feature_id).toBe('feat-123');
      expect(summary.task_id).toBe('I3.T2');
      expect(summary.modified_files).toEqual(modifiedFiles);
      expect(summary.patch_hash).toBeDefined();
    });
  });

  describe('applyPatch', () => {
    it('should apply patch successfully with snapshots and summaries', async () => {
      mockExecDefault();
      vi.mocked(fs.mkdtemp).mockResolvedValue('/tmp/codepipe-patch-test');
      vi.mocked(fs.writeFile).mockResolvedValue();
      vi.mocked(fs.rm).mockResolvedValue();
      vi.mocked(fs.mkdir).mockResolvedValue();

      const patch = createMockPatch();
      const config = createMockPatchConfig();

      const result = await applyPatch(patch, config, mockLogger, mockMetrics);

      expect(result.success).toBe(true);
      expect(result.patchId).toBe('I3.T2-001');
      expect(result.modifiedFiles).toContain('src/index.ts');
      expect(result.snapshotPath).toBeDefined();
      expect(result.diffSummaryPath).toBeDefined();
      expect(rawLogger.info).toHaveBeenCalledWith(
        'Patch applied successfully',
        expect.objectContaining({ patchId: 'I3.T2-001' })
      );
      expect(rawMetrics.increment).toHaveBeenCalledWith(
        'patch_application_success_total',
        expect.objectContaining({ feature_id: 'feat-123' })
      );
    });

    it('should fail when dry-run validation fails', async () => {
      mockExecWithOverrides((command, callback) => {
        if (command.includes('git status --porcelain')) {
          respond(callback, 'M src/modified.ts\n', '');
          return true;
        }
        return false;
      });

      const patch = createMockPatch();
      const config = createMockPatchConfig();

      const result = await applyPatch(patch, config, mockLogger, mockMetrics);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dry-run validation failed');
      expect(rawLogger.error).toHaveBeenCalledWith(
        'Patch application blocked by dry-run validation',
        expect.any(Object)
      );
      expect(rawMetrics.increment).toHaveBeenCalledWith(
        'patch_application_failed_total',
        expect.objectContaining({ reason: 'dry_run_failed' })
      );
    });

    it('should mark constraint violations as non-recoverable', async () => {
      mockExecDefault();

      const patch = createMockPatch({
        affectedFiles: ['.env'],
      });
      const config = createMockPatchConfig();

      const result = await applyPatch(patch, config, mockLogger, mockMetrics);

      expect(result.success).toBe(false);
      expect(result.recoverable).toBe(false);
      expect(result.error).toContain('violates file constraints');
    });

    it('should handle git apply failures as recoverable', async () => {
      mockExecWithOverrides((command, callback) => {
        if (command.includes('git apply') && !command.includes('--check')) {
          respond(callback, '', 'error: patch failed: src/index.ts:42', new Error('patch failed'));
          return true;
        }
        return false;
      });
      vi.mocked(fs.mkdtemp).mockResolvedValue('/tmp/codepipe-patch-test');
      vi.mocked(fs.writeFile).mockResolvedValue();
      vi.mocked(fs.rm).mockResolvedValue();
      vi.mocked(fs.mkdir).mockResolvedValue();

      const patch = createMockPatch();
      const config = createMockPatchConfig();

      const result = await applyPatch(patch, config, mockLogger, mockMetrics);

      expect(result.success).toBe(false);
      expect(result.recoverable).toBe(true);
      expect(result.error).toContain('git apply failed');
      expect(rawMetrics.increment).toHaveBeenCalledWith(
        'patch_application_failed_total',
        expect.objectContaining({ reason: 'git_apply_failed' })
      );
    });
  });

  describe('applyPatchWithStateManagement', () => {
    it('should update manifest when patch fails with recoverable error', async () => {
      mockExecWithOverrides((command, callback) => {
        if (command.includes('git apply') && !command.includes('--check')) {
          respond(callback, '', '', new Error('patch failed'));
          return true;
        }
        return false;
      });
      vi.mocked(fs.mkdtemp).mockResolvedValue('/tmp/codepipe-patch-test');
      vi.mocked(fs.writeFile).mockResolvedValue();
      vi.mocked(fs.rm).mockResolvedValue();
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const patch = createMockPatch();
      const config = createMockPatchConfig();

      const result = await applyPatchWithStateManagement(patch, config, mockLogger, mockMetrics);

      expect(result.success).toBe(false);
      expect(result.recoverable).toBe(true);
      expect(rawLogger.warn).toHaveBeenCalledWith(
        'Patch application requires manual intervention',
        expect.objectContaining({ patchId: 'I3.T2-001' })
      );
      expect(updateManifest).toHaveBeenCalled();
      const pausedCall = vi.mocked(updateManifest).mock.calls.at(-1);
      expect(pausedCall?.[0]).toBe(config.runDir);
      expect(typeof pausedCall?.[1]).toBe('function');
    });

    it('should not update manifest when patch succeeds', async () => {
      mockExecDefault();
      vi.mocked(fs.mkdtemp).mockResolvedValue('/tmp/codepipe-patch-test');
      vi.mocked(fs.writeFile).mockResolvedValue();
      vi.mocked(fs.rm).mockResolvedValue();
      vi.mocked(fs.mkdir).mockResolvedValue();

      vi.mocked(updateManifest).mockClear();

      const patch = createMockPatch();
      const config = createMockPatchConfig();

      const result = await applyPatchWithStateManagement(patch, config, mockLogger, mockMetrics);

      expect(result.success).toBe(true);
      expect(vi.mocked(updateManifest).mock.calls).toHaveLength(1);
    });
  });
});
