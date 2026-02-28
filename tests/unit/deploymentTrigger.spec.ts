import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  selectDeploymentStrategy,
  DeploymentStrategy,
  type DeploymentContext,
  type MergeReadiness,
  type DeploymentOptions,
  type DeploymentConfig,
} from '../../src/workflows/deployment/trigger';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { BranchProtectionReport } from '../../src/workflows/branchProtectionReporter';

// Create a mock logger that does nothing
function createMockLogger(): StructuredLogger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
    flush: vi.fn(() => Promise.resolve()),
  } as unknown as StructuredLogger;
}

// Create minimal deployment context
function createDeploymentContext(
  overrides: Partial<{
    config: Partial<DeploymentConfig>;
    branchProtection: Partial<BranchProtectionReport> | null;
  }> = {}
): DeploymentContext {
  const defaultConfig: DeploymentConfig = {
    enable_auto_merge: true,
    enable_deployment_triggers: true,
    respect_branch_protection: true,
    prevent_auto_merge: false,
    require_deploy_approval: false,
    merge_method: 'squash',
  };

  return {
    config: { ...defaultConfig, ...overrides.config },
    branchProtection:
      overrides.branchProtection === null
        ? null
        : ({
            allows_auto_merge: true,
            ...overrides.branchProtection,
          } as BranchProtectionReport),
    logger: createMockLogger(),
    pr: { url: 'https://github.com/test/repo/pull/1' } as DeploymentContext['pr'],
    approvals: { approvalsHash: 'abc123' } as DeploymentContext['approvals'],
    branchProtectionHash: 'def456',
    runDir: '/tmp/test-run',
    featureId: 'test-feature',
  } as DeploymentContext;
}

// Create minimal merge readiness
function createMergeReadiness(overrides: Partial<MergeReadiness> = {}): MergeReadiness {
  return {
    eligible: true,
    blockers: [],
    context: {
      pr_state: 'open',
      mergeable: true,
      mergeable_state: 'clean',
      checks_passing: true,
      reviews_satisfied: true,
      branch_up_to_date: true,
      pending_approvals: [],
      deploy_approval_required: false,
      deploy_approval_granted: false,
    },
    ...overrides,
  };
}

