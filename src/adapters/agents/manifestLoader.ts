/**
 * Agent Manifest Loader
 *
 * Loads, validates, and manages agent provider capability manifests supporting
 * bring-your-own-agent workflows. Integrates with CostTracker for pricing
 * registration and provides manifest-driven provider selection.
 *
 * Key features:
 * - JSON Schema validation via Zod with strict mode
 * - Manifest caching with content hash-based change detection
 * - Cost configuration registration with CostTracker
 * - Provider selection based on capability requirements
 * - Resume workflow support via manifest hash persistence
 * - CLI-level validation with actionable error messages
 *
 * Implements ADR-1 (Agent Execution Model), ADR-4 (Context/Token Budget),
 * ADR-7 (Validation Policy), and BYO-agent provider requirements.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import type { CostTracker, ProviderCostConfig } from '../../telemetry/costTracker';
import type { StructuredLogger } from '../../telemetry/logger';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// Zod Schema Definitions
// ============================================================================

/**
 * Rate limit configuration schema
 * REQUIRED per acceptance criteria - manifests missing this will be rejected
 */
const RateLimitsSchema = z
  .object({
    requestsPerMinute: z.number().int().positive(),
    tokensPerMinute: z.number().int().nonnegative().optional(),
    burstCapacity: z.number().int().nonnegative().optional(),
    concurrentRequests: z.number().int().positive().optional(),
  })
  .strict();

/**
 * Model-specific cost configuration schema
 */
const ModelCostConfigSchema = z
  .object({
    modelId: z.string().min(1),
    inputCostPer1kTokens: z.number().nonnegative(),
    outputCostPer1kTokens: z.number().nonnegative(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

/**
 * Cost configuration schema
 * REQUIRED per acceptance criteria - manifests missing pricing will be rejected
 */
const CostConfigSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('USD'),
    models: z.array(ModelCostConfigSchema).min(1),
  })
  .strict();

/**
 * Tool support flags schema
 */
const ToolsSchema = z
  .object({
    streaming: z.boolean().default(false),
    functionCalling: z.boolean().default(false),
    vision: z.boolean().default(false),
    jsonMode: z.boolean().default(false),
    embeddings: z.boolean().default(false),
  })
  .strict()
  .optional();

/**
 * Pipeline feature capability flags schema (ADR-1 capability set)
 */
const FeaturesSchema = z
  .object({
    prdGeneration: z.boolean().default(true),
    specGeneration: z.boolean().default(true),
    codeGeneration: z.boolean().default(true),
    codeReview: z.boolean().default(true),
    testGeneration: z.boolean().default(true),
    summarization: z.boolean().default(true),
  })
  .strict()
  .optional();

/**
 * API endpoint configuration schema
 */
const EndpointSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    authMethod: z.enum(['bearer', 'api-key', 'oauth', 'none']).default('bearer'),
    timeout: z.number().int().min(1000).default(30000),
  })
  .strict()
  .optional();

/**
 * Retry policy schema for transient error handling
 */
const RetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().nonnegative().default(3),
    baseDelayMs: z.number().int().nonnegative().default(1000),
    maxDelayMs: z.number().int().nonnegative().default(60000),
    backoffMultiplier: z.number().min(1).default(2),
  })
  .strict();

/**
 * Error taxonomy schema for deterministic failure classification
 */
const ErrorTaxonomySchema = z
  .object({
    transientErrorCodes: z.array(z.string()).optional(),
    permanentErrorCodes: z.array(z.string()).optional(),
    humanActionErrorCodes: z.array(z.string()).optional(),
    retryPolicy: RetryPolicySchema.optional(),
  })
  .strict()
  .optional();

/**
 * Execution context override schema
 */
const ContextConfigSchema = z
  .object({
    preferredModelId: z.string().optional(),
    maxTokensOverride: z.number().int().positive().optional(),
    temperatureOverride: z.number().min(0).max(2).optional(),
    timeoutOverride: z.number().int().min(1000).optional(),
  })
  .strict();

