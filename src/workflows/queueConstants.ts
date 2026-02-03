/**
 * Queue file name constants.
 *
 * Extracted during god-class split (PR #295) to avoid circular imports
 * between queueStore, queueSnapshotManager, and queueOperationsLog.
 */

export const QUEUE_FILE = 'queue.jsonl';
export const QUEUE_MANIFEST_FILE = 'queue_manifest.json';
export const QUEUE_SNAPSHOT_FILE = 'queue_snapshot.json';
