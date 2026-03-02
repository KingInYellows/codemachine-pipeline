/**
 * Linear Issue Loader
 *
 * Extracted from src/cli/startHelpers.ts so that the CLI helper layer
 * does not directly couple to the LinearAdapter (finding 139). The CLI
 * layer remains responsible for reading environment variables and wrapping
 * errors into CLI-specific error types.
 */

import type { StructuredLogger } from '../telemetry/logger';
import { LinearAdapter, type IssueSnapshot } from '../adapters/linear/LinearAdapter.js';

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
    cached: snapshot.metadata.last_error !== undefined,
  });
  return snapshot;
}
