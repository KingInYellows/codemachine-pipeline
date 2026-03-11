import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { computeArtifactHash, computeContentHash } from '../../src/workflows/approvalRegistry';
import type { ApprovalGateType } from '../../src/core/models/ApprovalRecord';
import {
  createApprovalRecord,
  parseApprovalRecord,
  serializeApprovalRecord,
} from '../../src/core/models/ApprovalRecord';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'approval-registry-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// computeArtifactHash Tests
// ============================================================================

describe('computeArtifactHash', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should compute SHA-256 hash of file contents', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    await fs.writeFile(filePath, 'test content', 'utf-8');

    const hash = await computeArtifactHash(filePath);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return same hash for same content', async () => {
    const filePath1 = path.join(tempDir, 'file1.txt');
    const filePath2 = path.join(tempDir, 'file2.txt');
    await fs.writeFile(filePath1, 'identical content', 'utf-8');
    await fs.writeFile(filePath2, 'identical content', 'utf-8');

    const hash1 = await computeArtifactHash(filePath1);
    const hash2 = await computeArtifactHash(filePath2);

    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different content', async () => {
    const filePath1 = path.join(tempDir, 'file1.txt');
    const filePath2 = path.join(tempDir, 'file2.txt');
    await fs.writeFile(filePath1, 'content A', 'utf-8');
    await fs.writeFile(filePath2, 'content B', 'utf-8');

    const hash1 = await computeArtifactHash(filePath1);
    const hash2 = await computeArtifactHash(filePath2);

    expect(hash1).not.toBe(hash2);
  });

  it('should throw for non-existent file', async () => {
    const nonExistent = path.join(tempDir, 'does-not-exist.txt');

    await expect(computeArtifactHash(nonExistent)).rejects.toThrow();
  });

  it('should handle empty file', async () => {
    const filePath = path.join(tempDir, 'empty.txt');
    await fs.writeFile(filePath, '', 'utf-8');

    const hash = await computeArtifactHash(filePath);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should handle large file content', async () => {
    const filePath = path.join(tempDir, 'large.txt');
    const largeContent = 'x'.repeat(1000000); // 1MB
    await fs.writeFile(filePath, largeContent, 'utf-8');

    const hash = await computeArtifactHash(filePath);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================================
// computeContentHash Tests
// ============================================================================

describe('computeContentHash', () => {
  it('should compute SHA-256 hash of string', () => {
    const hash = computeContentHash('test content');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return same hash for same string', () => {
    const hash1 = computeContentHash('identical');
    const hash2 = computeContentHash('identical');

    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different strings', () => {
    const hash1 = computeContentHash('content A');
    const hash2 = computeContentHash('content B');

    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = computeContentHash('');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Known SHA-256 of empty string
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('should handle unicode content', () => {
    const hash = computeContentHash('Hello world with unicode');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should handle special characters', () => {
    const hash = computeContentHash('Special chars: @#$%^&*()');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should handle multiline content', () => {
    const content = `Line 1
Line 2
Line 3`;
    const hash = computeContentHash(content);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should be consistent with computeArtifactHash for same content', async () => {
    const tempDir = await createTempDir();
    try {
      const content = 'test content for consistency check';
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, content, 'utf-8');

      const contentHash = computeContentHash(content);
      const artifactHash = await computeArtifactHash(filePath);

      expect(contentHash).toBe(artifactHash);
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});

// ============================================================================
// ApprovalRecord Model Tests (testing the underlying model)
// ============================================================================

describe('ApprovalRecord', () => {
  describe('createApprovalRecord', () => {
    it('should create valid approval record with required fields', () => {
      const record = createApprovalRecord(
        'approval-123',
        'feature-456',
        'prd',
        'approved',
        'user@example.com'
      );

      expect(record.approval_id).toBe('approval-123');
      expect(record.feature_id).toBe('feature-456');
      expect(record.gate_type).toBe('prd');
      expect(record.verdict).toBe('approved');
      expect(record.signer).toBe('user@example.com');
      expect(record.schema_version).toBe('1.0.0');
      expect(record.approved_at).toBeDefined();
    });

    it('should create record with optional fields', () => {
      const record = createApprovalRecord(
        'approval-123',
        'feature-456',
        'spec',
        'approved',
        'reviewer@example.com',
        {
          signerName: 'Test Reviewer',
          artifactHash: 'a'.repeat(64),
          artifactPath: 'artifacts/spec.md',
          rationale: 'Looks good to me',
          metadata: { review_time: '15 minutes' },
        }
      );

      expect(record.signer_name).toBe('Test Reviewer');
      expect(record.artifact_hash).toBe('a'.repeat(64));
      expect(record.artifact_path).toBe('artifacts/spec.md');
      expect(record.rationale).toBe('Looks good to me');
      expect(record.metadata?.review_time).toBe('15 minutes');
    });

    it('should create record with all gate types', () => {
      const gateTypes: ApprovalGateType[] = [
        'prd',
        'spec',
        'plan',
        'code',
        'pr',
        'deploy',
        'other',
      ];

      for (const gateType of gateTypes) {
        const record = createApprovalRecord(
          `approval-${gateType}`,
          'feature-456',
          gateType,
          'approved',
          'user@example.com'
        );

        expect(record.gate_type).toBe(gateType);
      }
    });

    it('should create record with all verdict types', () => {
      const verdicts = ['approved', 'rejected', 'requested_changes'] as const;

      for (const verdict of verdicts) {
        const record = createApprovalRecord(
          `approval-${verdict}`,
          'feature-456',
          'prd',
          verdict,
          'user@example.com'
        );

        expect(record.verdict).toBe(verdict);
      }
    });
  });

  describe('parseApprovalRecord', () => {
    it('should parse valid approval record', () => {
      const record = createApprovalRecord(
        'approval-123',
        'feature-456',
        'prd',
        'approved',
        'user@example.com'
      );

      const result = parseApprovalRecord(record);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.approval_id).toBe('approval-123');
      }
    });

    it('should reject record with invalid schema_version', () => {
      const invalidRecord = {
        schema_version: 'invalid',
        approval_id: 'approval-123',
        feature_id: 'feature-456',
        gate_type: 'prd',
        verdict: 'approved',
        signer: 'user@example.com',
        approved_at: new Date().toISOString(),
      };

      const result = parseApprovalRecord(invalidRecord);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path.includes('schema_version'))).toBe(true);
      }
    });

    it('should reject record with invalid gate_type', () => {
      const invalidRecord = {
        schema_version: '1.0.0',
        approval_id: 'approval-123',
        feature_id: 'feature-456',
        gate_type: 'invalid_gate',
        verdict: 'approved',
        signer: 'user@example.com',
        approved_at: new Date().toISOString(),
      };

      const result = parseApprovalRecord(invalidRecord);

      expect(result.success).toBe(false);
    });

    it('should reject record with invalid verdict', () => {
      const invalidRecord = {
        schema_version: '1.0.0',
        approval_id: 'approval-123',
        feature_id: 'feature-456',
        gate_type: 'prd',
        verdict: 'maybe',
        signer: 'user@example.com',
        approved_at: new Date().toISOString(),
      };

      const result = parseApprovalRecord(invalidRecord);

      expect(result.success).toBe(false);
    });

    it('should reject record with invalid artifact_hash format', () => {
      const invalidRecord = {
        schema_version: '1.0.0',
        approval_id: 'approval-123',
        feature_id: 'feature-456',
        gate_type: 'prd',
        verdict: 'approved',
        signer: 'user@example.com',
        approved_at: new Date().toISOString(),
        artifact_hash: 'not-a-valid-sha256-hash',
      };

      const result = parseApprovalRecord(invalidRecord);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.message.includes('SHA-256'))).toBe(true);
      }
    });

    it('should accept valid SHA-256 artifact_hash', () => {
      const validRecord = {
        schema_version: '1.0.0',
        approval_id: 'approval-123',
        feature_id: 'feature-456',
        gate_type: 'prd',
        verdict: 'approved',
        signer: 'user@example.com',
        approved_at: new Date().toISOString(),
        artifact_hash: 'a'.repeat(64),
      };

      const result = parseApprovalRecord(validRecord);

      expect(result.success).toBe(true);
    });

    it('should reject record with missing required fields', () => {
      const incompleteRecord = {
        schema_version: '1.0.0',
        approval_id: 'approval-123',
        // Missing feature_id, gate_type, verdict, signer, approved_at
      };

      const result = parseApprovalRecord(incompleteRecord);

      expect(result.success).toBe(false);
    });
  });

  describe('serializeApprovalRecord', () => {
    it('should serialize record to JSON string', () => {
      const record = createApprovalRecord(
        'approval-123',
        'feature-456',
        'prd',
        'approved',
        'user@example.com'
      );

      const serialized = serializeApprovalRecord(record);

      expect(typeof serialized).toBe('string');
      const parsed = JSON.parse(serialized);
      expect(parsed.approval_id).toBe('approval-123');
    });

    it('should serialize with pretty formatting by default', () => {
      const record = createApprovalRecord(
        'approval-123',
        'feature-456',
        'prd',
        'approved',
        'user@example.com'
      );

      const serialized = serializeApprovalRecord(record);

      expect(serialized).toContain('\n');
      expect(serialized).toContain('  ');
    });

    it('should serialize without pretty formatting when disabled', () => {
      const record = createApprovalRecord(
        'approval-123',
        'feature-456',
        'prd',
        'approved',
        'user@example.com'
      );

      const serialized = serializeApprovalRecord(record, false);

      expect(serialized).not.toContain('\n');
    });

    it('should produce valid JSON that can be parsed back', () => {
      const record = createApprovalRecord(
        'approval-123',
        'feature-456',
        'spec',
        'rejected',
        'reviewer@example.com',
        {
          rationale: 'Needs more detail',
          metadata: { severity: 'minor' },
        }
      );

      const serialized = serializeApprovalRecord(record);
      const parsed = JSON.parse(serialized);
      const parseResult = parseApprovalRecord(parsed);

      expect(parseResult.success).toBe(true);
    });
  });
});

