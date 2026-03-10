/**
 * Core Models Barrel Export
 *
 * Re-exports all domain model schemas, types, and utilities via sub-barrels.
 *
 * Usage:
 *   import { Feature, FeatureSchema, parseFeature } from '@/core/models';
 */

// Feature lifecycle: Feature, RunArtifact, PlanArtifact
export * from './feature-types';

// Task management: ResearchTask, Specification, ExecutionTask
export * from './task-types';

// Artifacts: ContextDocument, RateLimitEnvelope, ArtifactBundle, TraceLink
export * from './artifact-types';

// Deployment: ApprovalRecord, DeploymentRecord, BranchProtectionReport, PRMetadata
export * from './deployment-types';

// Integrations: IntegrationCredential, AgentProviderCapability, NotificationEvent
export * from './integration-types';
