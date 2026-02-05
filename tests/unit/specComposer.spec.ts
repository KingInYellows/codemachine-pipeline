/**
 * Unit Tests for Specification Composer
 *
 * Tests the spec authoring workflow including:
 * - PRD approval gate enforcement
 * - Section extraction and transformation
 * - Constraint, risk, test plan, and rollout plan generation
 * - Unknown detection and diagnostics
 * - Approval workflow with hash verification
 * - File persistence and atomicity
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  composeSpecification,
  recordSpecApproval,
  loadSpecMetadata,
  isSpecApproved,
  getSpecApprovals,
  type SpecComposerConfig,
  type RecordSpecApprovalOptions,
} from '../../src/workflows/specComposer';
import { createFeature, type Feature } from '../../src/core/models/Feature';
import type { ContextDocument } from '../../src/core/models/ContextDocument';
import type { ResearchTask } from '../../src/core/models/ResearchTask';
import { createDefaultConfig, type RepoConfig } from '../../src/core/config/RepoConfig';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { MetricsCollector } from '../../src/telemetry/metrics';
import { computeFileHash } from '../../src/persistence/hashManifest';

// ============================================================================
// Test Setup
// ============================================================================

vi.mock('node:fs/promises');
vi.mock('../../src/persistence/hashManifest', () => ({
  computeFileHash: vi
    .fn()
    .mockResolvedValue('abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234'),
}));
vi.mock('../../src/persistence/runDirectoryManager', () => ({
  withLock: vi.fn(async (_runDir: string, fn: () => Promise<unknown>) => await fn()),
  getSubdirectoryPath: vi.fn((runDir: string, subdir: string) => `${runDir}/${subdir}`),
}));

const mockLogger: StructuredLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockMetrics: MetricsCollector = {
  increment: vi.fn(),
  gauge: vi.fn(),
  histogram: vi.fn(),
  timing: vi.fn(),
};

function createMockFeature(): Feature {
  return createFeature('feat-123', 'https://github.com/test/repo.git', {
    title: 'Test Feature',
    source: 'manual:test',
  });
}

function createMockContextDocument(): ContextDocument {
  return {
    schema_version: '1.0.0',
    feature_id: 'feat-123',
    total_token_count: 750,
    files: {
      'src/main.ts': {
        path: 'src/main.ts',
        hash: 'hash1',
        size: 1024,
        token_count: 500,
        last_modified: '2025-01-15T10:00:00Z',
      },
      'src/utils.ts': {
        path: 'src/utils.ts',
        hash: 'hash2',
        size: 512,
        token_count: 250,
        last_modified: '2025-01-15T10:00:00Z',
      },
    },
    metadata: {
      total_files: 2,
      total_tokens: 750,
      manifest_hash: 'manifest-hash',
    },
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:00:00Z',
    provenance: {
      source: 'cli-test',
      captured_at: '2025-01-15T10:00:00Z',
    },
  };
}

function createMockResearchTask(): ResearchTask {
  return {
    schema_version: '1.0.0',
    task_id: 'RT-001',
    feature_id: 'feat-123',
    title: 'Research scalability requirements',
    objectives: ['Determine concurrent user targets', 'Identify performance bottlenecks'],
    status: 'completed',
    sources: [
      {
        type: 'documentation',
        identifier: 'architecture-docs',
      },
    ],
    results: {
      summary: 'System must support 10,000 concurrent users with P95 latency < 500ms',
      findings: ['Current capacity: 1,000 users', 'Scaling requires load balancer'],
      sources_consulted: ['architecture-docs'],
      confidence_score: 0.85,
      retrieved_at: '2025-01-15T10:30:00Z',
    },
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:30:00Z',
  };
}

function createMockRepoConfig(): RepoConfig {
  const baseConfig = createDefaultConfig('https://github.com/test/repo.git');

  return {
    ...baseConfig,
    project: {
      ...baseConfig.project,
      context_paths: ['src/', 'docs/', 'tests/'],
    },
    runtime: {
      ...baseConfig.runtime,
      max_concurrent_tasks: 4,
    },
    safety: {
      ...baseConfig.safety,
      allowed_file_patterns: ['src/**/*.ts', 'docs/**/*.md', 'tests/**/*.ts'],
      blocked_file_patterns: ['secrets/**', ...baseConfig.safety.blocked_file_patterns],
    },
    constraints: {
      max_file_size_kb: 2048,
      max_context_files: 200,
      rate_limits: {
        github_requests_per_hour: 5000,
        linear_requests_per_minute: 90,
        agent_requests_per_hour: 120,
      },
    },
  };
}

