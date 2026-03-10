import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeJsonParse } from '../../../utils/safeJson';
import type { PRMetadata } from '../../pr/shared';

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
