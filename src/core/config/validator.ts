/**
 * Configuration Validation Helper Module
 *
 * Provides comprehensive validation utilities for RepoConfig including:
 * - Schema validation with actionable error messages
 * - Environment variable validation
 * - Integration connectivity checks
 * - Governance policy enforcement
 * - Migration compatibility verification
 */

import {
  type RepoConfig,
  type ValidationResult,
  type ValidationError,
  loadRepoConfig,
  formatValidationErrors,
  RepoConfigSchema,
} from './RepoConfig';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================================
// Validation Options
// ============================================================================

export interface ValidatorOptions {
  /**
   * Check that integration credentials are available
   */
  checkCredentials?: boolean;

  /**
   * Verify that required directories exist
   */
  checkDirectories?: boolean;

  /**
   * Validate governance policy compliance
   */
  enforceGovernance?: boolean;

  /**
   * Check file permissions for config directory
   */
  checkPermissions?: boolean;

  /**
   * Fail validation if warnings are present
   */
  strictMode?: boolean;
}

export interface ExtendedValidationResult extends ValidationResult {
  /**
   * Additional context about validation checks performed
   */
  checks?: {
    credentials: boolean;
    directories: boolean;
    governance: boolean;
    permissions: boolean;
  };

  /**
   * Performance metadata
   */
  metadata?: {
    validation_time_ms: number;
    config_file_size_bytes: number;
  };
}

// ============================================================================
// Main Validation Functions
// ============================================================================

/**
 * Validate RepoConfig with comprehensive checks
 *
 * This function performs multi-layer validation:
 * 1. Schema validation (structure, types, constraints)
 * 2. Credential availability (if enabled)
 * 3. Directory existence (if enabled)
 * 4. Governance policy enforcement (if enabled)
 * 5. File permissions (if enabled)
 *
 * @param configPath Path to config.json
 * @param options Validation options
 * @returns Extended validation result with check metadata
 */
export async function validateRepoConfig(
  configPath: string,
  options: ValidatorOptions = {}
): Promise<ExtendedValidationResult> {
  const startTime = Date.now();

  // Set defaults
  const opts: Required<ValidatorOptions> = {
    checkCredentials: options.checkCredentials ?? true,
    checkDirectories: options.checkDirectories ?? true,
    enforceGovernance: options.enforceGovernance ?? false,
    checkPermissions: options.checkPermissions ?? false,
    strictMode: options.strictMode ?? false,
  };

  // Load and validate schema
  const baseResult = await loadRepoConfig(configPath);

  if (!baseResult.success) {
    return {
      ...baseResult,
      checks: {
        credentials: false,
        directories: false,
        governance: false,
        permissions: false,
      },
      metadata: {
        validation_time_ms: Date.now() - startTime,
        config_file_size_bytes: fs.existsSync(configPath) ? fs.statSync(configPath).size : 0,
      },
    };
  }

  const config = baseResult.config!;
  const warnings = [...(baseResult.warnings || [])];
  const errors: ValidationError[] = [];

  // Check directories
  if (opts.checkDirectories) {
    const dirErrors = validateDirectories(config);
    errors.push(...dirErrors);
  }

  // Check permissions
  if (opts.checkPermissions) {
    const permErrors = validatePermissions(configPath);
    errors.push(...permErrors);
  }

  // Enforce governance
  if (opts.enforceGovernance) {
    const govErrors = validateGovernance(config);
    errors.push(...govErrors);
  }

  // Get file size
  const fileSize = fs.statSync(configPath).size;

  // Build result
  const result: ExtendedValidationResult = {
    success: errors.length === 0 && (!opts.strictMode || warnings.length === 0),
    config,
    checks: {
      credentials: opts.checkCredentials,
      directories: opts.checkDirectories,
      governance: opts.enforceGovernance,
      permissions: opts.checkPermissions,
    },
    metadata: {
      validation_time_ms: Date.now() - startTime,
      config_file_size_bytes: fileSize,
    },
  };

  // Add optional fields only if they have values
  if (errors.length > 0) {
    result.errors = errors;
  }
  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return result;
}

/**
 * Validate that required directories exist and are writable
 * @param config Validated config
 * @returns Array of validation errors
 */
function validateDirectories(config: RepoConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const runDir = config.runtime.run_directory;

  // Check if run directory exists
  if (!fs.existsSync(runDir)) {
    errors.push({
      path: 'runtime.run_directory',
      message: `Run directory does not exist: ${runDir}`,
      suggestion: `Create directory: mkdir -p ${runDir}`,
    });
    return errors; // Can't check writability if dir doesn't exist
  }

  // Check if run directory is writable
  try {
    fs.accessSync(runDir, fs.constants.W_OK);
  } catch {
    errors.push({
      path: 'runtime.run_directory',
      message: `Run directory is not writable: ${runDir}`,
      suggestion: `Fix permissions: chmod u+w ${runDir}`,
    });
  }

  return errors;
}

