/**
 * Feature domain sub-barrel
 *
 * Exports for core feature lifecycle models: Feature, RunArtifact, PlanArtifact.
 * Prefer these granular imports over the main index.ts barrel for better tree-shaking.
 *
 * Usage:
 *   import { Feature, FeatureSchema } from '@/core/models/feature-types';
 */

export {
  Feature,
  FeatureSchema,
  FeatureStatus,
  FeatureStatusSchema,
  RepoMetadata,
  LastError,
  ExecutionTracking,
  Timestamps,
  Approvals,
  ArtifactReferences,
  TelemetryReferences,
  RateLimitReferences,
  parseFeature,
  serializeFeature,
  createFeature,
  formatFeatureValidationErrors,
} from './Feature';

export {
  RunArtifact,
  RunArtifactSchema,
  ArtifactType,
  ArtifactTypeSchema,
  ArtifactRecord,
  parseRunArtifact,
  serializeRunArtifact,
  createRunArtifact,
  addArtifact,
  removeArtifact,
  getArtifactsByType,
  getTotalArtifactSize,
  formatRunArtifactValidationErrors,
} from './RunArtifact';

export {
  PlanArtifact,
  PlanArtifactSchema,
  TaskNode,
  TaskDependency,
  DAGMetadata,
  parsePlanArtifact,
  serializePlanArtifact,
  createPlanArtifact,
  validateDAG,
  getEntryTasks,
  getDependentTasks,
  formatPlanArtifactValidationErrors,
} from './PlanArtifact';