const ExecutionContextsSchema = z
  .object({
    code_generation: ContextConfigSchema.optional(),
    code_review: ContextConfigSchema.optional(),
    test_generation: ContextConfigSchema.optional(),
    refactoring: ContextConfigSchema.optional(),
    documentation: ContextConfigSchema.optional(),
    prd_generation: ContextConfigSchema.optional(),
    spec_generation: ContextConfigSchema.optional(),
    summarization: ContextConfigSchema.optional(),
  })
  .strict()
  .optional();

/**
 * Complete agent manifest schema
 */
const AgentManifestSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, {
      message: 'schema_version must be valid semver (e.g., "1.0.0")',
    }),
    providerId: z
      .string()
      .regex(/^[a-z0-9_-]+$/, {
        message: 'providerId must be lowercase alphanumeric with hyphens/underscores',
      })
      .min(1),
    name: z.string().min(1),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, {
      message: 'version must be valid semver (e.g., "1.0.0")',
    }),
    description: z.string().optional(),
    rateLimits: RateLimitsSchema,
    costConfig: CostConfigSchema,
    tools: ToolsSchema,
    features: FeaturesSchema,
    endpoint: EndpointSchema,
    fallbackProvider: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .optional(),
    errorTaxonomy: ErrorTaxonomySchema,
    executionContexts: ExecutionContextsSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type AgentManifest = z.infer<typeof AgentManifestSchema>;
export type RateLimits = z.infer<typeof RateLimitsSchema>;
export type ModelCostConfig = z.infer<typeof ModelCostConfigSchema>;
export type CostConfig = z.infer<typeof CostConfigSchema>;
export type Tools = z.infer<typeof ToolsSchema>;
export type Features = z.infer<typeof FeaturesSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
export type ErrorTaxonomy = z.infer<typeof ErrorTaxonomySchema>;
export type ExecutionContextConfig = z.infer<typeof ContextConfigSchema>;
export type ExecutionContextOverrides = z.infer<typeof ExecutionContextsSchema>;

// ============================================================================
// Manifest Loading & Validation
// ============================================================================

/**
 * Validation result for manifest parsing
 */
export interface ManifestValidationResult {
  success: boolean;
  manifest?: AgentManifest;
  errors?: Array<{ path: string; message: string }>;
}

/**
 * Parse and validate agent manifest JSON
 *
 * @param json - Raw JSON object to validate
 * @returns Validation result with parsed manifest or errors
 */