/**
 * Validate file permissions for config directory
 * @param configPath Path to config file
 * @returns Array of validation errors
 */
function validatePermissions(configPath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const configDir = path.dirname(configPath);

  try {
    // Check config file is readable
    fs.accessSync(configPath, fs.constants.R_OK);

    // Check config directory is writable (needed for backups)
    fs.accessSync(configDir, fs.constants.W_OK);
  } catch (error) {
    const reason = error instanceof Error ? ` (${error.message})` : '';
    errors.push({
      path: 'permissions',
      message: `Insufficient permissions for config directory: ${configDir}${reason}`,
      suggestion: `Ensure read/write access: chmod u+rw ${configPath}`,
    });
  }

  return errors;
}

/**
 * Validate governance policy compliance
 * @param config Validated config
 * @returns Array of validation errors
 */
function validateGovernance(config: RepoConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check if governance structure exists
  if (!config.governance) {
    errors.push({
      path: 'governance',
      message: 'Governance controls are not configured',
      suggestion:
        'Add "governance" section to enable approval workflows and accountability tracking',
    });
    return errors;
  }

  const { approval_workflow, accountability, risk_controls } = config.governance;

  // Validate approval workflow is not completely disabled
  const anyApprovalEnabled = Object.values(approval_workflow).some((v) => v === true);
  if (!anyApprovalEnabled) {
    errors.push({
      path: 'governance.approval_workflow',
      message:
        'All approval gates are disabled - this violates ADR-5 human-in-the-loop requirements',
      suggestion: 'Enable at least one approval gate (recommended: require_approval_for_pr)',
    });
  }

  // Validate accountability settings
  if (!accountability.record_approver_identity) {
    errors.push({
      path: 'governance.accountability.record_approver_identity',
      message: 'Approver identity tracking is disabled',
      suggestion: 'Enable "record_approver_identity" for audit compliance',
    });
  }

  // Validate risk controls
  if (!risk_controls.prevent_force_push) {
    errors.push({
      path: 'governance.risk_controls.prevent_force_push',
      message: 'Force push prevention is disabled',
      suggestion: 'Enable "prevent_force_push" to protect against history rewriting',
    });
  }

  if (!risk_controls.prevent_auto_merge) {
    errors.push({
      path: 'governance.risk_controls.prevent_auto_merge',
      message: 'Auto-merge prevention is disabled',
      suggestion: 'Enable "prevent_auto_merge" unless explicitly authorized',
    });
  }

  return errors;
}

// ============================================================================
// Environment Variable Validation
// ============================================================================

/**
 * Check if required environment variables are set
 * @param config Validated config
 * @returns Map of variable names to availability status
 */
export function validateEnvironmentVariables(
  config: RepoConfig
): Record<string, { required: boolean; present: boolean; value?: string | undefined }> {
  const result: Record<
    string,
    { required: boolean; present: boolean; value?: string | undefined }
  > = {};

  // GitHub credentials
  if (config.github.enabled) {
    const tokenVar = config.github.token_env_var;
    const tokenValue = process.env[tokenVar];
    result[tokenVar] = {
      required: true,
      present: !!tokenValue,
      value: tokenValue ? '***REDACTED***' : undefined,
    };
  }

  // Linear credentials
  if (config.linear.enabled) {
    const keyVar = config.linear.api_key_env_var;
    const keyValue = process.env[keyVar];
    result[keyVar] = {
      required: true,
      present: !!keyValue,
      value: keyValue ? '***REDACTED***' : undefined,
    };
  }

  // Agent endpoint
  const endpointVar = config.runtime.agent_endpoint_env_var;
  const endpointValue = process.env[endpointVar];
  result[endpointVar] = {
    required: !config.runtime.agent_endpoint, // Required if not in config
    present: !!endpointValue || !!config.runtime.agent_endpoint,
    value: endpointValue || config.runtime.agent_endpoint || undefined,
  };

  return result;
}

// ============================================================================
// Schema Compatibility Checking
// ============================================================================

/**
 * Check if config can be safely migrated to a new schema version
 * @param config Current config
 * @param targetVersion Target schema version
 * @param rawConfig Optional raw config (before Zod parsing) to detect explicitly set fields
 * @returns Compatibility result with migration notes
 */
