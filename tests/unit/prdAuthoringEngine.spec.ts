/**
 * Unit Tests for PRD Authoring Engine
 *
 * Tests the PRD authoring workflow including:
 * - PRD document generation (draftPRD)
 * - Template loading and variable substitution
 * - Context and research citation formatting
 * - Section generation with TODO markers
 * - Approval recording with hash verification
 * - Metadata persistence and loading
 * - Approval status checks
 * - Edge cases and error paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  draftPRD,
  recordPRDApproval,
  loadPRDMetadata,
  isPRDApproved,
  getPRDApprovals,
  type PRDAuthoringConfig,
  type PRDMetadata,
  type PRDSectionType,
  type RecordApprovalOptions,
} from '../../src/workflows/prdAuthoringEngine';
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
vi.mock('../../src/persistence/lockManager', () => ({
  withLock: vi.fn(async (_runDir: string, fn: () => Promise<unknown>) => await fn()),
}));
vi.mock('../../src/persistence/runLifecycle', () => ({
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

// ============================================================================
// Helpers
// ============================================================================

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
        hash: 'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234',
        size: 1024,
        token_count: 500,
      },
      'src/utils.ts': {
        path: 'src/utils.ts',
        hash: 'ef001234567890abcd1234567890abcd1234567890abcd1234567890ef001234',
        size: 512,
        token_count: 250,
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
  } as ContextDocument;
}

function createMockResearchTask(overrides?: Partial<ResearchTask>): ResearchTask {
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
      sources_consulted: [
        {
          type: 'documentation',
          identifier: 'architecture-docs',
        },
      ],
      confidence_score: 0.85,
      timestamp: '2025-01-15T10:30:00Z',
    },
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:30:00Z',
    ...overrides,
  } as ResearchTask;
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

const MOCK_TEMPLATE = `# PRD: {{TITLE}}

**Feature ID:** {{FEATURE_ID}}
**Status:** {{STATUS}}
**Author:** {{AUTHOR}}
**Created:** {{CREATED_AT}}
**Updated:** {{UPDATED_AT}}

## Problem Statement
{{PROBLEM_STATEMENT}}

## Goals
{{GOALS}}

## Non-Goals
{{NON_GOALS}}

## Acceptance Criteria
{{ACCEPTANCE_CRITERIA}}

## Risks
{{RISKS}}

## Open Questions
{{OPEN_QUESTIONS}}

## Context Citations
{{CONTEXT_CITATIONS}}

## Research Citations
{{RESEARCH_CITATIONS}}

## Traceability
- Trace ID: {{TRACE_ID}}
- Spec Links: {{SPEC_LINKS}}
- Task Links: {{TASK_LINKS}}

## Approval
- Status: {{APPROVAL_STATUS}}
- Approved By: {{APPROVED_BY}}
- Date: {{APPROVAL_DATE}}
- Hash: {{APPROVAL_HASH}}
`;

function createMockConfig(overrides?: Partial<PRDAuthoringConfig>): PRDAuthoringConfig {
  return {
    repoRoot: '/tmp/test-repo',
    runDir: '/tmp/test-repo/.runs/run-001',
    feature: createMockFeature(),
    contextDocument: createMockContextDocument(),
    researchTasks: [createMockResearchTask()],
    repoConfig: createMockRepoConfig(),
    ...overrides,
  };
}

function createMockMetadata(overrides?: Partial<PRDMetadata>): PRDMetadata {
  return {
    featureId: 'feat-123',
    prdHash: 'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    approvalStatus: 'pending',
    approvals: [],
    version: '1.0.0',
    traceId: 'TRACE-123-abc',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PRD Authoring Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue(MOCK_TEMPLATE);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // draftPRD
  // ==========================================================================

  describe('draftPRD', () => {
    it('should generate a PRD document with correct structure', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdDocument).toBeDefined();
      expect(result.prdDocument.featureId).toBe('feat-123');
      expect(result.prdDocument.title).toBe('Test Feature');
      expect(result.prdDocument.author).toBe('codemachine-pipeline');
      expect(result.prdDocument.status).toBe('draft');
      expect(result.prdDocument.version).toBe('1.0.0');
    });

    it('should include all six required sections', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      const expectedSections: PRDSectionType[] = [
        'problem_statement',
        'goals',
        'non_goals',
        'acceptance_criteria',
        'risks',
        'open_questions',
      ];

      for (const section of expectedSections) {
        expect(result.prdDocument.sections[section]).toBeDefined();
        expect(result.prdDocument.sections[section].type).toBe(section);
        expect(result.prdDocument.sections[section].title).toBeTruthy();
        expect(result.prdDocument.sections[section].content).toBeTruthy();
      }
    });

    it('should generate default section content with TODO markers', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      for (const section of Object.values(result.prdDocument.sections)) {
        expect(section.content).toContain('_TODO:');
      }
    });

    it('should assign a trace ID to the document', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdDocument.traceId).toBeDefined();
      expect(result.prdDocument.traceId).toMatch(/^TRACE-/);
    });

    it('should return correct file paths', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdPath).toBe('/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      expect(result.metadataPath).toBe('/tmp/test-repo/.runs/run-001/artifacts/prd_metadata.json');
    });

    it('should return the computed file hash', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdHash).toBe(
        'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234'
      );
      expect(computeFileHash).toHaveBeenCalled();
    });

    it('should create the artifacts directory', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      expect(fs.mkdir).toHaveBeenCalledWith('/tmp/test-repo/.runs/run-001/artifacts', {
        recursive: true,
      });
    });

    it('should write the rendered markdown and metadata to disk', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      // prd.md write
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/tmp/test-repo/.runs/run-001/artifacts/prd.md',
        expect.any(String),
        'utf-8'
      );

      // prd_metadata.json write
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/tmp/test-repo/.runs/run-001/artifacts/prd_metadata.json',
        expect.any(String),
        'utf-8'
      );
    });

    it('should perform template variable substitution', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      expect(writeCall).toBeDefined();
      if (!writeCall) {
        throw new Error('Expected writeCall to be defined');
      }
      const renderedMarkdown = writeCall[1] as string;

      expect(renderedMarkdown).toContain('# PRD: Test Feature');
      expect(renderedMarkdown).toContain('**Feature ID:** feat-123');
      expect(renderedMarkdown).toContain('**Status:** draft');
      expect(renderedMarkdown).toContain('**Author:** codemachine-pipeline');
    });

    it('should include context citations in the rendered output', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      if (!writeCall) {
        throw new Error('Expected writeCall to be found');
      }
      const renderedMarkdown = writeCall[1] as string;

      expect(renderedMarkdown).toContain('`src/main.ts`');
      expect(renderedMarkdown).toContain('`src/utils.ts`');
    });

    it('should include research citations in the rendered output', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      if (!writeCall) {
        throw new Error('Expected writeCall to be defined');
      }
      const renderedMarkdown = writeCall[1] as string;

      expect(renderedMarkdown).toContain('Research scalability requirements');
      expect(renderedMarkdown).toContain('RT-001');
      expect(renderedMarkdown).toContain('85%');
    });

    it('should detect all incomplete sections as having TODO markers', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      // All default sections contain TODO markers
      expect(result.diagnostics.incompleteSections).toHaveLength(6);
      expect(result.diagnostics.incompleteSections).toContain('problem_statement');
      expect(result.diagnostics.incompleteSections).toContain('goals');
      expect(result.diagnostics.incompleteSections).toContain('non_goals');
      expect(result.diagnostics.incompleteSections).toContain('acceptance_criteria');
      expect(result.diagnostics.incompleteSections).toContain('risks');
      expect(result.diagnostics.incompleteSections).toContain('open_questions');
    });

    it('should report usedAgent as false when no agent is used', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.diagnostics.usedAgent).toBe(false);
    });

    it('should count total citations from context files and research tasks', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      // 2 context files + 1 research task = 3
      expect(result.diagnostics.totalCitations).toBe(3);
    });

    it('should add a warning when sections have TODO markers', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.diagnostics.warnings.length).toBeGreaterThan(0);
      expect(result.diagnostics.warnings[0]).toContain('TODO markers');
    });

    it('should add a warning when some research tasks are not completed', async () => {
      const pendingTask = createMockResearchTask({ status: 'pending' });
      const config = createMockConfig({ researchTasks: [pendingTask] });
      const result = await draftPRD(config, mockLogger, mockMetrics);

      const researchWarning = result.diagnostics.warnings.find((w) =>
        w.includes('research tasks are not yet completed')
      );
      expect(researchWarning).toBeDefined();
    });

    it('should not add research warning when all tasks are completed', async () => {
      const completedTask = createMockResearchTask({ status: 'completed' });
      const config = createMockConfig({ researchTasks: [completedTask] });
      const result = await draftPRD(config, mockLogger, mockMetrics);

      const researchWarning = result.diagnostics.warnings.find((w) =>
        w.includes('research tasks are not yet completed')
      );
      expect(researchWarning).toBeUndefined();
    });

    it('should log info messages at start and completion', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting PRD authoring',
        expect.objectContaining({ featureId: 'feat-123' })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'PRD draft completed',
        expect.objectContaining({ featureId: 'feat-123' })
      );
    });

    it('should increment prd_drafts_generated_total metric', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      expect(mockMetrics.increment).toHaveBeenCalledWith('prd_drafts_generated_total', {
        feature_id: 'feat-123',
      });
    });

    it('should use "Untitled Feature" when feature title is missing', async () => {
      const feature = createMockFeature();
      // Remove the title by creating a feature without it
      const featureWithoutTitle = { ...feature, title: undefined } as unknown as Feature;
      const config = createMockConfig({ feature: featureWithoutTitle });
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdDocument.title).toBe('Untitled Feature');
    });

    it('should persist metadata with correct structure', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      const metadataWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find(
          (call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd_metadata.json'
        );
      expect(metadataWriteCall).toBeDefined();

      if (!metadataWriteCall) {
        throw new Error('Expected metadataWriteCall to be defined');
      }
      const metadata = JSON.parse(metadataWriteCall[1] as string) as PRDMetadata;
      expect(metadata.featureId).toBe('feat-123');
      expect(metadata.approvalStatus).toBe('pending');
      expect(metadata.approvals).toEqual([]);
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.prdHash).toBe(
        'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234'
      );
      expect(metadata.traceId).toMatch(/^TRACE-/);
    });

    it('should store document metadata including context hash and research IDs', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdDocument.metadata).toEqual(
        expect.objectContaining({
          contextDocumentHash: 'manifest-hash',
          researchTaskIds: ['RT-001'],
        })
      );
    });

    it('should load a custom template when templatePath is provided', async () => {
      const config = createMockConfig({ templatePath: '/custom/template.md' });
      await draftPRD(config, mockLogger, mockMetrics);

      expect(fs.readFile).toHaveBeenCalledWith('/custom/template.md', 'utf-8');
    });

    it('should throw when template file cannot be loaded', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('File not found'));

      const config = createMockConfig({ templatePath: '/nonexistent/template.md' });

      await expect(draftPRD(config, mockLogger, mockMetrics)).rejects.toThrow(
        'Failed to load PRD template from /nonexistent/template.md: File not found'
      );
    });

    it('should throw a descriptive error for non-Error template load failures', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce('string error');

      const config = createMockConfig({ templatePath: '/bad/template.md' });

      await expect(draftPRD(config, mockLogger, mockMetrics)).rejects.toThrow(
        'Failed to load PRD template from /bad/template.md: Unknown error'
      );
    });

    it('should handle empty context document files', async () => {
      const emptyContext: ContextDocument = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        total_token_count: 0,
        files: {},
        metadata: {},
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-15T10:00:00Z',
        provenance: {
          source: 'cli-test',
          captured_at: '2025-01-15T10:00:00Z',
        },
      } as ContextDocument;

      const config = createMockConfig({ contextDocument: emptyContext });
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.diagnostics.totalCitations).toBe(1); // 0 files + 1 research task

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      if (!writeCall) {
        throw new Error('Expected writeCall to be defined');
      }
      const rendered = writeCall[1] as string;
      expect(rendered).toContain('_No context files available._');
    });

    it('should handle empty research tasks', async () => {
      const config = createMockConfig({ researchTasks: [] });
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.diagnostics.totalCitations).toBe(2); // 2 files + 0 research tasks

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      if (!writeCall) {
        throw new Error('Expected fs.writeFile to be called for prd.md');
      }
      const rendered = writeCall[1] as string;
      expect(rendered).toContain('_No research tasks available._');
    });

    it('should show pending message when research tasks exist but none are completed', async () => {
      const pendingTask = createMockResearchTask({ status: 'in_progress', results: undefined });
      const config = createMockConfig({ researchTasks: [pendingTask] });
      await draftPRD(config, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      if (!writeCall) {
        throw new Error('Expected writeCall for prd.md to be defined');
      }
      const rendered = writeCall[1] as string;
      expect(rendered).toContain('_Research tasks pending completion._');
    });

    it('should truncate context citations to top 10 files and show overflow message', async () => {
      const files: Record<string, unknown> = {};
      for (let i = 0; i < 15; i++) {
        files[`src/file${i}.ts`] = {
          path: `src/file${i}.ts`,
          hash: `abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd12${String(i).padStart(2, '0')}`,
          size: 100,
          token_count: 100 + i,
        };
      }

      const bigContext = {
        schema_version: '1.0.0',
        feature_id: 'feat-123',
        total_token_count: 1500,
        files,
        metadata: {},
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-15T10:00:00Z',
        provenance: {
          source: 'cli-test',
          captured_at: '2025-01-15T10:00:00Z',
        },
      } as unknown as ContextDocument;

      const config = createMockConfig({ contextDocument: bigContext });
      await draftPRD(config, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      if (!writeCall) {
        throw new Error('Expected write call for prd.md to be defined');
      }
      const rendered = writeCall[1] as string;
      expect(rendered).toContain('...and 5 more files');
    });

    it('should substitute all template variables including traceability fields', async () => {
      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => call[0] === '/tmp/test-repo/.runs/run-001/artifacts/prd.md');
      if (!writeCall) {
        throw new Error('Expected writeCall for prd.md to be defined');
      }
      const rendered = writeCall[1] as string;

      // Should not contain any unresolved placeholders from our template
      expect(rendered).not.toContain('{{FEATURE_ID}}');
      expect(rendered).not.toContain('{{TITLE}}');
      expect(rendered).not.toContain('{{STATUS}}');
      expect(rendered).not.toContain('{{AUTHOR}}');
      expect(rendered).toContain('Pending Approval');
      expect(rendered).toContain('_Specification pending PRD approval_');
      expect(rendered).toContain('_Execution tasks pending spec approval_');
    });

    it('should set timestamps on the PRD document', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdDocument.createdAt).toBeTruthy();
      expect(result.prdDocument.updatedAt).toBeTruthy();
      // createdAt and updatedAt should be the same for new documents
      expect(result.prdDocument.createdAt).toBe(result.prdDocument.updatedAt);
    });
  });

  // ==========================================================================
  // recordPRDApproval
  // ==========================================================================

  describe('recordPRDApproval', () => {
    const runDir = '/tmp/test-repo/.runs/run-001';

    beforeEach(() => {
      const metadata = createMockMetadata();
      vi.mocked(fs.readFile).mockImplementation(async (filePath: unknown) => {
        const pathStr = String(filePath);
        if (pathStr.endsWith('prd_metadata.json')) {
          return JSON.stringify(metadata);
        }
        if (pathStr.endsWith('approvals.json')) {
          throw new Error('ENOENT');
        }
        return '';
      });
    });

    it('should create an approval record with the correct verdict', async () => {
      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      const record = await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      expect(record.verdict).toBe('approved');
      expect(record.signer).toBe('reviewer@test.com');
      expect(record.gate_type).toBe('prd');
      expect(record.feature_id).toBe('feat-123');
    });

    it('should write the approval record to the approvals directory', async () => {
      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('approvals'), {
        recursive: true,
      });

      const approvalWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).includes('approvals/APR-'));
      expect(approvalWriteCall).toBeDefined();
    });

    it('should update metadata approval status to approved', async () => {
      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      const metadataWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).endsWith('prd_metadata.json'));
      expect(metadataWriteCall).toBeDefined();

      if (!metadataWriteCall) {
        throw new Error('Expected metadata write call to prd_metadata.json');
      }

      const updatedMetadata = JSON.parse(metadataWriteCall[1] as string) as PRDMetadata;
      expect(updatedMetadata.approvalStatus).toBe('approved');
      expect(updatedMetadata.approvals).toHaveLength(1);
    });

    it('should update metadata approval status to rejected', async () => {
      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'rejected',
      };

      await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      const metadataWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).endsWith('prd_metadata.json'));
      if (!metadataWriteCall) {
        throw new Error('Expected a writeFile call for prd_metadata.json');
      }
      const updatedMetadata = JSON.parse(metadataWriteCall[1] as string) as PRDMetadata;
      expect(updatedMetadata.approvalStatus).toBe('rejected');
    });

    it('should update metadata approval status to changes_requested', async () => {
      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'requested_changes',
      };

      await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      const metadataWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).endsWith('prd_metadata.json'));
      if (!metadataWriteCall) {
        throw new Error('Expected prd_metadata.json write call not found');
      }
      const updatedMetadata = JSON.parse(metadataWriteCall[1] as string) as PRDMetadata;
      expect(updatedMetadata.approvalStatus).toBe('changes_requested');
    });

    it('should include optional signer name, rationale, and metadata', async () => {
      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        signerName: 'Test Reviewer',
        verdict: 'approved',
        rationale: 'Looks good to me',
        metadata: { priority: 'high' },
      };

      const record = await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      expect(record.signer_name).toBe('Test Reviewer');
      expect(record.rationale).toBe('Looks good to me');
      expect(record.metadata).toEqual({ priority: 'high' });
    });

    it('should throw when PRD metadata cannot be loaded', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      await expect(
        recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics)
      ).rejects.toThrow('Failed to load PRD metadata');
    });

    it('should throw when PRD content hash does not match metadata hash', async () => {
      vi.mocked(computeFileHash).mockResolvedValueOnce(
        'different_hash_value_0000000000000000000000000000000000000000000000000000'
      );

      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      await expect(
        recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics)
      ).rejects.toThrow('PRD content has changed since metadata was last updated');
    });

    it('should create approvals.json when it does not exist', async () => {
      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      const approvalsIndexWrite = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).endsWith('approvals.json'));
      expect(approvalsIndexWrite).toBeDefined();
      if (!approvalsIndexWrite) {
        throw new Error('Approvals write call not found');
      }
      const index = JSON.parse(approvalsIndexWrite[1] as string);
      expect(index.approvals).toHaveLength(1);
    });

    it('should append to existing approvals.json', async () => {
      const existingApprovals = {
        approvals: [
          {
            schema_version: '1.0.0',
            approval_id: 'APR-existing',
            feature_id: 'feat-123',
            gate_type: 'prd',
            verdict: 'requested_changes',
            signer: 'prev@test.com',
            approved_at: '2025-01-14T10:00:00Z',
          },
        ],
      };

      vi.mocked(fs.readFile).mockImplementation(async (filePath: unknown) => {
        const pathStr = String(filePath);
        if (pathStr.endsWith('prd_metadata.json')) {
          return JSON.stringify(createMockMetadata());
        }
        if (pathStr.endsWith('approvals.json')) {
          return JSON.stringify(existingApprovals);
        }
        return '';
      });

      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      const approvalsIndexWrite = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).endsWith('approvals.json'));
      if (!approvalsIndexWrite) {
        throw new Error('Expected writeFile to be called with approvals.json');
      }

      const index = JSON.parse(approvalsIndexWrite[1] as string);
      expect(index.approvals).toHaveLength(2);
    });

    it('should log the approval and increment the metric', async () => {
      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      await recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Recording PRD approval',
        expect.objectContaining({ featureId: 'feat-123', verdict: 'approved' })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'PRD approval recorded',
        expect.objectContaining({
          featureId: 'feat-123',
          approvalId: expect.stringContaining('APR-'),
        })
      );
      expect(mockMetrics.increment).toHaveBeenCalledWith(
        'prd_approvals_recorded_total',
        expect.objectContaining({ feature_id: 'feat-123', verdict: 'approved' })
      );
    });

    it('should handle non-Error exceptions when loading metadata', async () => {
      vi.mocked(fs.readFile).mockRejectedValue('string error');

      const options: RecordApprovalOptions = {
        signer: 'reviewer@test.com',
        verdict: 'approved',
      };

      await expect(
        recordPRDApproval(runDir, 'feat-123', options, mockLogger, mockMetrics)
      ).rejects.toThrow('Failed to load PRD metadata: Unknown error');
    });
  });

  // ==========================================================================
  // loadPRDMetadata
  // ==========================================================================

  describe('loadPRDMetadata', () => {
    const runDir = '/tmp/test-repo/.runs/run-001';

    it('should return metadata when file exists', async () => {
      const metadata = createMockMetadata();
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(metadata));

      const result = await loadPRDMetadata(runDir);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.featureId).toBe('feat-123');
        expect(result.approvalStatus).toBe('pending');
      }
    });

    it('should return null when metadata file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await loadPRDMetadata(runDir);

      expect(result).toBeNull();
    });

    it('should return null when metadata file is invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('not valid json {{{');

      // JSON.parse will throw, which is caught and returns null
      const result = await loadPRDMetadata(runDir);
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // isPRDApproved
  // ==========================================================================

  describe('isPRDApproved', () => {
    const runDir = '/tmp/test-repo/.runs/run-001';

    it('should return true when approval status is approved', async () => {
      const metadata = createMockMetadata({ approvalStatus: 'approved' });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(metadata));

      const result = await isPRDApproved(runDir);
      expect(result).toBe(true);
    });

    it('should return false when approval status is pending', async () => {
      const metadata = createMockMetadata({ approvalStatus: 'pending' });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(metadata));

      const result = await isPRDApproved(runDir);
      expect(result).toBe(false);
    });

    it('should return false when approval status is rejected', async () => {
      const metadata = createMockMetadata({ approvalStatus: 'rejected' });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(metadata));

      const result = await isPRDApproved(runDir);
      expect(result).toBe(false);
    });

    it('should return false when metadata does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await isPRDApproved(runDir);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // getPRDApprovals
  // ==========================================================================

  describe('getPRDApprovals', () => {
    const runDir = '/tmp/test-repo/.runs/run-001';

    it('should return empty array when metadata does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await getPRDApprovals(runDir);
      expect(result).toEqual([]);
    });

    it('should return empty array when metadata has no approvals', async () => {
      const metadata = createMockMetadata({ approvals: [] });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(metadata));

      const result = await getPRDApprovals(runDir);
      expect(result).toEqual([]);
    });

    it('should return approval records for valid approval files', async () => {
      const metadata = createMockMetadata({ approvals: ['APR-001'] });
      const approvalRecord = {
        schema_version: '1.0.0',
        approval_id: 'APR-001',
        feature_id: 'feat-123',
        gate_type: 'prd',
        verdict: 'approved',
        signer: 'reviewer@test.com',
        approved_at: '2025-01-15T12:00:00Z',
      };

      vi.mocked(fs.readFile).mockImplementation(async (filePath: unknown) => {
        const pathStr = String(filePath);
        if (pathStr.endsWith('prd_metadata.json')) {
          return JSON.stringify(metadata);
        }
        if (pathStr.endsWith('APR-001.json')) {
          return JSON.stringify(approvalRecord);
        }
        throw new Error('ENOENT');
      });

      const result = await getPRDApprovals(runDir);
      expect(result).toHaveLength(1);
      expect(result[0].approval_id).toBe('APR-001');
      expect(result[0].gate_type).toBe('prd');
    });

    it('should skip invalid or missing approval files', async () => {
      const metadata = createMockMetadata({ approvals: ['APR-001', 'APR-002'] });

      vi.mocked(fs.readFile).mockImplementation(async (filePath: unknown) => {
        const pathStr = String(filePath);
        if (pathStr.endsWith('prd_metadata.json')) {
          return JSON.stringify(metadata);
        }
        if (pathStr.endsWith('APR-001.json')) {
          throw new Error('ENOENT');
        }
        if (pathStr.endsWith('APR-002.json')) {
          return '{ invalid json }}}';
        }
        throw new Error('ENOENT');
      });

      const result = await getPRDApprovals(runDir);
      expect(result).toEqual([]);
    });

    it('should filter out non-PRD approval records', async () => {
      const metadata = createMockMetadata({ approvals: ['APR-001'] });
      const nonPrdApproval = {
        schema_version: '1.0.0',
        approval_id: 'APR-001',
        feature_id: 'feat-123',
        gate_type: 'spec', // not 'prd'
        verdict: 'approved',
        signer: 'reviewer@test.com',
        approved_at: '2025-01-15T12:00:00Z',
      };

      vi.mocked(fs.readFile).mockImplementation(async (filePath: unknown) => {
        const pathStr = String(filePath);
        if (pathStr.endsWith('prd_metadata.json')) {
          return JSON.stringify(metadata);
        }
        if (pathStr.endsWith('APR-001.json')) {
          return JSON.stringify(nonPrdApproval);
        }
        throw new Error('ENOENT');
      });

      const result = await getPRDApprovals(runDir);
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // Template Interpolation Edge Cases
  // ==========================================================================

  describe('template interpolation edge cases', () => {
    it('should replace multiple occurrences of the same variable', async () => {
      const templateWithDuplicates = '{{FEATURE_ID}} is {{FEATURE_ID}} and title is {{TITLE}}';
      vi.mocked(fs.readFile).mockResolvedValueOnce(templateWithDuplicates);

      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).endsWith('prd.md'));
      if (!writeCall) {
        throw new Error('fs.writeFile mock call for prd.md not found');
      }
      const rendered = writeCall[1] as string;
      expect(rendered).toBe('feat-123 is feat-123 and title is Test Feature');
    });

    it('should leave unknown placeholders untouched', async () => {
      const templateWithUnknown = '{{FEATURE_ID}} and {{UNKNOWN_VAR}}';
      vi.mocked(fs.readFile).mockResolvedValueOnce(templateWithUnknown);

      const config = createMockConfig();
      await draftPRD(config, mockLogger, mockMetrics);

      const writeCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).endsWith('prd.md'));
      if (!writeCall) {
        throw new Error('writeCall not found');
      }
      const rendered = writeCall[1] as string;
      expect(rendered).toContain('{{UNKNOWN_VAR}}');
    });

    it('should handle empty template', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('');

      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdPath).toBeDefined();
    });
  });

  // ==========================================================================
  // Section Titles
  // ==========================================================================

  describe('section titles', () => {
    it('should assign correct human-readable titles to each section', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      expect(result.prdDocument.sections.problem_statement.title).toBe('Problem Statement');
      expect(result.prdDocument.sections.goals.title).toBe('Goals');
      expect(result.prdDocument.sections.non_goals.title).toBe('Non-Goals');
      expect(result.prdDocument.sections.acceptance_criteria.title).toBe(
        'Success Criteria & Acceptance Criteria'
      );
      expect(result.prdDocument.sections.risks.title).toBe('Risks & Mitigations');
      expect(result.prdDocument.sections.open_questions.title).toBe('Open Questions');
    });
  });

  // ==========================================================================
  // Default sections initialization
  // ==========================================================================

  describe('default sections', () => {
    it('should initialize all sections with empty citations arrays', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      for (const section of Object.values(result.prdDocument.sections)) {
        expect(section.researchCitations).toEqual([]);
        expect(section.contextCitations).toEqual([]);
      }
    });

    it('should not set a confidence score on default sections', async () => {
      const config = createMockConfig();
      const result = await draftPRD(config, mockLogger, mockMetrics);

      for (const section of Object.values(result.prdDocument.sections)) {
        expect(section.confidence).toBeUndefined();
      }
    });
  });
});
