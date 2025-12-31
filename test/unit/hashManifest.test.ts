import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  computeFileHash,
  createFileHashRecord,
  createHashManifest,
  updateHashManifest,
  removeFromHashManifest,
  verifyHashManifest,
  verifyFileHash,
  saveHashManifest,
  loadHashManifest,
  getManifestFilePaths,
  getManifestTotalSize,
  filterManifest,
  type HashManifest,
} from '../../src/persistence/hashManifest';

/**
 * Unit tests for Hash Manifest utilities
 *
 * Tests cover:
 * - SHA-256 hash computation
 * - Hash manifest creation and updates
 * - Integrity verification
 * - Persistence (save/load)
 * - Utility functions
 */

describe('Hash Manifest Utilities', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hash-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Hash Computation', () => {
    it('should compute SHA-256 hash of file', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello World', 'utf-8');

      const hash = await computeFileHash(filePath);

      // Expected SHA-256 of "Hello World"
      expect(hash).toBe('a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e');
      expect(hash.length).toBe(64); // SHA-256 produces 64 hex characters
    });

    it('should compute consistent hash for same content', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'Consistent Content', 'utf-8');

      const hash1 = await computeFileHash(filePath);
      const hash2 = await computeFileHash(filePath);

      expect(hash1).toBe(hash2);
    });

    it('should compute different hash for different content', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      const file2 = path.join(testDir, 'file2.txt');

      await fs.writeFile(file1, 'Content A', 'utf-8');
      await fs.writeFile(file2, 'Content B', 'utf-8');

      const hash1 = await computeFileHash(file1);
      const hash2 = await computeFileHash(file2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle large files', async () => {
      const filePath = path.join(testDir, 'large.txt');
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB
      await fs.writeFile(filePath, largeContent, 'utf-8');

      const hash = await computeFileHash(filePath);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });

    it('should throw error for non-existent file', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist.txt');

      await expect(computeFileHash(nonExistent)).rejects.toThrow();
    });

    it('should create file hash record with metadata', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'Test Content', 'utf-8');

      const record = await createFileHashRecord(filePath, { type: 'artifact' });

      expect(record.path).toBe(filePath);
      expect(record.hash).toBeDefined();
      expect(record.size).toBeGreaterThan(0);
      expect(record.timestamp).toBeDefined();
      expect(record.metadata?.type).toBe('artifact');
    });
  });

  describe('Manifest Creation', () => {
    it('should create hash manifest for multiple files', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      const file2 = path.join(testDir, 'file2.txt');

      await fs.writeFile(file1, 'Content 1', 'utf-8');
      await fs.writeFile(file2, 'Content 2', 'utf-8');

      const { manifest, skipped } = await createHashManifest([file1, file2]);

      expect(skipped).toEqual([]);
      expect(manifest.schema_version).toBe('1.0.0');
      expect(manifest.created_at).toBeDefined();
      expect(manifest.updated_at).toBeDefined();
      expect(Object.keys(manifest.files).length).toBe(2);
      expect(manifest.files[file1]).toBeDefined();
      expect(manifest.files[file2]).toBeDefined();
    });

    it('should include manifest metadata', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      await fs.writeFile(file1, 'Content', 'utf-8');

      const { manifest } = await createHashManifest([file1], { project: 'test' });

      expect(manifest.metadata?.project).toBe('test');
    });

    it('should skip files that cannot be read and report them', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      const file2 = path.join(testDir, 'missing.txt'); // Does not exist

      await fs.writeFile(file1, 'Content', 'utf-8');

      // Should not throw, just skip the missing file and report it
      const { manifest, skipped } = await createHashManifest([file1, file2]);

      expect(Object.keys(manifest.files).length).toBe(1);
      expect(manifest.files[file1]).toBeDefined();
      expect(manifest.files[file2]).toBeUndefined();
      expect(skipped.length).toBe(1);
      expect(skipped[0].path).toBe(file2);
      expect(skipped[0].reason).toContain('Failed to compute hash');
    });

    it('should handle empty file list', async () => {
      const { manifest, skipped } = await createHashManifest([]);

      expect(skipped).toEqual([]);
      expect(manifest.schema_version).toBe('1.0.0');
      expect(Object.keys(manifest.files).length).toBe(0);
    });
  });

  describe('Manifest Updates', () => {
    let manifest: HashManifest;
    let file1: string;
    let file2: string;

    beforeEach(async () => {
      file1 = path.join(testDir, 'file1.txt');
      file2 = path.join(testDir, 'file2.txt');

      await fs.writeFile(file1, 'Content 1', 'utf-8');
      await fs.writeFile(file2, 'Content 2', 'utf-8');

      const result = await createHashManifest([file1]);
      manifest = result.manifest;
    });

    it('should update manifest with new files', async () => {
      // Wait a tiny bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const { manifest: updated, skipped } = await updateHashManifest(manifest, [file2]);

      expect(skipped).toEqual([]);
      expect(Object.keys(updated.files).length).toBe(2);
      expect(updated.files[file1]).toBeDefined();
      expect(updated.files[file2]).toBeDefined();
      // Check that updated_at is newer or equal (might be same in fast systems)
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(manifest.updated_at).getTime()
      );
    });

    it('should update existing file records', async () => {
      const originalHash = manifest.files[file1].hash;

      // Modify file
      await fs.writeFile(file1, 'Modified Content', 'utf-8');

      const { manifest: updated } = await updateHashManifest(manifest, [file1]);

      expect(updated.files[file1].hash).not.toBe(originalHash);
    });

    it('should preserve manifest metadata on update', async () => {
      manifest.metadata = { project: 'test' };

      const { manifest: updated } = await updateHashManifest(manifest, [file2]);

      expect(updated.metadata?.project).toBe('test');
    });

    it('should remove files from manifest', async () => {
      const result = await createHashManifest([file1, file2]);
      manifest = result.manifest;
      expect(Object.keys(manifest.files).length).toBe(2);

      const updated = removeFromHashManifest(manifest, [file1]);

      expect(Object.keys(updated.files).length).toBe(1);
      expect(updated.files[file1]).toBeUndefined();
      expect(updated.files[file2]).toBeDefined();
    });

    it('should handle removing non-existent files', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist.txt');
      const updated = removeFromHashManifest(manifest, [nonExistent]);

      expect(Object.keys(updated.files).length).toBe(Object.keys(manifest.files).length);
    });
  });

  describe('Verification', () => {
    let manifest: HashManifest;
    let file1: string;
    let file2: string;

    beforeEach(async () => {
      file1 = path.join(testDir, 'file1.txt');
      file2 = path.join(testDir, 'file2.txt');

      await fs.writeFile(file1, 'Content 1', 'utf-8');
      await fs.writeFile(file2, 'Content 2', 'utf-8');

      const result = await createHashManifest([file1, file2]);
      manifest = result.manifest;
    });

    it('should verify unchanged files', async () => {
      const result = await verifyHashManifest(manifest);

      expect(result.valid).toBe(true);
      expect(result.passed.length).toBe(2);
      expect(result.failed.length).toBe(0);
      expect(result.missing.length).toBe(0);
    });

    it('should detect modified files', async () => {
      // Modify file after creating manifest
      await fs.writeFile(file1, 'Modified Content', 'utf-8');

      const result = await verifyHashManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].path).toBe(file1);
      expect(result.failed[0].reason).toBe('Hash mismatch');
      expect(result.passed.length).toBe(1);
    });

    it('should detect missing files', async () => {
      // Delete file after creating manifest
      await fs.unlink(file1);

      const result = await verifyHashManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.missing.length).toBe(1);
      expect(result.missing[0]).toBe(file1);
      expect(result.passed.length).toBe(1);
    });

    it('should verify single file hash', async () => {
      const hash = manifest.files[file1].hash;

      let result = await verifyFileHash(file1, hash);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.matches).toBe(true);
      }

      // Modify file
      await fs.writeFile(file1, 'Modified', 'utf-8');

      result = await verifyFileHash(file1, hash);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.matches).toBe(false);
      }
    });

    it('should return specific error for missing file', async () => {
      const missingFile = path.join(testDir, 'missing.txt');
      const result = await verifyFileHash(missingFile, 'somehash');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('ENOENT');
        expect(result.message).toBe('File not found');
      }
    });

    it('should handle verification with base path', async () => {
      // Create manifest with relative paths
      const relativeManifest: HashManifest = {
        schema_version: '1.0.0',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        files: {
          'file1.txt': manifest.files[file1],
          'file2.txt': manifest.files[file2],
        },
      };

      const result = await verifyHashManifest(relativeManifest, testDir);

      expect(result.valid).toBe(true);
      expect(result.passed.length).toBe(2);
    });
  });

  describe('Persistence', () => {
    it('should save and load manifest', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      await fs.writeFile(file1, 'Content', 'utf-8');

      const { manifest } = await createHashManifest([file1], { project: 'test' });
      const manifestPath = path.join(testDir, 'manifest.json');

      await saveHashManifest(manifest, manifestPath);

      const loaded = await loadHashManifest(manifestPath);

      expect(loaded.schema_version).toBe(manifest.schema_version);
      expect(loaded.created_at).toBe(manifest.created_at);
      expect(loaded.metadata?.project).toBe('test');
      expect(Object.keys(loaded.files).length).toBe(1);
    });

    it('should create directory when saving', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      await fs.writeFile(file1, 'Content', 'utf-8');

      const { manifest } = await createHashManifest([file1]);
      const nestedPath = path.join(testDir, 'nested', 'dir', 'manifest.json');

      await saveHashManifest(manifest, nestedPath);

      const loaded = await loadHashManifest(nestedPath);
      expect(loaded.schema_version).toBe('1.0.0');
    });

    it('should throw error when loading invalid manifest', async () => {
      const manifestPath = path.join(testDir, 'invalid.json');
      await fs.writeFile(manifestPath, 'invalid json{', 'utf-8');

      await expect(loadHashManifest(manifestPath)).rejects.toThrow();
    });

    it('should throw error when loading missing manifest', async () => {
      const manifestPath = path.join(testDir, 'missing.json');

      await expect(loadHashManifest(manifestPath)).rejects.toThrow();
    });

    it('should validate manifest structure on load', async () => {
      const manifestPath = path.join(testDir, 'incomplete.json');
      await fs.writeFile(
        manifestPath,
        JSON.stringify({ created_at: '2025-12-15T10:00:00.000Z' }),
        'utf-8'
      );

      await expect(loadHashManifest(manifestPath)).rejects.toThrow(/missing required fields/);
    });
  });

  describe('Utility Functions', () => {
    let manifest: HashManifest;

    beforeEach(async () => {
      const file1 = path.join(testDir, 'src', 'file1.ts');
      const file2 = path.join(testDir, 'docs', 'file2.md');
      const file3 = path.join(testDir, 'src', 'file3.ts');

      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'docs'), { recursive: true });

      await fs.writeFile(file1, 'a'.repeat(100), 'utf-8');
      await fs.writeFile(file2, 'b'.repeat(200), 'utf-8');
      await fs.writeFile(file3, 'c'.repeat(300), 'utf-8');

      const result = await createHashManifest([file1, file2, file3]);
      manifest = result.manifest;
    });

    it('should get all file paths from manifest', () => {
      const paths = getManifestFilePaths(manifest);

      expect(paths.length).toBe(3);
      expect(paths).toContain(path.join(testDir, 'src', 'file1.ts'));
      expect(paths).toContain(path.join(testDir, 'docs', 'file2.md'));
      expect(paths).toContain(path.join(testDir, 'src', 'file3.ts'));
    });

    it('should calculate total size', () => {
      const totalSize = getManifestTotalSize(manifest);

      expect(totalSize).toBe(600); // 100 + 200 + 300
    });

    it('should filter manifest by pattern', () => {
      const filtered = filterManifest(manifest, /\.ts$/);

      const paths = getManifestFilePaths(filtered);
      expect(paths.length).toBe(2);
      expect(paths.every((p) => p.endsWith('.ts'))).toBe(true);
    });

    it('should filter manifest by string pattern', () => {
      const filtered = filterManifest(manifest, 'src');

      const paths = getManifestFilePaths(filtered);
      expect(paths.length).toBe(2);
      expect(paths.every((p) => p.includes('src'))).toBe(true);
    });

    it('should handle empty manifest', () => {
      const emptyManifest: HashManifest = {
        schema_version: '1.0.0',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        files: {},
      };

      expect(getManifestFilePaths(emptyManifest)).toEqual([]);
      expect(getManifestTotalSize(emptyManifest)).toBe(0);
    });
  });
});
