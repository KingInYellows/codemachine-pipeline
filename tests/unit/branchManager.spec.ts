import { describe, it, expect, beforeAll } from 'vitest';
import {
  isProtectedBranch,
  validateBranchName,
  generateBranchName,
} from '../../src/workflows/branchManager';
import type { RepoConfig } from '../../src/core/config/RepoConfig';

// Mock RepoConfig for testing
function createMockRepoConfig(defaultBranch: string = 'main'): RepoConfig {
  return {
    project: {
      default_branch: defaultBranch,
    },
  } as RepoConfig;
}

describe('branchManager', () => {
  describe('isProtectedBranch', () => {
    const repoConfig = createMockRepoConfig('main');

    it('should identify main as protected', () => {
      expect(isProtectedBranch('main', repoConfig)).toBe(true);
    });

    it('should identify master as protected', () => {
      expect(isProtectedBranch('master', repoConfig)).toBe(true);
    });

    it('should identify develop as protected', () => {
      expect(isProtectedBranch('develop', repoConfig)).toBe(true);
    });

    it('should identify production as protected', () => {
      expect(isProtectedBranch('production', repoConfig)).toBe(true);
    });

    it('should identify custom default branch as protected', () => {
      const customConfig = createMockRepoConfig('trunk');
      expect(isProtectedBranch('trunk', customConfig)).toBe(true);
    });

    it('should identify branches ending with /main as protected', () => {
      expect(isProtectedBranch('origin/main', repoConfig)).toBe(true);
    });

    it('should identify branches ending with /master as protected', () => {
      expect(isProtectedBranch('origin/master', repoConfig)).toBe(true);
    });

    it('should allow feature branches', () => {
      expect(isProtectedBranch('feature/my-feature', repoConfig)).toBe(false);
    });

    it('should allow bugfix branches', () => {
      expect(isProtectedBranch('bugfix/fix-issue', repoConfig)).toBe(false);
    });

    it('should allow branches containing main but not ending with it', () => {
      expect(isProtectedBranch('feature/main-improvement', repoConfig)).toBe(false);
    });

    it('should allow branches containing develop but not ending with it', () => {
      expect(isProtectedBranch('feature/develop-feature', repoConfig)).toBe(false);
    });
  });

  describe('validateBranchName', () => {
    describe('valid branch names', () => {
      it('should accept simple feature branch', () => {
        const result = validateBranchName('feature/my-feature');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should accept bugfix branch', () => {
        const result = validateBranchName('bugfix/fix-123');
        expect(result.valid).toBe(true);
      });

      it('should accept branch with numbers', () => {
        const result = validateBranchName('feature/issue-123');
        expect(result.valid).toBe(true);
      });

      it('should accept branch with underscores', () => {
        const result = validateBranchName('feature/my_feature');
        expect(result.valid).toBe(true);
      });

      it('should accept simple branch name without prefix', () => {
        const result = validateBranchName('my-branch');
        expect(result.valid).toBe(true);
      });

      it('should accept nested path structure', () => {
        const result = validateBranchName('feature/team/my-feature');
        expect(result.valid).toBe(true);
      });
    });

    describe('invalid branch names', () => {
      it('should reject double dots (..)', () => {
        const result = validateBranchName('feature/my..feature');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject double slashes (//)', () => {
        const result = validateBranchName('feature//my-feature');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject starting with dot', () => {
        const result = validateBranchName('.hidden-branch');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject starting with slash', () => {
        const result = validateBranchName('/feature/my-feature');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject ending with dot', () => {
        const result = validateBranchName('feature/my-feature.');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject ending with slash', () => {
        const result = validateBranchName('feature/my-feature/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject ending with .lock', () => {
        const result = validateBranchName('feature/my-branch.lock');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject spaces', () => {
        const result = validateBranchName('feature/my feature');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject @ symbol', () => {
        const result = validateBranchName('feature/user@domain');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject curly braces', () => {
        const result = validateBranchName('feature/{branch}');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject square brackets', () => {
        const result = validateBranchName('feature/[branch]');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject backslash', () => {
        const result = validateBranchName('feature\\branch');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject caret', () => {
        const result = validateBranchName('feature/branch^2');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject tilde', () => {
        const result = validateBranchName('feature/branch~1');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject colon', () => {
        const result = validateBranchName('feature:branch');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject question mark', () => {
        const result = validateBranchName('feature/branch?');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject asterisk', () => {
        const result = validateBranchName('feature/*');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });
    });
  });

  describe('generateBranchName', () => {
    describe('basic generation', () => {
      it('should generate branch with default feature prefix', () => {
        const result = generateBranchName('my-feature', {});
        expect(result).toBe('feature/my-feature');
      });

      it('should use custom branch name when provided', () => {
        const result = generateBranchName('feature-123', { branchName: 'custom-name' });
        expect(result).toBe('feature/custom-name');
      });

      it('should use bugfix prefix when specified', () => {
        const result = generateBranchName('fix-bug', { branchPrefix: 'bugfix/' });
        expect(result).toBe('bugfix/fix-bug');
      });

      it('should use hotfix prefix when specified', () => {
        const result = generateBranchName('urgent-fix', { branchPrefix: 'hotfix/' });
        expect(result).toBe('hotfix/urgent-fix');
      });

      it('should use experiment prefix when specified', () => {
        const result = generateBranchName('try-something', { branchPrefix: 'experiment/' });
        expect(result).toBe('experiment/try-something');
      });
    });

    describe('name sanitization', () => {
      it('should convert to lowercase', () => {
        const result = generateBranchName('My-FEATURE', {});
        expect(result).toBe('feature/my-feature');
      });

      it('should replace spaces with hyphens', () => {
        const result = generateBranchName('my feature name', {});
        expect(result).toBe('feature/my-feature-name');
      });

      it('should replace special characters with hyphens', () => {
        const result = generateBranchName('my@feature#name', {});
        expect(result).toBe('feature/my-feature-name');
      });

      it('should collapse multiple hyphens into one', () => {
        const result = generateBranchName('my---feature---name', {});
        expect(result).toBe('feature/my-feature-name');
      });

      it('should remove leading hyphens from name part', () => {
        const result = generateBranchName('---my-feature', {});
        expect(result).toBe('feature/my-feature');
      });

      it('should remove trailing hyphens from name part', () => {
        const result = generateBranchName('my-feature---', {});
        expect(result).toBe('feature/my-feature');
      });

      it('should preserve underscores', () => {
        const result = generateBranchName('my_feature_name', {});
        expect(result).toBe('feature/my_feature_name');
      });

      it('should preserve forward slashes', () => {
        const result = generateBranchName('team/my-feature', {});
        expect(result).toBe('feature/team/my-feature');
      });

      it('should handle complex feature IDs', () => {
        const result = generateBranchName('ISSUE-123: Fix login bug!', {});
        // Trailing punctuation becomes hyphen which gets stripped by the trailing hyphen removal
        expect(result).toBe('feature/issue-123-fix-login-bug');
      });
    });

    describe('combined options', () => {
      it('should use custom name with bugfix prefix', () => {
        const result = generateBranchName('feature-id', {
          branchName: 'fix-critical-bug',
          branchPrefix: 'bugfix/',
        });
        expect(result).toBe('bugfix/fix-critical-bug');
      });

      it('should sanitize custom branch name', () => {
        const result = generateBranchName('feature-id', {
          branchName: 'Fix Critical Bug!',
        });
        // Trailing punctuation becomes hyphen which gets stripped
        expect(result).toBe('feature/fix-critical-bug');
      });
    });
  });

  // ==========================================================================
  // Coverage gap-fill: git operation exports (CDMCH-83)
  // ==========================================================================

  describe('git operation exports', () => {
    let mod: typeof import('../../src/workflows/branchManager');

    beforeAll(async () => {
      mod = await import('../../src/workflows/branchManager');
    });

    it('should export getCurrentBranch', () => {
      expect(typeof mod.getCurrentBranch).toBe('function');
    });

    it('should export branchExists', () => {
      expect(typeof mod.branchExists).toBe('function');
    });

    it('should export getCommitSha', () => {
      expect(typeof mod.getCommitSha).toBe('function');
    });

    it('should export getRemoteUrl', () => {
      expect(typeof mod.getRemoteUrl).toBe('function');
    });

    it('should export createBranch', () => {
      expect(typeof mod.createBranch).toBe('function');
    });

    it('should export pushBranch', () => {
      expect(typeof mod.pushBranch).toBe('function');
    });

    it('should export saveBranchMetadata', () => {
      expect(typeof mod.saveBranchMetadata).toBe('function');
    });

    it('should export createSafeCommit', () => {
      expect(typeof mod.createSafeCommit).toBe('function');
    });
  });

  describe('createBranch - branch name validation', () => {
    it('should reject branch names that fail validation', async () => {
      const { createBranch } = await import('../../src/workflows/branchManager');
      const vi = await import('vitest');
      const mockLogger = {
        info: vi.vi.fn(),
        debug: vi.vi.fn(),
        warn: vi.vi.fn(),
        error: vi.vi.fn(),
        child: vi.vi.fn(),
        flush: vi.vi.fn(),
      } as unknown as import('../../src/telemetry/logger').StructuredLogger;
      const mockMetrics = {
        recordCounter: vi.vi.fn(),
        recordGauge: vi.vi.fn(),
        recordHistogram: vi.vi.fn(),
      } as unknown as import('../../src/telemetry/metrics').MetricsCollector;

      const config = {
        runDir: '/tmp',
        featureId: 'test',
        workingDir: '/tmp',
        repoConfig: createMockRepoConfig('main'),
      };

      // Using an invalid branch name (contains invalid chars)
      const result = await createBranch(
        config,
        { branchName: '../../../etc/passwd' },
        mockLogger,
        mockMetrics
      );
      expect(result.success).toBe(false);
    });
  });

  describe('pushBranch - protected branch guard', () => {
    it('should reject pushing to a protected branch', async () => {
      const { pushBranch } = await import('../../src/workflows/branchManager');
      const vi = await import('vitest');
      const mockLogger = {
        info: vi.vi.fn(),
        debug: vi.vi.fn(),
        warn: vi.vi.fn(),
        error: vi.vi.fn(),
        child: vi.vi.fn(),
        flush: vi.vi.fn(),
      } as unknown as import('../../src/telemetry/logger').StructuredLogger;
      const mockMetrics = {
        recordCounter: vi.vi.fn(),
        recordGauge: vi.vi.fn(),
        recordHistogram: vi.vi.fn(),
      } as unknown as import('../../src/telemetry/metrics').MetricsCollector;

      const config = {
        runDir: '/tmp',
        featureId: 'test',
        workingDir: '/tmp',
        repoConfig: createMockRepoConfig('main'),
      };

      const result = await pushBranch(config, 'main', 'origin', mockLogger, mockMetrics);
      expect(result.success).toBe(false);
      expect(result.error).toContain('protected');
    });
  });
});