describe('deploymentTrigger', () => {
  describe('selectDeploymentStrategy', () => {
    describe('blocked scenarios', () => {
      it('should return BLOCKED when not eligible and not forcing', () => {
        const context = createDeploymentContext();
        const readiness = createMergeReadiness({
          eligible: false,
          blockers: [
            {
              type: 'status_checks',
              message: 'CI checks failing',
              recommended_action: 'Fix CI',
            },
          ],
        });

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.BLOCKED);
      });

      it('should not block when forcing and not eligible', () => {
        const context = createDeploymentContext();
        const readiness = createMergeReadiness({
          eligible: false,
          blockers: [
            {
              type: 'status_checks',
              message: 'CI checks failing',
              recommended_action: 'Fix CI',
            },
          ],
        });
        const options: DeploymentOptions = { force: true };

        const strategy = selectDeploymentStrategy(context, readiness, options);
        // Should proceed to AUTO_MERGE since force overrides blockers
        expect(strategy).toBe(DeploymentStrategy.AUTO_MERGE);
      });
    });

    describe('workflow dispatch scenarios', () => {
      it('should return WORKFLOW_DISPATCH when workflow_inputs provided in options', () => {
        const context = createDeploymentContext();
        const readiness = createMergeReadiness();
        const options: DeploymentOptions = {
          workflow_inputs: { environment: 'production' },
        };

        const strategy = selectDeploymentStrategy(context, readiness, options);
        expect(strategy).toBe(DeploymentStrategy.WORKFLOW_DISPATCH);
      });

      it('should return WORKFLOW_DISPATCH when workflow_dispatch configured', () => {
        const context = createDeploymentContext({
          config: {
            workflow_dispatch: {
              workflow_id: 'deploy.yml',
              inputs: { environment: 'staging' },
            },
          },
        });
        const readiness = createMergeReadiness();

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.WORKFLOW_DISPATCH);
      });
    });

    describe('manual merge scenarios', () => {
      it('should return MANUAL_MERGE when prevent_auto_merge is true', () => {
        const context = createDeploymentContext({
          config: { prevent_auto_merge: true },
        });
        const readiness = createMergeReadiness();

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.MANUAL_MERGE);
      });

      it('should return MANUAL_MERGE when enable_auto_merge is false', () => {
        const context = createDeploymentContext({
          config: { enable_auto_merge: false },
        });
        const readiness = createMergeReadiness();

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.MANUAL_MERGE);
      });

      it('should return MANUAL_MERGE when branch protection disallows auto-merge', () => {
        const context = createDeploymentContext({
          branchProtection: { allows_auto_merge: false },
        });
        const readiness = createMergeReadiness();

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.MANUAL_MERGE);
      });
    });

    describe('auto merge scenarios', () => {
      it('should return AUTO_MERGE when all conditions are met', () => {
        const context = createDeploymentContext({
          config: {
            enable_auto_merge: true,
            prevent_auto_merge: false,
          },
          branchProtection: { allows_auto_merge: true },
        });
        const readiness = createMergeReadiness({ eligible: true });

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.AUTO_MERGE);
      });

      it('should return AUTO_MERGE when branch protection is null', () => {
        const context = createDeploymentContext({
          config: {
            enable_auto_merge: true,
            prevent_auto_merge: false,
          },
          branchProtection: null,
        });
        const readiness = createMergeReadiness({ eligible: true });

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.AUTO_MERGE);
      });
    });

    describe('priority ordering', () => {
      it('should prioritize BLOCKED over WORKFLOW_DISPATCH', () => {
        const context = createDeploymentContext({
          config: {
            workflow_dispatch: { workflow_id: 'deploy.yml' },
          },
        });
        const readiness = createMergeReadiness({
          eligible: false,
          blockers: [
            {
              type: 'status_checks',
              message: 'CI failing',
              recommended_action: 'Fix CI',
            },
          ],
        });

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.BLOCKED);
      });

      it('should prioritize WORKFLOW_DISPATCH over governance controls', () => {
        const context = createDeploymentContext({
          config: {
            workflow_dispatch: { workflow_id: 'deploy.yml' },
            prevent_auto_merge: true,
            enable_auto_merge: false,
          },
        });
        const readiness = createMergeReadiness({ eligible: true });

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.WORKFLOW_DISPATCH);
      });

      it('should prioritize prevent_auto_merge over enable_auto_merge', () => {
        const context = createDeploymentContext({
          config: {
            prevent_auto_merge: true,
            enable_auto_merge: true,
          },
          branchProtection: { allows_auto_merge: true },
        });
        const readiness = createMergeReadiness({ eligible: true });

        const strategy = selectDeploymentStrategy(context, readiness);
        expect(strategy).toBe(DeploymentStrategy.MANUAL_MERGE);
      });
    });
  });

  // ==========================================================================
  // Coverage gap-fill: exported function signatures (CDMCH-87)
  // ==========================================================================

  describe('deployment function exports', () => {
    let mod: typeof import('../../src/workflows/deployment/trigger');

    beforeAll(async () => {
      mod = await import('../../src/workflows/deployment/trigger');
    });

    it('should export loadDeploymentContext', () => {
      expect(typeof mod.loadDeploymentContext).toBe('function');
    });

    it('should export persistDeploymentOutcome', () => {
      expect(typeof mod.persistDeploymentOutcome).toBe('function');
    });

    it('should export triggerDeployment', () => {
      expect(typeof mod.triggerDeployment).toBe('function');
    });

    it('should export DeploymentStrategy enum with expected values', () => {
      expect(DeploymentStrategy.AUTO_MERGE).toBe('AUTO_MERGE');
      expect(DeploymentStrategy.MANUAL_MERGE).toBe('MANUAL_MERGE');
      expect(DeploymentStrategy.WORKFLOW_DISPATCH).toBe('WORKFLOW_DISPATCH');
      expect(DeploymentStrategy.BLOCKED).toBe('BLOCKED');
    });
  });

  describe('strategy selection completeness', () => {
    it('should return BLOCKED when not merge-eligible', () => {
      const context = createDeploymentContext({
        config: { enable_auto_merge: true },
        branchProtection: { allows_auto_merge: true },
      });
      const readiness = createMergeReadiness({ eligible: false });

      const strategy = selectDeploymentStrategy(context, readiness);
      expect(strategy).toBe(DeploymentStrategy.BLOCKED);
    });
  });
});
