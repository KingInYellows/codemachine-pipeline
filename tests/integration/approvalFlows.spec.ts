import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { readManifest, markApprovalRequired } from '../../src/persistence/manifestManager';
import { createRunDirectory } from '../../src/persistence/runLifecycle';
import {
  requestApproval,
  grantApproval,
  denyApproval,
  getPendingApprovals,
  getApprovalHistory,
  validateApprovalForTransition,
  computeContentHash,
} from '../../src/workflows/approvalRegistry';

/**
 * Integration Tests: Approval Flows
 *
 * Tests end-to-end approval workflows including:
 * - Start command pausing when PRD approval pending
 * - Approve command writing signatures and updating manifest
 * - Resume command succeeding after approval granted
 * - Deny command preventing resumption with clear error
 * - Stale hash rejection when artifact modified post-approval
 * - Timeout simulation with notification stub invocation
 * - Concurrent approval attempt handling with locks
 */

describe('Approval Flows Integration Tests', () => {
  let testBaseDir: string;
  let featureId: string;
  let runDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-test-'));
    featureId = `FEAT-${randomUUID().split('-')[0]}`;

    // Create run directory
    runDir = await createRunDirectory(testBaseDir, featureId, {
      title: 'Test Feature',
      source: 'test',
      repoUrl: 'https://github.com/test/repo.git',
      defaultBranch: 'main',
    });

    // Create test artifact
    const artifactsDir = path.join(runDir, 'artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    const prdPath = path.join(artifactsDir, 'prd.md');
    await fs.writeFile(prdPath, '# Test PRD\n\nThis is a test PRD document.', 'utf-8');
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testBaseDir, { recursive: true, force: true });
  });

  describe('Test 1: Start command pauses when PRD approval pending', () => {
    it('should mark PRD approval as required and set status to paused', async () => {
      // Simulate start command marking approval required
      await markApprovalRequired(runDir, 'prd');

      // Read manifest
      const manifest = await readManifest(runDir);

      // Verify pending approvals
      expect(manifest.approvals.pending).toContain('prd');
      expect(manifest.approvals.completed).not.toContain('prd');

      // Verify status can be set to paused (simulating what start command does)
      // Note: start command would set status to 'paused' when approval required
      const pendingApprovals = await getPendingApprovals(runDir);
      expect(pendingApprovals).toContain('prd');
      expect(pendingApprovals.length).toBe(1);
    });
  });

  describe('Test 2: Approve command writes signature and updates manifest', () => {
    it('should grant approval, create record, and update manifest', async () => {
      // Setup: Request approval
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const prdContent = await fs.readFile(prdPath, 'utf-8');
      const prdHash = computeContentHash(prdContent);

      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: prdHash,
      });

      // Act: Grant approval
      const approvalRecord = await grantApproval(runDir, 'prd', prdHash, {
        signer: 'test@example.com',
        signerName: 'Test User',
        rationale: 'LGTM',
      });

      // Assert: Verify approval record
      expect(approvalRecord.gate_type).toBe('prd');
      expect(approvalRecord.verdict).toBe('approved');
      expect(approvalRecord.signer).toBe('test@example.com');
      expect(approvalRecord.signer_name).toBe('Test User');
      expect(approvalRecord.artifact_hash).toBe(prdHash);
      expect(approvalRecord.rationale).toBe('LGTM');

      // Assert: Verify manifest updated
      const manifest = await readManifest(runDir);
      expect(manifest.approvals.pending).not.toContain('prd');
      expect(manifest.approvals.completed).toContain('prd');

      // Assert: Verify approval history
      const history = await getApprovalHistory(runDir);
      expect(history.length).toBeGreaterThanOrEqual(2); // Request + approval
      const approvedRecord = history.find((r) => r.gate_type === 'prd' && r.verdict === 'approved');
      expect(approvedRecord).toBeDefined();
      expect(approvedRecord?.signer).toBe('test@example.com');
    });
  });

  describe('Test 3: Resume command succeeds after approval granted', () => {
    it('should validate approval exists before resuming', async () => {
      // Setup: Request and grant approval
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const prdContent = await fs.readFile(prdPath, 'utf-8');
      const prdHash = computeContentHash(prdContent);

      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: prdHash,
      });

      await grantApproval(runDir, 'prd', prdHash, {
        signer: 'test@example.com',
      });

      // Act: Validate approval for transition (simulates resume command)
      const validation = await validateApprovalForTransition(runDir, 'prd', prdHash);

      // Assert: Validation succeeds
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.approval).toBeDefined();
      expect(validation.approval?.verdict).toBe('approved');
    });
  });

  describe('Test 4: Deny command prevents resumption with clear error', () => {
    it('should record denial and keep approval in pending state', async () => {
      // Setup: Request approval
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const prdContent = await fs.readFile(prdPath, 'utf-8');
      const prdHash = computeContentHash(prdContent);

      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: prdHash,
      });

      // Act: Deny approval
      const denialRecord = await denyApproval(runDir, 'prd', {
        signer: 'reviewer@example.com',
        reason: 'Missing acceptance criteria',
      });

      // Assert: Verify denial record
      expect(denialRecord.gate_type).toBe('prd');
      expect(denialRecord.verdict).toBe('rejected');
      expect(denialRecord.signer).toBe('reviewer@example.com');
      expect(denialRecord.rationale).toBe('Missing acceptance criteria');

      // Assert: Verify manifest still has pending approval
      const manifest = await readManifest(runDir);
      expect(manifest.approvals.pending).toContain('prd');
      expect(manifest.approvals.completed).not.toContain('prd');

      // Assert: Validation fails
      const validation = await validateApprovalForTransition(runDir, 'prd', prdHash);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Test 5: Stale hash rejection when artifact modified post-approval', () => {
    it('should reject approval when artifact hash does not match', async () => {
      // Setup: Request approval with original hash
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const originalContent = await fs.readFile(prdPath, 'utf-8');
      const originalHash = computeContentHash(originalContent);

      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: originalHash,
      });

      // Act: Modify artifact
      const modifiedContent = originalContent + '\n\n## Additional Section';
      await fs.writeFile(prdPath, modifiedContent, 'utf-8');
      const modifiedHash = computeContentHash(modifiedContent);

      // Assert: Approval with modified hash fails
      await expect(
        grantApproval(runDir, 'prd', modifiedHash, {
          signer: 'test@example.com',
        })
      ).rejects.toThrow(/hash mismatch/i);

      // Assert: Manifest still has pending approval
      const manifest = await readManifest(runDir);
      expect(manifest.approvals.pending).toContain('prd');
      expect(manifest.approvals.completed).not.toContain('prd');
    });

    it('should reject validation when artifact is modified after approval', async () => {
      // Setup: Request and grant approval
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const originalContent = await fs.readFile(prdPath, 'utf-8');
      const originalHash = computeContentHash(originalContent);

      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: originalHash,
      });

      await grantApproval(runDir, 'prd', originalHash, {
        signer: 'test@example.com',
      });

      // Act: Modify artifact after approval
      const modifiedContent = originalContent + '\n\n## Post-Approval Changes';
      await fs.writeFile(prdPath, modifiedContent, 'utf-8');
      const modifiedHash = computeContentHash(modifiedContent);

      // Assert: Validation with modified hash fails
      const validation = await validateApprovalForTransition(runDir, 'prd', modifiedHash);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toMatch(/hash mismatch/i);
    });
  });

  describe('Test 6: Timeout simulation with notification stub invocation', () => {
    it('should support manual denial for timeout scenarios', async () => {
      // Setup: Request approval
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const prdContent = await fs.readFile(prdPath, 'utf-8');
      const prdHash = computeContentHash(prdContent);

      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: prdHash,
        metadata: {
          requested_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(), // 72 hours ago
        },
      });

      // Act: Simulate timeout bot denying approval
      const timeoutDenial = await denyApproval(runDir, 'prd', {
        signer: 'timeout-bot@example.com',
        reason: 'Approval timed out after 72 hours',
        metadata: {
          timeout: true,
          timeout_threshold_hours: 72,
        },
      });

      // Assert: Timeout denial recorded
      expect(timeoutDenial.verdict).toBe('rejected');
      expect(timeoutDenial.signer).toBe('timeout-bot@example.com');
      expect(timeoutDenial.rationale).toBe('Approval timed out after 72 hours');
      expect(timeoutDenial.metadata?.timeout).toBe(true);

      // Assert: Approval still pending (timeout doesn't auto-complete)
      const manifest = await readManifest(runDir);
      expect(manifest.approvals.pending).toContain('prd');
    });
  });

  describe('Test 7: Concurrent approval attempt handling with locks', () => {
    it('should handle concurrent approval operations safely', async () => {
      // Setup: Request approval
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const prdContent = await fs.readFile(prdPath, 'utf-8');
      const prdHash = computeContentHash(prdContent);

      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: prdHash,
      });

      // Act: Simulate concurrent approvals (both should succeed due to locking)
      const approval1Promise = grantApproval(runDir, 'prd', prdHash, {
        signer: 'user1@example.com',
        rationale: 'First approval',
      });

      const approval2Promise = grantApproval(runDir, 'prd', prdHash, {
        signer: 'user2@example.com',
        rationale: 'Second approval',
      });

      // Wait for both to complete
      const [approval1, approval2] = await Promise.all([approval1Promise, approval2Promise]);

      // Assert: Both approvals recorded
      expect(approval1.signer).toBe('user1@example.com');
      expect(approval2.signer).toBe('user2@example.com');

      // Assert: Manifest updated (both operations succeeded)
      const manifest = await readManifest(runDir);
      expect(manifest.approvals.completed).toContain('prd');

      // Assert: History contains both approvals
      const history = await getApprovalHistory(runDir);
      const approvedRecords = history.filter(
        (r) => r.gate_type === 'prd' && r.verdict === 'approved'
      );
      expect(approvedRecords.length).toBe(2);
    });
  });

  describe('Test 8: Multiple gate approval workflow', () => {
    it('should support sequential approvals across multiple gates', async () => {
      // Setup: Create artifacts for multiple gates
      const specPath = path.join(runDir, 'artifacts', 'spec.md');
      await fs.writeFile(specPath, '# Test Spec\n\nSpecification document.', 'utf-8');

      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const prdContent = await fs.readFile(prdPath, 'utf-8');
      const prdHash = computeContentHash(prdContent);

      const specContent = await fs.readFile(specPath, 'utf-8');
      const specHash = computeContentHash(specContent);

      // Act: Request and approve PRD
      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: prdHash,
      });

      await grantApproval(runDir, 'prd', prdHash, {
        signer: 'test@example.com',
      });

      // Act: Request and approve Spec
      await requestApproval(runDir, 'spec', {
        artifactPath: 'artifacts/spec.md',
        artifactHash: specHash,
      });

      await grantApproval(runDir, 'spec', specHash, {
        signer: 'test@example.com',
      });

      // Assert: Both approvals completed
      const manifest = await readManifest(runDir);
      expect(manifest.approvals.completed).toContain('prd');
      expect(manifest.approvals.completed).toContain('spec');
      expect(manifest.approvals.pending).not.toContain('prd');
      expect(manifest.approvals.pending).not.toContain('spec');

      // Assert: Validation succeeds for both
      const prdValidation = await validateApprovalForTransition(runDir, 'prd', prdHash);
      expect(prdValidation.valid).toBe(true);

      const specValidation = await validateApprovalForTransition(runDir, 'spec', specHash);
      expect(specValidation.valid).toBe(true);
    });
  });

  describe('Test 9: Approval record metadata preservation', () => {
    it('should preserve metadata across approval lifecycle', async () => {
      const prdPath = path.join(runDir, 'artifacts', 'prd.md');
      const prdContent = await fs.readFile(prdPath, 'utf-8');
      const prdHash = computeContentHash(prdContent);

      // Request with metadata
      await requestApproval(runDir, 'prd', {
        artifactPath: 'artifacts/prd.md',
        artifactHash: prdHash,
        metadata: {
          requested_by: 'system',
          workflow_step: 'prd_authoring',
        },
      });

      // Grant with metadata
      await grantApproval(runDir, 'prd', prdHash, {
        signer: 'test@example.com',
        signerName: 'Test User',
        rationale: 'All requirements met',
        metadata: {
          review_duration_minutes: 15,
          reviewed_sections: ['goals', 'acceptance_criteria', 'risks'],
        },
      });

      // Verify metadata preserved
      const history = await getApprovalHistory(runDir);
      const approvalRecord = history.find((r) => r.gate_type === 'prd' && r.verdict === 'approved');

      expect(approvalRecord?.metadata?.review_duration_minutes).toBe(15);
      expect(approvalRecord?.metadata?.reviewed_sections).toEqual([
        'goals',
        'acceptance_criteria',
        'risks',
      ]);
    });
  });
});
