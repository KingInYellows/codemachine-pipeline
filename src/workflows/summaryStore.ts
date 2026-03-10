import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChunkMetadataSchema, type ChunkMetadata } from './summarizerClients/types';
import { isFileNotFound } from '../utils/safeJson.js';
import { validateOrResult } from '../validation/helpers.js';

/**
 * Load cached chunk metadata
 *
 * @param contextDir - Context directory path
 * @param chunkId - Chunk ID
 * @returns Chunk metadata or null if not found
 */
export async function loadCachedChunk(
  contextDir: string,
  chunkId: string
): Promise<ChunkMetadata | null> {
  const chunkPath = join(contextDir, 'docs', `${chunkId}.json`);

  try {
    const content = await readFile(chunkPath, 'utf-8');
    const result = validateOrResult(ChunkMetadataSchema, JSON.parse(content), 'chunk metadata');
    return result.success ? result.data : null;
  } catch (error) {
    if (isFileNotFound(error) || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

/**
 * Save chunk metadata to cache
 *
 * @param contextDir - Context directory path
 * @param metadata - Chunk metadata
 */
export async function saveCachedChunk(contextDir: string, metadata: ChunkMetadata): Promise<void> {
  const docsDir = join(contextDir, 'docs');
  await mkdir(docsDir, { recursive: true });

  const chunkPath = join(docsDir, `${metadata.chunkId}.json`);
  await writeFile(chunkPath, JSON.stringify(metadata, null, 2), 'utf-8');
}
