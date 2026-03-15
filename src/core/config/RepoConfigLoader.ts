/**
 * RepoConfig Loader
 *
 * Extracted from RepoConfig.ts: runtime loading, environment variable overrides,
 * validation error formatting, and config history management.
 *
 * Consumers should continue to import from RepoConfig.ts; the internal split
 * into RepoConfigSchema.ts, RepoConfigDefaults.ts, and RepoConfigLoader.ts is
 * an implementation detail.
 */

import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';

import {
  RepoConfigSchema,
  ExecutionEngineType,
  type RepoConfig,
  type ValidationError,
  type ValidationResult,
  type ConfigHistoryEntry,
} from './RepoConfigSchema';
import {
  ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV,
  hasCustomGitHubApiBaseUrl,
} from '../../utils/githubApiUrl.js';

/**
 * Load and validate RepoConfig from file
 * @param configPath Path to config.json file
 * @returns Validation result with parsed config or actionable errors
 */
export async function loadRepoConfig(configPath: string): Promise<ValidationResult> {
  try {
    // Check if file exists and is readable
    try {
      await access(configPath, constants.R_OK);
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EACCES') {
        return {
          success: false,
          errors: [
            {
              path: 'file',
              message: `Config file exists but is not readable: ${configPath}`,
              suggestion: 'Check file permissions. Run: chmod +r ' + configPath,
            },
          ],
        };
      }
      return {
        success: false,
        errors: [
          {
            path: 'file',
            message: `Config file not found: ${configPath}`,
            suggestion: 'Run "codepipe init" to create the configuration file',
          },
        ],
      };
    }

    // Read and parse JSON
    const rawContent = await readFile(configPath, 'utf-8');
    let rawConfig: unknown;

    try {
      rawConfig = JSON.parse(rawContent);
    } catch (parseError) {
      return {
        success: false,
        errors: [
          {
            path: 'json',
            message: `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`,
            suggestion: 'Check for syntax errors (missing commas, quotes, brackets)',
          },
        ],
      };
    }

    // Validate with zod
    const parseResult = RepoConfigSchema.safeParse(rawConfig);

    if (!parseResult.success) {
      const errors: ValidationError[] = parseResult.error.issues.map((err) => {
        const path = err.path.join('.');
        const suggestion = generateSuggestion(path, err.message);
        const errorEntry: ValidationError = {
          path: path || 'root',
          message: err.message,
        };

        if (suggestion !== undefined) {
          errorEntry.suggestion = suggestion;
        }

        return errorEntry;
      });

      return {
        success: false,
        errors,
      };
    }

    // Apply environment overrides
    const config = applyEnvironmentOverrides(parseResult.data);

    // Check environment variables for credentials
    const warnings: string[] = [];

    if (config.github.enabled) {
      const githubToken = process.env[config.github.token_env_var];
      if (!githubToken) {
        warnings.push(
          `GitHub integration enabled but ${config.github.token_env_var} not set. ` +
            `Set ${config.github.token_env_var} with scopes: ${config.github.required_scopes.join(', ')}`
        );
      }
    }

    if (
      config.github.enabled &&
      hasCustomGitHubApiBaseUrl(config.github.api_base_url) &&
      process.env[ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV] !== '1'
    ) {
      warnings.push(
        `Custom github.api_base_url detected. Non-default GitHub API hosts require https and explicit opt-in; ` +
          `set ${ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV}=1 only for a trusted GitHub Enterprise deployment.`
      );
    }

    if (config.linear.enabled) {
      const linearKey = process.env[config.linear.api_key_env_var];
      if (!linearKey) {
        warnings.push(`Linear integration enabled but ${config.linear.api_key_env_var} not set`);
      }
    }

    if (config.runtime.agent_endpoint) {
      // Agent endpoint specified in config
    } else {
      const agentEndpoint = process.env[config.runtime.agent_endpoint_env_var];
      if (!agentEndpoint) {
        warnings.push(
          `Agent endpoint not configured. Set ${config.runtime.agent_endpoint_env_var} or add runtime.agent_endpoint to config`
        );
      }
    }

    // Check for deprecated fields
    if (config.governance_notes && !config.governance?.governance_notes) {
      warnings.push(
        'Field "governance_notes" is deprecated. Migrate to "governance.governance_notes"'
      );
    }

    const result: ValidationResult = {
      success: true,
      config,
    };

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    return result;
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'system',
          message: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
    };
  }
}

/**
 * Generate actionable suggestions for validation errors
 * @param path Error path
 * @param message Error message
 * @returns Suggestion string
 */
function generateSuggestion(path: string, message: string): string | undefined {
  if (path.includes('schema_version')) {
    return 'Use semver format: "1.0.0"';
  }

  if (path.includes('repo_url')) {
    return 'Use format: "https://github.com/org/repo.git" or "git@github.com:org/repo.git"';
  }

  if (path.includes('enabled')) {
    return 'Must be boolean: true or false';
  }

  if (path.includes('token_env_var') || path.includes('api_key_env_var')) {
    return 'Specify the environment variable name (e.g., "GITHUB_TOKEN")';
  }

  if (path.includes('api_base_url') || path.includes('agent_endpoint')) {
    return 'Must be a valid URL starting with http:// or https://';
  }

  if (message.includes('required')) {
    return `Add "${path}" field to configuration`;
  }

  return undefined;
}