export function checkSchemaCompatibility(
  config: RepoConfig,
  targetVersion: string,
  rawConfig?: unknown
): {
  compatible: boolean;
  current_version: string;
  target_version: string;
  breaking_changes: string[];
  migration_notes: string[];
} {
  const current = config.schema_version;
  const [currentMajor] = current.split('.').map(Number);
  const [targetMajor] = targetVersion.split('.').map(Number);

  const breakingChanges: string[] = [];
  const migrationNotes: string[] = [];

  // Major version change indicates breaking changes
  if (targetMajor > currentMajor) {
    breakingChanges.push(
      `Major version upgrade from ${current} to ${targetVersion} may contain breaking changes`
    );
    migrationNotes.push('Review docs/reference/config/config_migrations.md before upgrading');
    migrationNotes.push('Create backup of current config before migration');
    migrationNotes.push('Test migration in non-production environment first');
  }

  // Check for deprecated fields and provide specific migration paths
  // Use rawConfig if provided to detect explicitly set fields (avoids false positives from defaults)
  const raw = rawConfig as { safety?: unknown; governance_notes?: unknown } | undefined;

  // Deprecated: governance_notes at root level
  if (config.governance_notes && !config.governance?.governance_notes) {
    migrationNotes.push('Migrate "governance_notes" to "governance.governance_notes"');
  }

  // Check safety.* fields only if we have raw config to detect explicit settings
  if (raw?.safety && typeof raw.safety === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: deprecated safety fields are open-ended
    const rawSafety = raw.safety as Record<string, unknown>;

    // Deprecated: safety.require_approval_for_prd → governance.approval_workflow
    if ('require_approval_for_prd' in rawSafety) {
      migrationNotes.push(
        'Migrate "safety.require_approval_for_prd" to "governance.approval_workflow.require_approval_for_prd"'
      );
    }

    // Deprecated: safety.require_approval_for_plan → governance.approval_workflow
    if ('require_approval_for_plan' in rawSafety) {
      migrationNotes.push(
        'Migrate "safety.require_approval_for_plan" to "governance.approval_workflow.require_approval_for_plan"'
      );
    }

    // Deprecated: safety.require_approval_for_pr → governance.approval_workflow
    if ('require_approval_for_pr' in rawSafety) {
      migrationNotes.push(
        'Migrate "safety.require_approval_for_pr" to "governance.approval_workflow.require_approval_for_pr"'
      );
    }

    // Deprecated: safety.prevent_force_push → governance.risk_controls
    if ('prevent_force_push' in rawSafety) {
      migrationNotes.push(
        'Migrate "safety.prevent_force_push" to "governance.risk_controls.prevent_force_push"'
      );
    }
  }

  return {
    compatible: breakingChanges.length === 0,
    current_version: current,
    target_version: targetVersion,
    breaking_changes: breakingChanges,
    migration_notes: migrationNotes,
  };
}

// ============================================================================
// Validation Result Formatting
// ============================================================================

/**
 * Format extended validation result for CLI display
 * @param result Validation result
 * @returns Formatted string for terminal output
 */
export function formatExtendedValidationResult(result: ExtendedValidationResult): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push('✓ Configuration validation passed');
    lines.push('');
  } else {
    lines.push('✗ Configuration validation failed');
    lines.push('');
  }

  // Show errors
  if (result.errors && result.errors.length > 0) {
    lines.push('Errors:');
    for (const error of result.errors) {
      lines.push(`  • ${error.path}: ${error.message}`);
      if (error.suggestion) {
        lines.push(`    → ${error.suggestion}`);
      }
    }
    lines.push('');
  }

  // Show warnings
  if (result.warnings && result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
    lines.push('');
  }

  // Show checks performed
  if (result.checks) {
    lines.push('Validation checks performed:');
    lines.push(`  • Credentials:  ${result.checks.credentials ? '✓' : '○'}`);
    lines.push(`  • Directories:  ${result.checks.directories ? '✓' : '○'}`);
    lines.push(`  • Governance:   ${result.checks.governance ? '✓' : '○'}`);
    lines.push(`  • Permissions:  ${result.checks.permissions ? '✓' : '○'}`);
    lines.push('');
  }

  // Show metadata
  if (result.metadata) {
    lines.push('Metadata:');
    lines.push(`  Validation time: ${result.metadata.validation_time_ms}ms`);
    lines.push(`  Config file size: ${result.metadata.config_file_size_bytes} bytes`);
    lines.push('');
  }

  return lines.join('\n');
}

// Re-export core validation functions
export { loadRepoConfig, formatValidationErrors, RepoConfigSchema };
