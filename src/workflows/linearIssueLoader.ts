/**
 * Linear Issue Loader
 *
 * Fetches and snapshots a Linear issue via LinearAdapter for the workflow layer.
 * Extracted from `src/cli/startHelpers.ts` to decouple the CLI from LinearAdapter (finding 139).
 */

import type { StructuredLogger } from '../telemetry/logger';
import { LinearAdapter } from '../adapters/linear/LinearAdapter.js';
import type { IssueSnapshot } from '../adapters/linear/LinearAdapterTypes.js';

export async function loadLinearIssue(
  issueId: string,
  runDir: string,
  logger: StructuredLogger,
  apiKey: string,
  enablePreviewFeatures = false
): Promise<IssueSnapshot> {
  const adapter = new LinearAdapter({
    apiKey,
    runDir,
    logger,
    enablePreviewFeatures,
  });

  const snapshot = await adapter.fetchIssueSnapshot(issueId);
  logger.info('Linear issue snapshot loaded', {
    issueId: snapshot.issue.identifier,
    title: snapshot.issue.title,
    commentsCount: snapshot.comments.length,
    hasLastError: snapshot.metadata.last_error !== undefined,
  });
  return snapshot;
}
