/**
 * Core Models Barrel Export
 *
 * Centralized exports for all data model schemas, types, and utilities.
 * Provides ergonomic imports for CLI commands and other modules.
 *
 * Usage:
 *   import { Feature, FeatureSchema, parseFeature } from '@/core/models';
 */

// ============================================================================
// Core Models
// ============================================================================

export {
  // Feature
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
  // RunArtifact
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
  // PlanArtifact
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

// ============================================================================
// Task Models
// ============================================================================

export {
  // ResearchTask
  ResearchTask,
  ResearchTaskSchema,
  ResearchStatus,
  ResearchStatusSchema,
  ResearchSource,
  ResearchResult,
  FreshnessRequirement,
  parseResearchTask,
  serializeResearchTask,
  createResearchTask,
  generateCacheKey,
  isCachedResultFresh,
  formatResearchTaskValidationErrors,
} from './ResearchTask';

export {
  // Specification
  Specification,
  SpecificationSchema,
  SpecificationStatus,
  SpecificationStatusSchema,
  ReviewerInfo,
  ChangeLogEntry,
  RiskAssessment,
  TestPlanItem,
  RolloutPlan,
  parseSpecification,
  serializeSpecification,
  createSpecification,
  addChangeLogEntry,
  isFullyApproved,
  getPendingReviewers,
  formatSpecificationValidationErrors,
} from './Specification';

export {
  // ExecutionTask
  ExecutionTask,
  ExecutionTaskSchema,
  ExecutionTaskType,
  ExecutionTaskTypeSchema,
  ExecutionTaskStatus,
  ExecutionTaskStatusSchema,
  TaskError,
  CostTracking,
  RateLimitBudget,
  parseExecutionTask,
  serializeExecutionTask,
  createExecutionTask,
  canRetry,
  areDependenciesCompleted,
  getTaskDuration,
  formatExecutionTaskValidationErrors,
} from './ExecutionTask';

// ============================================================================
// Supporting Models
// ============================================================================

export {
  // ContextDocument
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
  // RateLimitEnvelope
  RateLimitEnvelope,
  RateLimitEnvelopeSchema,
  parseRateLimitEnvelope,
  serializeRateLimitEnvelope,
  createRateLimitEnvelope,
  isRateLimited,
  getTimeUntilReset,
} from './RateLimitEnvelope';

export {
  // ApprovalRecord
  ApprovalRecord,
  ApprovalRecordSchema,
  ApprovalGateType,
  ApprovalGateTypeSchema,
  ApprovalVerdict,
  ApprovalVerdictSchema,
  parseApprovalRecord,
  serializeApprovalRecord,
  createApprovalRecord,
} from './ApprovalRecord';

export {
  // DeploymentRecord
  DeploymentRecord,
  DeploymentRecordSchema,
  DeploymentStatus,
  DeploymentStatusSchema,
  StatusCheck,
  ReviewRecord,
  parseDeploymentRecord,
  serializeDeploymentRecord,
  createDeploymentRecord,
  allStatusChecksPassed,
  allReviewsApproved,
  isReadyToMerge,
} from './DeploymentRecord';

export {
  // IntegrationCredential
  IntegrationCredential,
  IntegrationCredentialSchema,
  parseIntegrationCredential,
} from './IntegrationCredential';

export {
  // AgentProviderCapability
  AgentProviderCapability,
  AgentProviderCapabilitySchema,
  parseAgentProviderCapability,
} from './AgentProviderCapability';

export {
  // NotificationEvent
  NotificationEvent,
  NotificationEventSchema,
  parseNotificationEvent,
} from './NotificationEvent';

export {
  // ArtifactBundle
  ArtifactBundle,
  ArtifactBundleSchema,
  parseArtifactBundle,
} from './ArtifactBundle';

export {
  // TraceLink
  TraceLink,
  TraceLinkSchema,
  parseTraceLink,
} from './TraceLink';