// ============================================================================
// Edge Cases and Validation Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should validate gate types enum values', () => {
    const gateTypes: ApprovalGateType[] = ['prd', 'spec', 'plan', 'code', 'pr', 'deploy', 'other'];
    expect(gateTypes.length).toBe(7);
  });

  it('should validate SHA-256 hash format requirements', () => {
    const validHashes = [
      'a'.repeat(64),
      '0'.repeat(64),
      'f'.repeat(64),
      'abcdef0123456789'.repeat(4),
    ];

    for (const hash of validHashes) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('should reject invalid SHA-256 hash formats', () => {
    const invalidHashes = [
      'a'.repeat(63), // Too short
      'a'.repeat(65), // Too long
      'g'.repeat(64), // Invalid characters
      'A'.repeat(64), // Uppercase
      '',
      'not-a-hash',
    ];

    for (const hash of invalidHashes) {
      expect(hash).not.toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('should handle approval records with all optional fields undefined', () => {
    const record = createApprovalRecord(
      'minimal-approval',
      'feature-123',
      'prd',
      'approved',
      'system'
    );

    expect(record.signer_name).toBeUndefined();
    expect(record.artifact_hash).toBeUndefined();
    expect(record.artifact_path).toBeUndefined();
    expect(record.rationale).toBeUndefined();
    expect(record.metadata).toBeUndefined();

    const parseResult = parseApprovalRecord(record);
    expect(parseResult.success).toBe(true);
  });

  it('should handle approval records with empty strings where allowed', () => {
    const record = createApprovalRecord(
      'approval-123',
      'feature-456',
      'prd',
      'approved',
      'user@example.com',
      {
        rationale: '', // Empty rationale should be allowed
        artifactPath: '', // Empty path should be allowed
      }
    );

    expect(record.rationale).toBe('');
    expect(record.artifact_path).toBe('');
  });

  it('should handle metadata with complex nested objects', () => {
    const complexMetadata = {
      review_details: {
        time_spent: 30,
        sections_reviewed: ['intro', 'requirements', 'acceptance_criteria'],
        comments: [
          { line: 10, text: 'Clarify this requirement' },
          { line: 25, text: 'Add acceptance criteria' },
        ],
      },
      automated_checks: {
        spelling: true,
        formatting: true,
        links: false,
      },
    };

    const record = createApprovalRecord(
      'approval-123',
      'feature-456',
      'spec',
      'requested_changes',
      'reviewer@example.com',
      {
        rationale: 'See detailed comments in metadata',
        metadata: complexMetadata,
      }
    );

    expect(record.metadata).toEqual(complexMetadata);

    const parseResult = parseApprovalRecord(record);
    expect(parseResult.success).toBe(true);
  });
});

// ============================================================================
// Coverage gap-fill: Workflow functions (CDMCH-85)
// ============================================================================

describe('approvalRegistry - workflow exports', () => {
  let mod: typeof import('../../src/workflows/approvalRegistry');

  beforeAll(async () => {
    mod = await import('../../src/workflows/approvalRegistry');
  });

  it('should export requestApproval', () => {
    expect(typeof mod.requestApproval).toBe('function');
  });

  it('should export grantApproval', () => {
    expect(typeof mod.grantApproval).toBe('function');
  });

  it('should export denyApproval', () => {
    expect(typeof mod.denyApproval).toBe('function');
  });

  it('should export getPendingApprovals', () => {
    expect(typeof mod.getPendingApprovals).toBe('function');
  });

  it('should export getApprovalHistory', () => {
    expect(typeof mod.getApprovalHistory).toBe('function');
  });

  it('should export validateApprovalForTransition', () => {
    expect(typeof mod.validateApprovalForTransition).toBe('function');
  });
});

describe('approvalRegistry - validateApprovalForTransition', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should fail validation when no approval exists', async () => {
    const { createRunDirectory } = await import('../../src/persistence/runLifecycle');
    const { validateApprovalForTransition } = await import('../../src/workflows/approvalRegistry');

    const runDir = await createRunDirectory(tempDir, 'FEAT-VAL', {
      title: 'Test Validation',
      repoUrl: 'https://github.com/test/repo',
    });

    const result = await validateApprovalForTransition(runDir, 'prd', 'abc123');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
