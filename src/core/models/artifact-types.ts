/**
 * Artifact domain sub-barrel
 *
 * Exports for supporting artifact models: ContextDocument, RateLimitEnvelope,
 * ArtifactBundle, TraceLink.
 * Prefer these granular imports over the main index.ts barrel for better tree-shaking.
 *
 * Usage:
 *   import { ContextDocument, TraceLink } from '@/core/models/artifact-types';
 */

export {
  ContextDocument,
  ContextDocumentSchema,
  ContextFileRecord,
  ContextSummary,
  ProvenanceData,
  parseContextDocument,
  serializeContextDocument,
  createContextDocument,
} from './ContextDocument';

export {
  RateLimitEnvelope,
  RateLimitEnvelopeSchema,
  parseRateLimitEnvelope,
  serializeRateLimitEnvelope,
  createRateLimitEnvelope,
  isRateLimited,
  getTimeUntilReset,
} from './RateLimitEnvelope';

export {
  ArtifactBundle,
  ArtifactBundleSchema,
  parseArtifactBundle,
} from './ArtifactBundle';

export {
  TraceLink,
  TraceLinkSchema,
  parseTraceLink,
} from './TraceLink';
