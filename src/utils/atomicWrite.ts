/**
 * Atomic file write utilities
 *
 * Provides a write-temp-then-rename pattern to ensure file writes are atomic.
 * This prevents readers from observing partial writes during update.
 */

import { open, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

/**
 * Write content to a file atomically using a temp-file-and-rename strategy.
 *
 * Optionally calls fsync on the temp file before renaming to improve
 * durability of file contents. This does not fsync the parent directory.
 * If the write or rename fails, the temp file is cleaned up automatically.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  options: { fsync?: boolean } = {}
): Promise<void> {
  const tempPath = `${filePath}.tmp.${randomBytes(8).toString('hex')}`;

  try {
    if (options.fsync) {
      const handle = await open(tempPath, 'w');
      try {
        await handle.writeFile(content, 'utf-8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else {
      await writeFile(tempPath, content, 'utf-8');
    }

    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
