/**
 * Adapters barrel export
 *
 * Re-exports all adapter modules for external integrations (GitHub, Linear, HTTP, Agent).
 */

// GitHub exports
export {
  GitHubAdapter,
  createGitHubAdapter,
  GitHubAdapterError,
  type GitHubAdapterConfig,
  type RepositoryInfo,
  type CreateBranchParams,
  type GitReference,
  type CreatePullRequestParams,
  type PullRequest,
  type RequestReviewersParams,
  type StatusCheck,
  type MergePullRequestParams,
  type MergeResult,
  type WorkflowDispatchParams,
} from './github/GitHubAdapter.js';

export {
  BranchProtectionAdapter,
  BranchProtectionError,
  type BranchProtectionConfig,
  type BranchProtectionRules,
  type BranchProtectionCompliance,
  type CommitStatus,
  type CheckRun,
  type PullRequestReview,
  type RequiredStatusChecks,
  type RequiredPullRequestReviews,
  type BranchProtectionRestrictions,
} from './github/branchProtection.js';

// Linear exports
export { LinearAdapter, LinearAdapterError } from './linear/LinearAdapter.js';
export type {
  LinearAdapterConfig,
  IssueSnapshot,
  LinearIssue,
  LinearComment,
  UpdateIssueParams,
  PostCommentParams,
  SnapshotMetadata,
  LinearIssueRelation,
  LinearCycleIssue,
  LinearCycle,
  CycleSnapshot,
} from './linear/LinearAdapterTypes.js';
export {
  LinearIssueRelationSchema,
  LinearCycleIssueSchema,
  LinearCycleSchema,
  CycleSnapshotSchema,
} from './linear/LinearAdapterTypes.js';

// Agent exports
export {
  AgentAdapter,
  createAgentAdapter,
  AgentAdapterError,
  type AgentAdapterConfig,
  type AgentSessionRequest,
  type AgentSessionResponse,
  type AgentError,
  type AgentErrorCategory,
  type ExecutionContext,
  type SessionTelemetry,
  type ContextCapabilityRequirements,
  type ProviderInvoker,
  mapTaskTypeToContext,
} from './agents/AgentAdapter.js';

export {
  ManifestLoader,
  createManifestLoader,
  loadManifestLoaderFromRepo,
  parseAgentManifest,
  loadManifestFromFile,
  computeManifestHash,
  matchesRequirements,
  rankByPrice,
  type AgentManifest,
  type ManifestValidationResult,
  type ProviderRequirements,
  type RateLimits,
  type ModelCostConfig,
  type CostConfig,
  type Tools,
  type Features,
  type Endpoint,
  type RetryPolicy,
  type ErrorTaxonomy,
  type ExecutionContextConfig,
  type ExecutionContextOverrides,
} from './agents/manifestLoader.js';

// HTTP exports
export {
  HttpClient,
  HttpError,
  ErrorType,
  Provider,
  type HttpClientConfig,
  type HttpRequestOptions,
  type HttpResponse,
} from './http/client.js';

// CodeMachine-CLI exports
export {
  CodeMachineCLIAdapter,
  resolveBinary,
  clearBinaryCache,
  CODEMACHINE_STRATEGY_NAMES,
  type CodeMachineCLIAdapterOptions,
  type AvailabilityResult,
  type BinaryResolutionResult,
  type CodeMachineExecutionResult,
  type CodeMachineEngineType,
} from './codemachine/index.js';