/**
 * Apply environment variable overrides to config
 * Follows CODEPIPE_<SECTION>_<FIELD> naming convention
 *
 * Supported overrides:
 * - CODEPIPE_GITHUB_TOKEN -> github.token_env_var
 * - CODEPIPE_LINEAR_API_KEY -> linear.api_key_env_var
 * - CODEPIPE_RUNTIME_AGENT_ENDPOINT -> runtime.agent_endpoint
 * - CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS -> runtime.max_concurrent_tasks
 * - CODEPIPE_RUNTIME_TIMEOUT_MINUTES -> runtime.timeout_minutes
 * - CODEPIPE_EXECUTION_CLI_PATH -> execution.codemachine_cli_path
 * - CODEPIPE_EXECUTION_DEFAULT_ENGINE -> execution.default_engine
 * - CODEPIPE_EXECUTION_TIMEOUT_MS -> execution.task_timeout_ms
 *
 * @param config Base configuration
 * @returns Config with environment overrides applied
 */
export function applyEnvironmentOverrides(config: RepoConfig): RepoConfig {
  const overridden = { ...config };

  // GitHub overrides
  const githubToken = process.env.CODEPIPE_GITHUB_TOKEN;
  if (githubToken) {
    overridden.github = { ...overridden.github, token_env_var: 'CODEPIPE_GITHUB_TOKEN' };
  }

  // Linear overrides
  const linearKey = process.env.CODEPIPE_LINEAR_API_KEY;
  if (linearKey) {
    overridden.linear = { ...overridden.linear, api_key_env_var: 'CODEPIPE_LINEAR_API_KEY' };
  }

  // Runtime overrides
  const agentEndpoint = process.env.CODEPIPE_RUNTIME_AGENT_ENDPOINT;
  if (agentEndpoint) {
    overridden.runtime = { ...overridden.runtime, agent_endpoint: agentEndpoint };
  }

  const maxConcurrentTasks = process.env.CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS;
  if (maxConcurrentTasks) {
    const parsed = parseInt(maxConcurrentTasks, 10);
    if (!isNaN(parsed)) {
      overridden.runtime = { ...overridden.runtime, max_concurrent_tasks: parsed };
    }
  }

  const timeoutMinutes = process.env.CODEPIPE_RUNTIME_TIMEOUT_MINUTES;
  if (timeoutMinutes) {
    const parsed = parseInt(timeoutMinutes, 10);
    if (!isNaN(parsed)) {
      overridden.runtime = { ...overridden.runtime, timeout_minutes: parsed };
    }
  }

  const codemachineCliPath = process.env.CODEPIPE_EXECUTION_CLI_PATH;
  if (codemachineCliPath && overridden.execution) {
    // SECURITY: validate env override path before applying (prevents injection via env var)
    const SAFE_CLI_PATH = /^[a-zA-Z0-9_\-./:\\]+$/;
    if (
      codemachineCliPath.length > 0 &&
      codemachineCliPath.trim() === codemachineCliPath &&
      SAFE_CLI_PATH.test(codemachineCliPath) &&
      !codemachineCliPath.split(/[\\/]/).includes('..')
    ) {
      overridden.execution = { ...overridden.execution, codemachine_cli_path: codemachineCliPath };
    } else {
      console.warn(
        `[codemachine] CODEPIPE_EXECUTION_CLI_PATH rejected: path failed security validation`
      );
    }
  }

  const defaultEngine = process.env.CODEPIPE_EXECUTION_DEFAULT_ENGINE;
  if (defaultEngine && overridden.execution) {
    if (ExecutionEngineType.safeParse(defaultEngine).success) {
      overridden.execution = {
        ...overridden.execution,
        default_engine: defaultEngine as ExecutionEngineType,
      };
    }
  }

  const taskTimeoutMs = process.env.CODEPIPE_EXECUTION_TIMEOUT_MS;
  if (taskTimeoutMs && overridden.execution) {
    const parsed = parseInt(taskTimeoutMs, 10);
    if (!isNaN(parsed) && parsed >= 60000) {
      overridden.execution = { ...overridden.execution, task_timeout_ms: parsed };
    }
  }

  return overridden;
}

/**
 * Format validation errors for user-friendly display with actionable hints
 * @param errors Array of validation errors
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  const lines = ['Configuration validation failed:', ''];

  for (const error of errors) {
    lines.push(`  \u2022 ${error.path}: ${error.message}`);
    if (error.suggestion) {
      lines.push(`    \u2192 ${error.suggestion}`);
    }
  }

  lines.push('');
  lines.push('For detailed schema documentation, see:');
  lines.push('  docs/reference/config/RepoConfig_schema.md');
  lines.push('  .codepipe/templates/config.example.json');

  return lines.join('\n');
}

/**
 * Add a config history entry (useful for migrations)
 * @param config Current configuration
 * @param entry New history entry
 * @returns Updated configuration
 */
export function addConfigHistoryEntry(
  config: RepoConfig,
  entry: Omit<ConfigHistoryEntry, 'timestamp'>
): RepoConfig {
  return {
    ...config,
    config_history: [
      ...config.config_history,
      {
        ...entry,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
