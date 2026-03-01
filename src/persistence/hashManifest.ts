import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { z } from 'zod';
import { validateOrThrow } from '../validation/helpers.js';
import { isFileNotFound } from '../utils/safeJson';

/**
 * Hash Manifest Utilities
 *
 * Deterministic file integrity tracking via SHA-256 hashing.
 * Supports manifest generation, validation, incremental updates, and verification.
 */

/**
 * Represents a single file's hash record
 */
export interface FileHashRecord {
  /** Absolute or relative path to the file */
  path: string;
  /** SHA-256 hash of file contents */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Timestamp when hash was computed (ISO 8601) */
  timestamp: string;
  /** Intentional: file-level metadata varies by consumer (file type, purpose, tags, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Hash manifest containing multiple file records
 */
export interface HashManifest {
  /** Schema version for future evolution */
  schema_version: string;
  /** When this manifest was created */
  created_at: string;
  /** When this manifest was last updated */
  updated_at: string;
  /** Map of file paths to hash records */
  files: Record<string, FileHashRecord>;
  /** Intentional: manifest-level metadata varies by consumer */
  metadata?: Record<string, unknown>;
}

const FileHashRecordSchema = z.object({
  path: z.string(),
  hash: z.string(),
  size: z.number(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const HashManifestSchema = z.object({
  schema_version: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  files: z.record(z.string(), FileHashRecordSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Result of hash verification
 */
export interface VerificationResult {
  /** Whether all files passed verification */
  valid: boolean;
  /** Files that passed verification */
  passed: string[];
  /** Files that failed verification */
  failed: Array<{
    path: string;
    reason: string;
    expected?: string;
    actual?: string;
  }>;
  /** Files present in manifest but missing from filesystem */
  missing: string[];
}

/**
 * Result of hash manifest creation/update operations.
 * Includes the manifest and any files that were skipped during processing.
 */
export interface HashManifestResult {
  /** The created/updated hash manifest */
  manifest: HashManifest;
  /** Files that were skipped due to errors */
  skipped: Array<{ path: string; reason: string }>;
}

/**
 * Result of single file hash verification.
 * Distinguishes between successful verification, hash mismatch, and various error types.
 */
export type FileHashResult =
  | { success: true; matches: boolean }
  | { success: false; error: 'ENOENT' | 'EACCES' | 'EIO' | 'UNKNOWN'; message: string };

/**
 * Compute SHA-256 hash of a file's contents
 *
 * @param filePath - Absolute path to the file
 * @returns Hex-encoded SHA-256 hash
 * @throws Error if file cannot be read
 */
export async function computeFileHash(filePath: string): Promise<string> {
  try {
    const fileHandle = await fs.open(filePath, 'r');
    const hash = crypto.createHash('sha256');
    const stream = fileHandle.createReadStream();

    for await (const chunk of stream as AsyncIterable<Buffer>) {
      hash.update(chunk);
    }

    await fileHandle.close();
    return hash.digest('hex');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to compute hash for ${filePath}: ${error.message}`, { cause: error });
    }
    throw new Error(`Failed to compute hash for ${filePath}: Unknown error`, { cause: error });
  }
}

/**
 * Create a hash record for a single file
 *
 * @param filePath - Absolute path to the file
 * @param metadata - Optional metadata to attach to the record
 * @returns File hash record
 */
export async function createFileHashRecord(
  filePath: string,
  metadata?: Record<string, unknown>
): Promise<FileHashRecord> {
  const hash = await computeFileHash(filePath);
  const stats = await fs.stat(filePath);

  const record: FileHashRecord = {
    path: filePath,
    hash,
    size: stats.size,
    timestamp: new Date().toISOString(),
  };

  if (metadata) {
    record.metadata = metadata;
  }

  return record;
}

/**
 * Create a hash manifest for multiple files
 *
 * @param filePaths - Array of absolute file paths
 * @param metadata - Optional manifest-level metadata
 * @returns HashManifestResult containing the manifest and any skipped files
 */
export async function createHashManifest(
  filePaths: string[],
  metadata?: Record<string, unknown>
): Promise<HashManifestResult> {
  const files: Record<string, FileHashRecord> = {};
  const skipped: Array<{ path: string; reason: string }> = [];
  const now = new Date().toISOString();

  // Process files sequentially to avoid overwhelming I/O
  for (const filePath of filePaths) {
    try {
      const record = await createFileHashRecord(filePath);
      files[filePath] = record;
    } catch (error) {
      // Collect skipped files instead of silent logging
      skipped.push({
        path: filePath,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const manifest: HashManifest = {
    schema_version: '1.0.0',
    created_at: now,
    updated_at: now,
    files,
  };

  if (metadata) {
    manifest.metadata = metadata;
  }

  return { manifest, skipped };
}

/**
 * Update an existing hash manifest with new or changed files
 *
 * @param existingManifest - Current hash manifest
 * @param filePaths - Files to add or update
 * @returns HashManifestResult containing the updated manifest and any skipped files
 */
export async function updateHashManifest(
  existingManifest: HashManifest,
  filePaths: string[]
): Promise<HashManifestResult> {
  const updatedFiles = { ...existingManifest.files };
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const filePath of filePaths) {
    try {
      const record = await createFileHashRecord(filePath);
      updatedFiles[filePath] = record;
    } catch (error) {
      // Collect skipped files instead of silent logging
      skipped.push({
        path: filePath,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const manifest: HashManifest = {
    ...existingManifest,
    updated_at: new Date().toISOString(),
    files: updatedFiles,
  };

  return { manifest, skipped };
}

/**
 * Remove files from a hash manifest
 *
 * @param existingManifest - Current hash manifest
 * @param filePaths - Files to remove
 * @returns Updated hash manifest
 */
export function removeFromHashManifest(
  existingManifest: HashManifest,
  filePaths: string[]
): HashManifest {
  const updatedFiles = { ...existingManifest.files };

  for (const filePath of filePaths) {
    delete updatedFiles[filePath];
  }

  return {
    ...existingManifest,
    updated_at: new Date().toISOString(),
    files: updatedFiles,
  };
}

/**
 * Verify integrity of files against a hash manifest
 *
 * @param manifest - Hash manifest to verify against
 * @param basePath - Optional base path to resolve relative paths
 * @returns Verification result
 */
export async function verifyHashManifest(
  manifest: HashManifest,
  basePath?: string
): Promise<VerificationResult> {
  const result: VerificationResult = {
    valid: true,
    passed: [],
    failed: [],
    missing: [],
  };

  for (const [filePath, record] of Object.entries(manifest.files)) {
    const resolvedPath = basePath ? path.resolve(basePath, filePath) : filePath;

    try {
      // Check if file exists
      await fs.access(resolvedPath);

      // Compute current hash
      const currentHash = await computeFileHash(resolvedPath);

      if (currentHash === record.hash) {
        result.passed.push(filePath);
      } else {
        result.valid = false;
        result.failed.push({
          path: filePath,
          reason: 'Hash mismatch',
          expected: record.hash,
          actual: currentHash,
        });
      }
    } catch (error) {
      result.valid = false;
      if (isFileNotFound(error)) {
        result.missing.push(filePath);
      } else {
        result.failed.push({
          path: filePath,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  return result;
}

/**
 * Check if a single file matches its hash record
 *
 * @param filePath - Path to the file
 * @param expectedHash - Expected SHA-256 hash
 * @returns FileHashResult indicating success/match status or specific error type
 */
export async function verifyFileHash(
  filePath: string,
  expectedHash: string
): Promise<FileHashResult> {
  // Check file access first to preserve specific error codes
  // (computeFileHash wraps errors and loses the code property)
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'ENOENT') {
        return { success: false, error: 'ENOENT', message: 'File not found' };
      }
      if (code === 'EACCES') {
        return { success: false, error: 'EACCES', message: 'Permission denied' };
      }
    }
    return {
      success: false,
      error: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  try {
    const actualHash = await computeFileHash(filePath);
    return { success: true, matches: actualHash === expectedHash };
  } catch (error) {
    // If we get here, it's likely an I/O error during reading
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'EIO') {
        return { success: false, error: 'EIO', message: 'I/O error' };
      }
    }
    return {
      success: false,
      error: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Save hash manifest to a JSON file
 *
 * @param manifest - Hash manifest to save
 * @param outputPath - Path where manifest should be written
 */
export async function saveHashManifest(manifest: HashManifest, outputPath: string): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  const content = JSON.stringify(manifest, null, 2);
  await fs.writeFile(outputPath, content, 'utf-8');
}

/**
 * Load hash manifest from a JSON file
 *
 * @param manifestPath - Path to the manifest file
 * @returns Loaded hash manifest
 * @throws Error if file cannot be read or parsed
 */
export async function loadHashManifest(manifestPath: string): Promise<HashManifest> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return validateOrThrow(
      HashManifestSchema,
      JSON.parse(content),
      'hash manifest'
    ) as HashManifest;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load hash manifest: ${error.message}`, { cause: error });
    }
    throw new Error('Failed to load hash manifest: Unknown error', { cause: error });
  }
}

/**
 * Get all file paths from a hash manifest
 *
 * @param manifest - Hash manifest
 * @returns Array of file paths
 */
export function getManifestFilePaths(manifest: HashManifest): string[] {
  return Object.keys(manifest.files);
}

/**
 * Get total size of all files in manifest
 *
 * @param manifest - Hash manifest
 * @returns Total size in bytes
 */
export function getManifestTotalSize(manifest: HashManifest): number {
  return Object.values(manifest.files).reduce((sum, record) => sum + record.size, 0);
}

/**
 * Filter manifest to include only files matching a pattern
 *
 * @param manifest - Hash manifest
 * @param pattern - Regex pattern or glob-like string
 * @returns Filtered hash manifest
 */
export function filterManifest(manifest: HashManifest, pattern: RegExp | string): HashManifest {
  const regex =
    typeof pattern === 'string'
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : pattern;
  const filteredFiles: Record<string, FileHashRecord> = {};

  for (const [filePath, record] of Object.entries(manifest.files)) {
    if (regex.test(filePath)) {
      filteredFiles[filePath] = record;
    }
  }

  return {
    ...manifest,
    files: filteredFiles,
  };
}