const mockPRDMarkdown = `---
feature_id: feat-123
---

# Product Requirements Document: Test Feature

## Problem Statement

Users need faster data processing to improve productivity.

## Goals

- Reduce processing time by 50%
- Support 10,000 concurrent users
- Improve API response time

## Non-Goals

- Mobile app development
- Real-time streaming

## Success Criteria & Acceptance Criteria

- P95 latency < 500ms
- 99.9% uptime
- Zero data loss

## Risks & Mitigations

- **High Risk:** Scalability concerns under load
  - Mitigation: Implement horizontal scaling
- **Medium Risk:** Database bottlenecks
  - Mitigation: Add caching layer

## Open Questions

- What is the expected peak traffic?
- Should we support multi-region deployment?
`;

const mockPRDMetadata = {
  featureId: 'feat-123',
  prdHash: 'prd-hash-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  createdAt: '2025-01-15T09:00:00Z',
  updatedAt: '2025-01-15T09:00:00Z',
  approvalStatus: 'approved' as const,
  approvals: ['APR-001'],
  version: '1.0.0',
  traceId: 'TRACE-001',
};

// ============================================================================
// Tests
// ============================================================================

describe('Specification Composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock file system operations
    vi.mocked(fs.readFile).mockImplementation((filePath: string) => {
      if (filePath.includes('prd_metadata.json')) {
        return Promise.resolve(JSON.stringify(mockPRDMetadata));
      }
      if (filePath.includes('prd.md')) {
        return Promise.resolve(mockPRDMarkdown);
      }
      return Promise.reject(new Error(`File not found: ${filePath}`));
    });

    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('composeSpecification', () => {
    it('should throw error when PRD is not approved', async () => {
      const unapprovedMetadata = { ...mockPRDMetadata, approvalStatus: 'pending' as const };

      vi.mocked(fs.readFile).mockImplementation((filePath: string) => {
        if (filePath.includes('prd_metadata.json')) {
          return Promise.resolve(JSON.stringify(unapprovedMetadata));
        }
        return Promise.reject(new Error(`File not found: ${filePath}`));
      });

      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      await expect(composeSpecification(config, mockLogger, mockMetrics)).rejects.toThrow(
        'PRD must be approved'
      );
    });

    it('should generate spec with all required sections', async () => {
      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [createMockResearchTask()],
        repoConfig: createMockRepoConfig(),
      };

      const result = await composeSpecification(config, mockLogger, mockMetrics);

      expect(result.specification).toBeDefined();
      expect(result.specification.spec_id).toMatch(/^SPEC-/);
      expect(result.specification.feature_id).toBe('feat-123');
      expect(result.specification.status).toBe('draft');

      // Verify sections
      expect(result.specification.content).toContain('## Overview');
      expect(result.specification.content).toContain('## Goals');
      expect(result.specification.content).toContain('## Acceptance Criteria');

      // Verify constraints
      expect(result.specification.risks.length).toBeGreaterThan(0);
      expect(result.specification.test_plan.length).toBeGreaterThan(0);
      expect(result.specification.rollout_plan).toBeDefined();
      expect(result.specification.change_log.length).toBe(1);
      expect(result.specification.change_log[0].author).toContain('spec-composer');
      expect(result.specification.change_log[0].description).toContain('PRD hash');
    });

    it('should extract technical constraints from repo config and context', async () => {
      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      const result = await composeSpecification(config, mockLogger, mockMetrics);

      // Check that constraints are present in diagnostics or metadata
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics.totalCitations).toBeGreaterThan(0);
    });

    it('should generate risk assessments with correct severity levels', async () => {
      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [createMockResearchTask()],
        repoConfig: createMockRepoConfig(),
      };

      const result = await composeSpecification(config, mockLogger, mockMetrics);

      expect(result.specification.risks.length).toBeGreaterThan(0);

      const highRisk = result.specification.risks.find((r) => r.severity === 'high');
      expect(highRisk).toBeDefined();
      expect(highRisk?.description).toContain('Scalability');
    });

    it('should generate test plan with unit, integration, and e2e tests', async () => {
      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      const result = await composeSpecification(config, mockLogger, mockMetrics);

      expect(result.specification.test_plan.length).toBeGreaterThan(0);

      const unitTests = result.specification.test_plan.filter((t) => t.test_type === 'unit');
      const integrationTests = result.specification.test_plan.filter(
        (t) => t.test_type === 'integration'
      );
      const e2eTests = result.specification.test_plan.filter((t) => t.test_type === 'e2e');

      expect(unitTests.length).toBeGreaterThan(0);
      expect(integrationTests.length).toBeGreaterThan(0);
      expect(e2eTests.length).toBeGreaterThan(0);
    });

    it('should use canary rollout strategy for high-risk features', async () => {
      const highRiskPRD = mockPRDMarkdown.replace('High Risk:', 'Critical Risk:');

      vi.mocked(fs.readFile).mockImplementation((filePath: string) => {
        if (filePath.includes('prd_metadata.json')) {
          return Promise.resolve(JSON.stringify(mockPRDMetadata));
        }
        if (filePath.includes('prd.md')) {
          return Promise.resolve(highRiskPRD);
        }
        return Promise.reject(new Error(`File not found: ${filePath}`));
      });

      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      const result = await composeSpecification(config, mockLogger, mockMetrics);

      expect(result.specification.rollout_plan?.strategy).toBe('canary');
      expect(result.specification.rollout_plan?.phases.length).toBeGreaterThan(0);
      expect(result.specification.rollout_plan?.rollback_plan).toBeDefined();
    });

    it('should detect unknowns from TODO markers', async () => {
      const prdWithTodos =
        mockPRDMarkdown +
        '\n\nTODO: Define performance benchmarks\nTBD: Clarify authentication requirements';

      vi.mocked(fs.readFile).mockImplementation((filePath: string) => {
        if (filePath.includes('prd_metadata.json')) {
          return Promise.resolve(JSON.stringify(mockPRDMetadata));
        }
        if (filePath.includes('prd.md')) {
          return Promise.resolve(prdWithTodos);
        }
        return Promise.reject(new Error(`File not found: ${filePath}`));
      });

      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      const result = await composeSpecification(config, mockLogger, mockMetrics);

      expect(result.diagnostics.unknowns.length).toBeGreaterThan(0);
      expect(result.diagnostics.warnings.length).toBeGreaterThan(0);

      const todoUnknown = result.diagnostics.unknowns.find((u) =>
        u.description.includes('performance benchmarks')
      );
      expect(todoUnknown).toBeDefined();
    });

    it('should persist spec.md, spec.json, and spec_metadata.json', async () => {
      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      await composeSpecification(config, mockLogger, mockMetrics);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('spec.md'),
        expect.any(String),
        'utf-8'
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('spec.json'),
        expect.any(String),
        'utf-8'
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('spec_metadata.json'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should include referenced file globs in spec markdown', async () => {
      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      await composeSpecification(config, mockLogger, mockMetrics);

      const specWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find(
          ([filePath]) => typeof filePath === 'string' && filePath.includes('spec.md')
        );

      expect(specWriteCall).toBeDefined();
      const [, markdown] = specWriteCall!;
      expect(typeof markdown).toBe('string');
      const markdownContent = markdown as string;
      expect(markdownContent).toContain('## Referenced File Globs');
      expect(markdownContent).toContain('src/**/*.ts');
    });

    it('should compute and store SHA-256 hash', async () => {
      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      const result = await composeSpecification(config, mockLogger, mockMetrics);

      expect(result.specHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should include traceability links to PRD', async () => {
      const config: SpecComposerConfig = {
        repoRoot: '/test/repo',
        runDir: '/test/runs/feat-123',
        feature: createMockFeature(),
        contextDocument: createMockContextDocument(),
        researchTasks: [],
        repoConfig: createMockRepoConfig(),
      };

      const result = await composeSpecification(config, mockLogger, mockMetrics);

      expect(result.specification.metadata?.prdHash).toBe(mockPRDMetadata.prdHash);
      expect(result.specification.metadata?.traceId).toBe(mockPRDMetadata.traceId);
    });
  });

  describe('recordSpecApproval', () => {
    beforeEach(() => {
      const mockSpecMetadata = {
        featureId: 'feat-123',
        specId: 'SPEC-001',
        specHash: 'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234',
        prdHash: mockPRDMetadata.prdHash,
        createdAt: '2025-01-15T11:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        approvalStatus: 'pending',
        approvals: [],
        version: '1.0.0',
        traceId: 'TRACE-001',
      };

      vi.mocked(fs.readFile).mockImplementation((filePath: string) => {
        if (filePath.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(mockSpecMetadata));
        }
        if (filePath.includes('spec.md')) {
          return Promise.resolve('# Spec content');
        }
        return Promise.reject(new Error(`File not found: ${filePath}`));
      });
    });

    it('should create approval record with correct metadata', async () => {
      const options: RecordSpecApprovalOptions = {
        signer: 'test-user',
        signerName: 'Test User',
        verdict: 'approved',
        rationale: 'Looks good',
      };

      const record = await recordSpecApproval(
        '/test/runs/feat-123',
        'feat-123',
        options,
        mockLogger,
        mockMetrics
      );

      expect(record.approval_id).toMatch(/^APR-/);
      expect(record.feature_id).toBe('feat-123');
      expect(record.gate_type).toBe('spec');
      expect(record.verdict).toBe('approved');
      expect(record.signer).toBe('test-user');
      expect(record.rationale).toBe('Looks good');

      const approvalsIndexWrite = vi
        .mocked(fs.writeFile)
        .mock.calls.find(
          ([filePath]) => typeof filePath === 'string' && filePath.endsWith('approvals.json')
        );
      expect(approvalsIndexWrite).toBeDefined();
    });

    it('should update metadata approval status', async () => {
      const options: RecordSpecApprovalOptions = {
        signer: 'test-user',
        verdict: 'approved',
      };

      await recordSpecApproval('/test/runs/feat-123', 'feat-123', options, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find(
          ([filePath]) => typeof filePath === 'string' && filePath.includes('spec_metadata.json')
        );

      expect(writeCall).toBeDefined();
      const [, metadataPayload] = writeCall!;
      expect(typeof metadataPayload).toBe('string');
      const parsedMetadata = JSON.parse(metadataPayload as string) as {
        approvalStatus: string;
        approvals: unknown[];
      };
      expect(parsedMetadata.approvalStatus).toBe('approved');
      expect(parsedMetadata.approvals).toHaveLength(1);
    });

    it('should throw error if spec hash mismatched', async () => {
      // Mock different hash
      vi.mocked(computeFileHash).mockResolvedValueOnce('different-hash-1234567890');

      const options: RecordSpecApprovalOptions = {
        signer: 'test-user',
        verdict: 'approved',
      };

      await expect(
        recordSpecApproval('/test/runs/feat-123', 'feat-123', options, mockLogger, mockMetrics)
      ).rejects.toThrow('Spec content has changed');
    });

    it('should support rejection verdict', async () => {
      const options: RecordSpecApprovalOptions = {
        signer: 'test-user',
        verdict: 'rejected',
        rationale: 'Needs more detail on constraints',
      };

      const record = await recordSpecApproval(
        '/test/runs/feat-123',
        'feat-123',
        options,
        mockLogger,
        mockMetrics
      );

      expect(record.verdict).toBe('rejected');

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find(
          ([filePath]) => typeof filePath === 'string' && filePath.includes('spec_metadata.json')
        );

      expect(writeCall).toBeDefined();
      const [, metadataPayload] = writeCall!;
      expect(typeof metadataPayload).toBe('string');
      const parsedMetadata = JSON.parse(metadataPayload as string) as { approvalStatus: string };
      expect(parsedMetadata.approvalStatus).toBe('rejected');
    });

    it('should support requested_changes verdict', async () => {
      const options: RecordSpecApprovalOptions = {
        signer: 'test-user',
        verdict: 'requested_changes',
        rationale: 'Add more test cases',
      };

      const record = await recordSpecApproval(
        '/test/runs/feat-123',
        'feat-123',
        options,
        mockLogger,
        mockMetrics
      );

      expect(record.verdict).toBe('requested_changes');

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find(
          ([filePath]) => typeof filePath === 'string' && filePath.includes('spec_metadata.json')
        );

      expect(writeCall).toBeDefined();
      const [, metadataPayload] = writeCall!;
      expect(typeof metadataPayload).toBe('string');
      const parsedMetadata = JSON.parse(metadataPayload as string) as { approvalStatus: string };
      expect(parsedMetadata.approvalStatus).toBe('changes_requested');
    });
  });

  describe('loadSpecMetadata', () => {
    it('should load metadata from spec_metadata.json', async () => {
      const mockSpecMetadata = {
        featureId: 'feat-123',
        specId: 'SPEC-001',
        specHash: 'spec-hash-123',
        prdHash: 'prd-hash-123',
        createdAt: '2025-01-15T11:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        approvalStatus: 'pending',
        approvals: [],
        version: '1.0.0',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSpecMetadata));

      const metadata = await loadSpecMetadata('/test/runs/feat-123');

      expect(metadata).toEqual(mockSpecMetadata);
    });

    it('should return null if metadata file not found', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const metadata = await loadSpecMetadata('/test/runs/feat-123');

      expect(metadata).toBeNull();
    });
  });

  describe('isSpecApproved', () => {
    it('should return true when spec is approved', async () => {
      const mockSpecMetadata = {
        featureId: 'feat-123',
        specId: 'SPEC-001',
        specHash: 'spec-hash-123',
        prdHash: 'prd-hash-123',
        createdAt: '2025-01-15T11:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        approvalStatus: 'approved',
        approvals: ['APR-001'],
        version: '1.0.0',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSpecMetadata));

      const approved = await isSpecApproved('/test/runs/feat-123');

      expect(approved).toBe(true);
    });

    it('should return false when spec is pending', async () => {
      const mockSpecMetadata = {
        featureId: 'feat-123',
        specId: 'SPEC-001',
        specHash: 'spec-hash-123',
        prdHash: 'prd-hash-123',
        createdAt: '2025-01-15T11:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        approvalStatus: 'pending',
        approvals: [],
        version: '1.0.0',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSpecMetadata));

      const approved = await isSpecApproved('/test/runs/feat-123');

      expect(approved).toBe(false);
    });
  });

  describe('getSpecApprovals', () => {
    it('should return all spec approval records', async () => {
      const mockSpecMetadata = {
        featureId: 'feat-123',
        specId: 'SPEC-001',
        specHash: 'spec-hash-123',
        prdHash: 'prd-hash-123',
        createdAt: '2025-01-15T11:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        approvalStatus: 'approved',
        approvals: ['APR-001', 'APR-002'],
        version: '1.0.0',
      };

      const mockApproval1 = {
        schema_version: '1.0.0',
        approval_id: 'APR-001',
        feature_id: 'feat-123',
        gate_type: 'spec',
        verdict: 'requested_changes',
        signer: 'user1',
        approved_at: '2025-01-15T11:00:00Z',
      };

      const mockApproval2 = {
        schema_version: '1.0.0',
        approval_id: 'APR-002',
        feature_id: 'feat-123',
        gate_type: 'spec',
        verdict: 'approved',
        signer: 'user2',
        approved_at: '2025-01-15T12:00:00Z',
      };

      vi.mocked(fs.readFile).mockImplementation((filePath: string) => {
        if (filePath.includes('spec_metadata.json')) {
          return Promise.resolve(JSON.stringify(mockSpecMetadata));
        }
        if (filePath.includes('APR-001.json')) {
          return Promise.resolve(JSON.stringify(mockApproval1));
        }
        if (filePath.includes('APR-002.json')) {
          return Promise.resolve(JSON.stringify(mockApproval2));
        }
        return Promise.reject(new Error(`File not found: ${filePath}`));
      });

      const approvals = await getSpecApprovals('/test/runs/feat-123');

      expect(approvals.length).toBe(2);
      expect(approvals[0].approval_id).toBe('APR-001');
      expect(approvals[1].approval_id).toBe('APR-002');
    });

    it('should return empty array when no approvals exist', async () => {
      const mockSpecMetadata = {
        featureId: 'feat-123',
        specId: 'SPEC-001',
        specHash: 'spec-hash-123',
        prdHash: 'prd-hash-123',
        createdAt: '2025-01-15T11:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        approvalStatus: 'pending',
        approvals: [],
        version: '1.0.0',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSpecMetadata));

      const approvals = await getSpecApprovals('/test/runs/feat-123');

      expect(approvals).toEqual([]);
    });
  });
});
