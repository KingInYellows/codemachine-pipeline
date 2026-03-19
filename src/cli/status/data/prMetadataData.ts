import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeJsonParse } from '../../../utils/safeJson';
import type { PRMetadata } from '../../pr/shared';

/**
 * Load pull-request metadata from `pr.json` in the run directory.
 *
 * Returns null when the file does not exist (ENOENT). Throws on any other
 * read error so the caller can decide how to handle it.
 *
 * @param runDir - Absolute path to the feature's run directory.
 */
export async function loadPRMetadata(runDir: string): Promise<PRMetadata | null> {
  const prPath = join(runDir, 'pr.json');
  try {
    const content = await readFile(prPath, 'utf-8');
    const parsed = safeJsonParse<PRMetadata>(content);
    return parsed ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