export function parseAgentManifest(json: unknown): ManifestValidationResult {
  const result = AgentManifestSchema.safeParse(json);

  if (result.success) {
    return {
      success: true,
      manifest: result.data,
    };
  }

  return {
    success: false,
    errors: result.error.issues.map((err) => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}

/**
 * Load and parse manifest from file system
 *
 * @param manifestPath - Absolute path to manifest JSON file
 * @returns Validation result with parsed manifest or errors
 * @throws Error if file cannot be read
 */
export async function loadManifestFromFile(
  manifestPath: string
): Promise<ManifestValidationResult> {
  const content = await fs.readFile(manifestPath, 'utf-8');
  const json: unknown = JSON.parse(content);
  return parseAgentManifest(json);
}

/**
 * Compute SHA-256 hash of manifest content for change detection
 *
 * @param content - Manifest file content
 * @returns Hex-encoded SHA-256 hash
 */
export function computeManifestHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ============================================================================
// Provider Selection & Capability Matching
// ============================================================================

/**
 * Provider capability requirements for selection filtering
 */
export interface ProviderRequirements {
  /** Minimum context window size (tokens) */
  minContextWindow?: number;
  /** Required tool support flags */
  requiredTools?: Partial<Tools>;
  /** Required feature support flags */
  requiredFeatures?: Partial<Features>;
  /** Maximum acceptable cost per 1K tokens (combined input+output) */
  maxCostPer1kTokens?: number;
  /** Minimum requests per minute capacity */
  minRequestsPerMinute?: number;
}

/**
 * Check if manifest satisfies given capability requirements
 *
 * @param manifest - Agent manifest to evaluate
 * @param requirements - Capability requirements
 * @returns True if manifest meets all requirements
 */
export function matchesRequirements(
  manifest: AgentManifest,
  requirements: ProviderRequirements
): boolean {
  // Check rate limits
  if (requirements.minRequestsPerMinute !== undefined) {
    if (manifest.rateLimits.requestsPerMinute < requirements.minRequestsPerMinute) {
      return false;
    }
  }

  // Check context window (across all models)
  if (requirements.minContextWindow !== undefined) {
    const hasModelWithSufficientContext = manifest.costConfig.models.some(
      (model) => (model.contextWindow ?? 0) >= requirements.minContextWindow!
    );
    if (!hasModelWithSufficientContext) {
      return false;
    }
  }

  // Check tool requirements
  if (requirements.requiredTools) {
    const tools = manifest.tools ?? {};
    for (const [toolName, required] of Object.entries(requirements.requiredTools)) {
      if (required && !tools[toolName as keyof Tools]) {
        return false;
      }
    }
  }

  // Check feature requirements
  if (requirements.requiredFeatures) {
    const features = manifest.features ?? {};
    for (const [featureName, required] of Object.entries(requirements.requiredFeatures)) {
      if (required && !features[featureName as keyof Features]) {
        return false;
      }
    }
  }

  // Check cost constraints (compare average cost across models)
  if (requirements.maxCostPer1kTokens !== undefined) {
    const avgCost =
      manifest.costConfig.models.reduce(
        (sum, model) => sum + model.inputCostPer1kTokens + model.outputCostPer1kTokens,
        0
      ) / manifest.costConfig.models.length;

    if (avgCost > requirements.maxCostPer1kTokens) {
      return false;
    }
  }

  return true;
}

/**
 * Rank manifests by cost-effectiveness (lower cost = higher rank)
 *
 * @param manifests - Array of manifests to rank
 * @returns Manifests sorted by ascending average cost
 */
export function rankByPrice(manifests: AgentManifest[]): AgentManifest[] {
  return [...manifests].sort((a, b) => {
    const avgCostA =
      a.costConfig.models.reduce(
        (sum, m) => sum + m.inputCostPer1kTokens + m.outputCostPer1kTokens,
        0
      ) / a.costConfig.models.length;

    const avgCostB =
      b.costConfig.models.reduce(
        (sum, m) => sum + m.inputCostPer1kTokens + m.outputCostPer1kTokens,
        0
      ) / b.costConfig.models.length;

    return avgCostA - avgCostB;
  });
}

// ============================================================================
// Manifest Registry
// ============================================================================

/**
 * Cached manifest entry with metadata
 */
interface CachedManifest {
  manifest: AgentManifest;
  hash: string;
  loadedAt: string;
  sourcePath: string;
}

/**
 * Agent manifest registry with caching and provider selection
 */
export class ManifestLoader {
  private readonly registry: Map<string, CachedManifest>;
  private readonly logger: StructuredLogger;
  private costTracker?: CostTracker;

  constructor(logger: StructuredLogger) {
    this.registry = new Map();
    this.logger = logger;
  }

  /**
   * Set cost tracker for automatic cost config registration
   */
  setCostTracker(costTracker: CostTracker): void {
    this.costTracker = costTracker;
  }

  /**
   * Load manifest from file and register in cache
   *
   * @param manifestPath - Absolute path to manifest JSON file
   * @returns Loaded manifest
   * @throws Error if manifest is invalid or missing required fields
   */
  async loadManifest(manifestPath: string): Promise<AgentManifest> {
    this.logger.info('Loading agent manifest', { path: manifestPath });

    // Read and hash content
    const content = await fs.readFile(manifestPath, 'utf-8');
    const hash = computeManifestHash(content);

    // Check if already cached with same hash
    const json: unknown = JSON.parse(content);
    const providerIdRaw =
      typeof json === 'object' && json !== null && 'providerId' in json
        ? (json as { providerId?: unknown }).providerId
        : undefined;
    const providerId = typeof providerIdRaw === 'string' ? providerIdRaw : undefined;

    if (providerId) {
      const cached = this.registry.get(providerId);
      if (cached && cached.hash === hash) {
        this.logger.debug('Using cached manifest', { providerId, hash });
        return cached.manifest;
      }
    }

    // Validate manifest
    const validationResult = parseAgentManifest(json);

    if (!validationResult.success) {
      const errorMsg = validationResult
        .errors!.map((err) => `  - ${err.path}: ${err.message}`)
        .join('\n');

      this.logger.error('Manifest validation failed', {
        path: manifestPath,
        errors: validationResult.errors,
      });

      throw new Error(
        `Invalid agent manifest at ${manifestPath}:\n${errorMsg}\n\n` +
          'Manifests MUST include "rateLimits" and "costConfig" per acceptance criteria. ' +
          'See docs/reference/agent_manifest_schema.json for the complete schema.'
      );
    }

    const manifest = validationResult.manifest!;

    // Register with cost tracker
    if (this.costTracker) {
      this.registerCostConfigs(manifest);
    }

    // Cache manifest
    const cached: CachedManifest = {
      manifest,
      hash,
      loadedAt: new Date().toISOString(),
      sourcePath: manifestPath,
    };

    this.registry.set(manifest.providerId, cached);

    this.logger.info('Manifest loaded and registered', {
      providerId: manifest.providerId,
      version: manifest.version,
      models: manifest.costConfig.models.map((m) => m.modelId),
      rateLimits: manifest.rateLimits,
    });

    return manifest;
  }

  /**
   * Register manifest directly (used for test fixtures or preloaded providers)
   */
  registerManifest(
    manifest: AgentManifest,
    metadata?: { hash?: string; loadedAt?: string; sourcePath?: string }
  ): void {
    const cached: CachedManifest = {
      manifest,
      hash: metadata?.hash ?? computeManifestHash(JSON.stringify(manifest)),
      loadedAt: metadata?.loadedAt ?? new Date().toISOString(),
      sourcePath: metadata?.sourcePath ?? '<in-memory>',
    };

    this.registry.set(manifest.providerId, cached);
  }

  /**
   * Register manifest cost configurations with cost tracker
   */
  private registerCostConfigs(manifest: AgentManifest): void {
    if (!this.costTracker) return;

    for (const modelConfig of manifest.costConfig.models) {
      const costConfig: ProviderCostConfig = {
        provider: manifest.providerId,
        model: modelConfig.modelId,
        inputCostPer1kTokens: modelConfig.inputCostPer1kTokens,
        outputCostPer1kTokens: modelConfig.outputCostPer1kTokens,
      };

      this.costTracker.registerCostConfig(costConfig);

      this.logger.debug('Registered cost config', {
        provider: manifest.providerId,
        model: modelConfig.modelId,
        inputCost: modelConfig.inputCostPer1kTokens,
        outputCost: modelConfig.outputCostPer1kTokens,
      });
    }
  }

  /**
   * Load all manifests from a directory
   *
   * @param manifestDir - Directory containing .json manifest files
   * @returns Array of loaded manifests and validation errors
   */
  async loadManifestsFromDirectory(manifestDir: string): Promise<{
    loaded: AgentManifest[];
    errors: Array<{ path: string; error: string }>;
  }> {
    const loaded: AgentManifest[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    try {
      const entries = await fs.readdir(manifestDir, { withFileTypes: true });
      const manifestFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(manifestDir, entry.name));

      this.logger.info('Scanning manifest directory', {
        dir: manifestDir,
        files: manifestFiles.length,
      });

      for (const manifestPath of manifestFiles) {
        try {
          const manifest = await this.loadManifest(manifestPath);
          loaded.push(manifest);
        } catch (error) {
          errors.push({
            path: manifestPath,
            error: getErrorMessage(error),
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to scan manifest directory', {
        dir: manifestDir,
        error: String(error),
      });
    }

    return { loaded, errors };
  }

  /**
   * Get manifest by provider ID
   *
   * @param providerId - Provider identifier
   * @returns Cached manifest or undefined if not found
   */
  getManifest(providerId: string): AgentManifest | undefined {
    return this.registry.get(providerId)?.manifest;
  }

  /**
   * Get manifest hash for change detection
   *
   * @param providerId - Provider identifier
   * @returns Content hash or undefined if not cached
   */
  getManifestHash(providerId: string): string | undefined {
    return this.registry.get(providerId)?.hash;
  }

  /**
   * Select best provider matching capability requirements
   *
   * @param requirements - Capability requirements
   * @param preferredProviderId - Optional preferred provider (checked first)
   * @returns Selected manifest or undefined if none match
   */
  selectProvider(
    requirements: ProviderRequirements,
    preferredProviderId?: string
  ): AgentManifest | undefined {
    // Check preferred provider first
    if (preferredProviderId) {
      const preferred = this.getManifest(preferredProviderId);
      if (preferred && matchesRequirements(preferred, requirements)) {
        this.logger.info('Selected preferred provider', {
          providerId: preferredProviderId,
        });
        return preferred;
      }
    }

    // Filter manifests matching requirements
    const allManifests = Array.from(this.registry.values()).map((c) => c.manifest);
    const matching = allManifests.filter((m) => matchesRequirements(m, requirements));

    if (matching.length === 0) {
      this.logger.warn('No providers match requirements', { requirements });
      return undefined;
    }

    // Rank by price and select cheapest
    const ranked = rankByPrice(matching);
    const selected = ranked[0];

    this.logger.info('Selected provider by cost ranking', {
      providerId: selected.providerId,
      matchingProviders: matching.length,
    });

    return selected;
  }

  /**
   * List all registered provider IDs
   */
  listProviders(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Get registry state for diagnostics
   */
  getRegistryState(): Array<{
    providerId: string;
    version: string;
    hash: string;
    loadedAt: string;
    sourcePath: string;
  }> {
    return Array.from(this.registry.values()).map((cached) => ({
      providerId: cached.manifest.providerId,
      version: cached.manifest.version,
      hash: cached.hash,
      loadedAt: cached.loadedAt,
      sourcePath: cached.sourcePath,
    }));
  }

  /**
   * Clear cached manifests
   */
  clear(): void {
    this.registry.clear();
    this.logger.debug('Manifest registry cleared');
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create manifest loader instance
 */
export function createManifestLoader(logger: StructuredLogger): ManifestLoader {
  return new ManifestLoader(logger);
}

/**
 * Load manifest loader with manifests from standard directory
 *
 * @param repoRoot - Repository root directory
 * @param logger - Structured logger
 * @param costTracker - Optional cost tracker for auto-registration
 * @returns Manifest loader with pre-loaded manifests
 */
export async function loadManifestLoaderFromRepo(
  repoRoot: string,
  logger: StructuredLogger,
  costTracker?: CostTracker
): Promise<{ loader: ManifestLoader; errors: Array<{ path: string; error: string }> }> {
  const loader = createManifestLoader(logger);

  if (costTracker) {
    loader.setCostTracker(costTracker);
  }

  const manifestDir = path.join(repoRoot, '.codepipe', 'agents');
  const { errors } = await loader.loadManifestsFromDirectory(manifestDir);

  return { loader, errors };
}
