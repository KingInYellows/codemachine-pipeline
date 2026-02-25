/**
 * Context Document Builder
 *
 * Assembles the context document from ranked file metadata and persists
 * the resulting artifacts to the run directory.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  createContextDocument,
  type ContextDocument,
  type ContextFileRecord,
  serializeContextDocument,
} from '../core/models/ContextDocument';
import { saveHashManifest, withLock, type HashManifest } from '../persistence';
import { type FileMetadata } from './contextRanking';
import { type GitMetadata } from './contextFileDiscovery';

// ============================================================================
// Context Document Assembly
// ============================================================================

/**
 * Build context document from ranked files
 *
 * @param featureId - Feature identifier
 * @param files - Included files from ranking
 * @param gitMetadata - Git metadata
 * @param repoRoot - Repository root
 * @returns Context document
 */
export function buildContextDocument(
  featureId: string,
  files: FileMetadata[],
  gitMetadata: GitMetadata,
  repoRoot: string
): ContextDocument {
  const options: {
    commitSha?: string;
    branch?: string;
    metadata?: Record<string, unknown>;
  } = {};

  if (gitMetadata.commitSha !== undefined) {
    options.commitSha = gitMetadata.commitSha;
  }
  if (gitMetadata.branch !== undefined) {
    options.branch = gitMetadata.branch;
  }

  const contextDoc = createContextDocument(featureId, 'manual', options);

  // Add file records
  const fileRecords: Record<string, ContextFileRecord> = {};
  for (const file of files) {
    const relativePath = path.relative(repoRoot, file.path);
    const ext = path.extname(relativePath);

    fileRecords[relativePath] = {
      path: relativePath,
      hash: file.hash,
      size: file.size,
      file_type: ext.replace('.', ''),
      token_count: file.estimatedTokens,
    };
  }

  // Calculate total tokens
  const totalTokens = files.reduce((sum, f) => sum + f.estimatedTokens, 0);

  return {
    ...contextDoc,
    files: fileRecords,
    total_token_count: totalTokens,
  };
}

// ============================================================================
// Artifact Persistence
// ============================================================================

/**
 * Persist context artifacts to run directory
 *
 * @param contextDir - Context directory path
 * @param runDir - Run directory path
 * @param contextDocument - Context document to persist
 * @param hashManifest - Hash manifest to persist
 */
export async function persistContextArtifacts(
  contextDir: string,
  runDir: string,
  contextDocument: ContextDocument,
  hashManifest: HashManifest
): Promise<void> {
  await withLock(runDir, async () => {
    // Ensure context directory exists
    await fs.mkdir(contextDir, { recursive: true });

    // Write summary.json
    const summaryPath = path.join(contextDir, 'summary.json');
    const summaryContent = serializeContextDocument(contextDocument);
    await fs.writeFile(summaryPath, summaryContent, 'utf-8');

    // Write file_hashes.json
    const hashManifestPath = path.join(contextDir, 'file_hashes.json');
    await saveHashManifest(hashManifest, hashManifestPath);
  });
}
