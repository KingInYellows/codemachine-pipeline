/**
 * RepoConfig — public surface (barrel re-export)
 *
 * This module re-exports everything from RepoConfigSchema.ts,
 * RepoConfigDefaults.ts, and RepoConfigLoader.ts so that existing consumers
 * can continue to import from this single file.  The internal split is an
 * implementation detail.
 */

// ── Schema types & Zod schemas ──────────────────────────────────────────────
export type {
  ConfigHistoryEntry,
  Governance,
  Project,
  GitHub,
  Linear,
  Runtime,
  Safety,
  FeatureFlags,
  ValidationSettings,
  Constraints,
  ExecutionConfig,
  RepoConfig,
  ValidationError,
  ValidationResult,
} from './RepoConfigSchema';

export {
  ConfigHistoryEntrySchema,
  GovernanceSchema,
  ProjectSchema,
  GitHubSchema,
  LinearSchema,
  RuntimeSchema,
  SafetySchema,
  FeatureFlagsSchema,
  ValidationSettingsSchema,
  ConstraintsSchema,
  ExecutionEngineType,
  ExecutionConfigSchema,
  RepoConfigSchema,
} from './RepoConfigSchema';

// ── Default values & factory functions ──────────────────────────────────────
export { createDefaultConfig, DEFAULT_EXECUTION_CONFIG } from './RepoConfigDefaults';

// ── Loader, env overrides & formatting helpers ──────────────────────────────
export {
  loadRepoConfig,
  applyEnvironmentOverrides,
  formatValidationErrors,
  addConfigHistoryEntry,
} from './RepoConfigLoader';
