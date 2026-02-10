/**
 * Agent Adapter
 *
 * Orchestrates agent provider sessions for execution contexts (code generation,
 * review, test generation) with capability routing, tool negotiation, fallback
 * logic, and deterministic error classification.
 *
 * Key features:
 * - Execution context to capability requirements mapping
 * - Provider selection via ManifestLoader with cost optimization
 * - Error taxonomy: transient, permanent, humanAction
 * - Fallback provider retry with rate-limit respect
 * - Session telemetry for audit trails and cost tracking
 * - Deterministic prompt packaging with context hashing
 *
 * Implements ADR-1 (Agent Execution Model), ADR-4 (Context/Token Budget),
 * ADR-7 (Validation Policy), and BYO-agent provider requirements.
 *
 * Section 2.1 artifact: Agent adapter contract for execution task routing
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { StructuredLogger } from '../../telemetry/logger';
import type { CostTracker } from '../../telemetry/costTracker';
import type {
  ManifestLoader,
  AgentManifest,
  ProviderRequirements,
  Features,
  Tools,
} from './manifestLoader';
import type { ExecutionTaskType } from '../../core/models/ExecutionTask';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// Error Taxonomy
// ============================================================================

/**
 * Error classification for deterministic failure handling
 * Per acceptance criteria: error taxonomy alignment for orchestration
 */
const AgentErrorCategorySchema = z.enum([
  'transient', // Retry automatically (network, rate-limit, timeout)
  'permanent', // Do not retry (invalid input, unsupported feature, auth failure)
  'humanAction', // Requires human intervention (ambiguous requirements, policy violation)
]);

export type AgentErrorCategory = z.infer<typeof AgentErrorCategorySchema>;

/**
 * Structured agent error with taxonomy classification
 */
const AgentErrorSchema = z
  .object({
    category: AgentErrorCategorySchema,
    message: z.string().min(1),
    code: z.string().optional(),
    details: z.string().optional(),
    providerId: z.string().optional(),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
    fallbackAttempts: z.number().int().nonnegative().optional(),
    timestamp: z.string().datetime(),
  })
  .strict();

export type AgentError = z.infer<typeof AgentErrorSchema>;

/**
 * Runtime error class for agent adapter failures
 */
export class AgentAdapterError extends Error implements AgentError {
  readonly category: AgentErrorCategory;
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly providerId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  fallbackAttempts: number | undefined;
  readonly timestamp: string;

  constructor(params: AgentError) {
    super(params.message);
    this.name = 'AgentAdapterError';
    this.category = params.category;
    this.code = params.code;
    this.details = params.details;
    this.providerId = params.providerId;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.timestamp = params.timestamp;
    this.fallbackAttempts = params.fallbackAttempts;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ============================================================================
// Execution Context & Capability Mapping
// ============================================================================

/**
 * Execution context classification for capability negotiation
 * Maps ExecutionTask types to provider capability requirements
 */
const ExecutionContextSchema = z.enum([
  'code_generation',
  'code_review',
  'test_generation',
  'refactoring',
  'documentation',
  'prd_generation',
  'spec_generation',
  'summarization',
]);

export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

/**
 * Context-specific capability requirements
 * Used to translate ExecutionTask needs into manifest feature/tool guards
 */
export interface ContextCapabilityRequirements {
  minContextWindow: number;
  requiredFeatures: Partial<Features>;
  requiredTools?: Partial<Tools>;
  preferredModelPattern?: RegExp;
  maxCostPer1kTokens?: number;
}

/**
 * Map execution context to capability requirements
 * Per acceptance criteria: execution tasks specify capability needs
 */
export const CONTEXT_REQUIREMENTS: Record<ExecutionContext, ContextCapabilityRequirements> = {
  code_generation: {
    minContextWindow: 8000,
    requiredFeatures: { codeGeneration: true },
    requiredTools: { functionCalling: true, jsonMode: true },
    maxCostPer1kTokens: 0.15,
  },
  code_review: {
    minContextWindow: 16000,
    requiredFeatures: { codeReview: true },
    requiredTools: { jsonMode: true },
    maxCostPer1kTokens: 0.1,
  },
  test_generation: {
    minContextWindow: 8000,
    requiredFeatures: { testGeneration: true },
    requiredTools: { functionCalling: true, jsonMode: true },
    maxCostPer1kTokens: 0.12,
  },
  refactoring: {
    minContextWindow: 12000,
    requiredFeatures: { codeGeneration: true },
    requiredTools: { functionCalling: true },
    maxCostPer1kTokens: 0.15,
  },
  documentation: {
    minContextWindow: 6000,
    requiredFeatures: { summarization: true },
    maxCostPer1kTokens: 0.08,
  },
  prd_generation: {
    minContextWindow: 10000,
    requiredFeatures: { prdGeneration: true },
    requiredTools: { jsonMode: true },
    maxCostPer1kTokens: 0.1,
  },
  spec_generation: {
    minContextWindow: 12000,
    requiredFeatures: { specGeneration: true },
    requiredTools: { jsonMode: true },
    maxCostPer1kTokens: 0.12,
  },
  summarization: {
    minContextWindow: 4000,
    requiredFeatures: { summarization: true },
    maxCostPer1kTokens: 0.05,
  },
};

/**
 * Map ExecutionTaskType to ExecutionContext
 * Handles legacy task types and provides sensible defaults
 */
export function mapTaskTypeToContext(taskType: ExecutionTaskType): ExecutionContext {
  const mapping: Record<ExecutionTaskType, ExecutionContext> = {
    code_generation: 'code_generation',
    testing: 'test_generation',
    review: 'code_review',
    refactoring: 'refactoring',
    documentation: 'documentation',
    pr_creation: 'summarization', // PR descriptions use summarization
    deployment: 'documentation', // Deployment docs use documentation context
    other: 'summarization', // Generic fallback
  };

  return mapping[taskType];
}

// ============================================================================
// Agent Session
// ============================================================================

/**
 * Agent session request parameters
 */
export interface AgentSessionRequest {
  /** Execution context for capability negotiation */
  context: ExecutionContext;
  /** Structured prompt/input data */
  prompt: unknown;
  /** Execution task ID for tracing */
  taskId: string;
  /** Feature ID for cost attribution */
  featureId: string;
  /** Optional preferred provider ID */
  preferredProviderId?: string;
  /** Optional model override */
  modelId?: string;
  /** Optional context window override */
  maxTokens?: number;
  /** Intentional: agent session metadata varies by provider and use case */
  metadata?: Record<string, unknown>;
}

/**
 * Agent session response
 */
export interface AgentSessionResponse {
  /** Generated output from agent */
  output: unknown;
  /** Selected provider ID */
  providerId: string;
  /** Selected model ID */
  modelId: string;
  /** Session ID for telemetry tracking */
  sessionId: string;
  /** Tokens consumed (input + output) */
  tokensConsumed: number;
  /** Cost in USD */
  costUsd: number;
  /** Processing duration in milliseconds */
  durationMs: number;
  /** Manifest hash for reproducibility */
  manifestHash: string;
  /** Whether fallback was used */
  usedFallback: boolean;
  /** Number of fallback attempts performed */
  fallbackAttempts: number;
}

/**
 * Provider invocation function signature (used for dependency injection/testing)
 */
export type ProviderInvoker = (
  manifest: AgentManifest,
  request: AgentSessionRequest,
  sessionId: string,
  startTime: number,
  fallbackAttempts: number
) => Promise<AgentSessionResponse>;

/**
 * Session telemetry record for audit trails
 * Schema is used for type inference only; runtime validation is not required for internal telemetry
 */
export const SessionTelemetrySchema = z
  .object({
    sessionId: z.string().min(1),
    taskId: z.string().min(1),
    featureId: z.string().min(1),
    context: ExecutionContextSchema,
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    manifestHash: z.string().length(64), // SHA-256 hex
    promptHash: z.string().length(64), // SHA-256 hex for context redaction
    tokensConsumed: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    durationMs: z.number().nonnegative(),
    usedFallback: z.boolean(),
    fallbackAttempts: z.number().int().nonnegative().default(0),
    errorCategory: AgentErrorCategorySchema.optional(),
    timestamp: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type SessionTelemetry = z.infer<typeof SessionTelemetrySchema>;

const TELEMETRY_FILENAME = 'agent_sessions.jsonl';

// ============================================================================
// Agent Adapter
// ============================================================================

/**
 * Agent Adapter configuration
 */
export interface AgentAdapterConfig {
  /** Manifest loader instance */
  manifestLoader: ManifestLoader;
  /** Structured logger */
  logger: StructuredLogger;
  /** Cost tracker for spend attribution */
  costTracker?: CostTracker;
  /** Enable automatic fallback on transient errors */
  enableFallback?: boolean;
  /** Maximum fallback retry attempts */
  maxFallbackAttempts?: number;
  /** Session telemetry output directory */
  telemetryDir?: string;
  /** Optional custom provider invoker (used for testing/mocking) */
  providerInvoker?: ProviderInvoker;
}

/**
 * Agent Adapter - Provider session orchestration with capability routing
 *
 * Core responsibilities:
 * - Translate execution contexts to provider requirements
 * - Select optimal provider via ManifestLoader
 * - Classify errors using taxonomy (transient/permanent/humanAction)
 * - Handle fallback retries with rate-limit respect
 * - Record session telemetry for auditability
 *
 * Per acceptance criteria:
 * - Execution tasks specify capability needs → adapter chooses matching provider
 * - Schema validated during CI
 * - Cost tracking and failure remediation strategies
 */
export class AgentAdapter {
  private readonly manifestLoader: ManifestLoader;
  private readonly logger: StructuredLogger;
  private readonly costTracker: CostTracker | undefined;
  private readonly enableFallback: boolean;
  private readonly maxFallbackAttempts: number;
  private readonly telemetryDir: string | undefined;
  private readonly sessionHistory: SessionTelemetry[] = [];
  private readonly providerInvoker: ProviderInvoker;

  constructor(config: AgentAdapterConfig) {
    this.manifestLoader = config.manifestLoader;
    this.logger = config.logger;
    this.costTracker = config.costTracker;
    this.enableFallback = config.enableFallback ?? true;
    this.maxFallbackAttempts = config.maxFallbackAttempts ?? 2;
    this.telemetryDir = config.telemetryDir;
    this.providerInvoker =
      config.providerInvoker ??
      ((manifest, request, sessionId, startTime, fallbackAttempts) =>
        this.invokeProviderInternal(manifest, request, sessionId, startTime, fallbackAttempts));

    this.logger.info('AgentAdapter initialized', {
      enableFallback: this.enableFallback,
      maxFallbackAttempts: this.maxFallbackAttempts,
    });
  }

  /**
   * Execute agent session for given execution context
   *
   * Workflow:
   * 1. Map context → capability requirements
   * 2. Select provider via ManifestLoader
   * 3. Invoke provider (stub - real implementation would call API)
   * 4. Handle errors with taxonomy classification
   * 5. Retry with fallback if transient error
   * 6. Record session telemetry
   *
   * @param request - Session request parameters
   * @returns Session response with output and metadata
   * @throws AgentError with taxonomy classification
   */
  async executeSession(request: AgentSessionRequest): Promise<AgentSessionResponse> {
    const sessionId = this.generateSessionId();
    const startTime = Date.now();

    this.logger.info('Starting agent session', {
      sessionId,
      taskId: request.taskId,
      context: request.context,
    });

    try {
      // 1. Map context to capability requirements
      const capabilityReqs = this.getCapabilityRequirements(request.context);

      // 2. Select provider
      const manifest = this.selectProvider(capabilityReqs, request.preferredProviderId);

      if (!manifest) {
        throw this.createError(
          'permanent',
          `No provider matches capability requirements for context: ${request.context}`,
          'NO_MATCHING_PROVIDER',
          undefined,
          undefined,
          undefined,
          0
        );
      }

      this.logger.info('Provider selected', {
        sessionId,
        providerId: manifest.providerId,
        context: request.context,
      });

      // 3. Execute with primary provider (with fallback retry)
      const response = await this.executeWithFallback(manifest, request, sessionId, startTime);

      // 4. Record success telemetry
      await this.recordTelemetry({
        sessionId,
        taskId: request.taskId,
        featureId: request.featureId,
        context: request.context,
        providerId: response.providerId,
        modelId: response.modelId,
        manifestHash: response.manifestHash,
        promptHash: this.hashPrompt(request.prompt),
        tokensConsumed: response.tokensConsumed,
        costUsd: response.costUsd,
        durationMs: response.durationMs,
        usedFallback: response.usedFallback,
        fallbackAttempts: response.fallbackAttempts,
        timestamp: new Date().toISOString(),
        metadata: request.metadata,
      });

      return response;
    } catch (error) {
      const agentError = this.normalizeError(error);

      // Record failure telemetry
      await this.recordTelemetry({
        sessionId,
        taskId: request.taskId,
        featureId: request.featureId,
        context: request.context,
        providerId: 'unknown',
        modelId: 'unknown',
        manifestHash: '0'.repeat(64),
        promptHash: this.hashPrompt(request.prompt),
        tokensConsumed: 0,
        costUsd: 0,
        durationMs: Date.now() - startTime,
        usedFallback: (agentError.fallbackAttempts ?? 0) > 0,
        fallbackAttempts: agentError.fallbackAttempts ?? 0,
        errorCategory: agentError.category,
        timestamp: new Date().toISOString(),
        metadata: request.metadata,
      });

      throw agentError;
    }
  }

  /**
   * Execute session with automatic fallback on transient errors
   */
  private async executeWithFallback(
    primaryManifest: AgentManifest,
    request: AgentSessionRequest,
    sessionId: string,
    startTime: number
  ): Promise<AgentSessionResponse> {
    let currentManifest: AgentManifest | undefined = primaryManifest;
    let fallbackAttempts = 0;
    let lastError: AgentAdapterError | undefined;
    const attemptedProviders = new Set<string>();

    while (currentManifest) {
      attemptedProviders.add(currentManifest.providerId);

      try {
        return await this.providerInvoker(
          currentManifest,
          request,
          sessionId,
          startTime,
          fallbackAttempts
        );
      } catch (error) {
        const agentError = this.normalizeError(error);
        agentError.fallbackAttempts = fallbackAttempts;
        lastError = agentError;

        this.logger.warn('Provider invocation failed', {
          sessionId,
          providerId: currentManifest.providerId,
          errorCategory: agentError.category,
          message: agentError.message,
          attempt: fallbackAttempts,
        });

        if (agentError.category !== 'transient' || !this.enableFallback) {
          throw agentError;
        }

        if (fallbackAttempts >= this.maxFallbackAttempts) {
          this.logger.warn('Max fallback attempts reached', {
            sessionId,
            maxFallbackAttempts: this.maxFallbackAttempts,
          });
          throw agentError;
        }

        const fallbackProviderId = currentManifest.fallbackProvider;
        if (!fallbackProviderId) {
          this.logger.error('No fallback provider configured', {
            sessionId,
            providerId: currentManifest.providerId,
          });
          throw agentError;
        }

        const fallbackManifest = this.manifestLoader.getManifest(fallbackProviderId);
        if (!fallbackManifest) {
          this.logger.error('Fallback provider not found', {
            sessionId,
            fallbackProviderId,
          });
          throw agentError;
        }

        if (attemptedProviders.has(fallbackManifest.providerId)) {
          this.logger.error('Detected fallback cycle', {
            sessionId,
            fallbackProviderId,
          });
          throw agentError;
        }

        if (agentError.retryAfterSeconds) {
          this.logger.info('Waiting before fallback retry', {
            sessionId,
            retryAfterSeconds: agentError.retryAfterSeconds,
          });
          await this.sleep(agentError.retryAfterSeconds * 1000);
        }

        fallbackAttempts += 1;
        this.logger.info('Attempting fallback provider', {
          sessionId,
          fallbackProviderId,
          attempt: fallbackAttempts,
        });
        currentManifest = fallbackManifest;
      }
    }

    throw (
      lastError ??
      this.createError(
        'permanent',
        'Agent session failed with unknown fallback error',
        'UNEXPECTED_FALLBACK_FAILURE',
        undefined,
        undefined,
        undefined,
        fallbackAttempts
      )
    );
  }

  /**
   * Invoke provider API (stub implementation)
   * Real implementation would integrate with actual provider SDKs
   */
  private async invokeProviderInternal(
    manifest: AgentManifest,
    request: AgentSessionRequest,
    sessionId: string,
    startTime: number,
    fallbackAttempts: number
  ): Promise<AgentSessionResponse> {
    // Stub implementation - in production this would call real provider APIs
    // For now, return mock response

    const manifestHash = this.getManifestHash(manifest);
    const modelId = request.modelId || manifest.costConfig.models[0].modelId;
    const model = manifest.costConfig.models.find((m) => m.modelId === modelId);

    if (!model) {
      throw this.createError(
        'permanent',
        `Model ${modelId} not found in provider ${manifest.providerId}`,
        'MODEL_NOT_FOUND',
        undefined,
        manifest.providerId,
        undefined,
        fallbackAttempts
      );
    }

    // Simulate API call
    const tokensConsumed = 1000; // Mock value
    const durationMs = Date.now() - startTime;
    const costUsd =
      ((tokensConsumed / 1000) * (model.inputCostPer1kTokens + model.outputCostPer1kTokens)) / 2;

    // Record cost
    if (this.costTracker) {
      await this.costTracker.recordUsage(
        manifest.providerId,
        `${request.context}_session`,
        tokensConsumed / 2, // promptTokens
        tokensConsumed / 2, // completionTokens
        modelId,
        {
          featureId: request.featureId,
          taskId: request.taskId,
          sessionId,
        }
      );
    }

    return {
      output: { message: 'Mock output' }, // Stub
      providerId: manifest.providerId,
      modelId,
      sessionId,
      tokensConsumed,
      costUsd,
      durationMs,
      manifestHash,
      usedFallback: fallbackAttempts > 0,
      fallbackAttempts,
    };
  }

  /**
   * Resolve manifest hash for telemetry, falling back to runtime hash computation
   */
  private getManifestHash(manifest: AgentManifest): string {
    const cachedHash = this.manifestLoader.getManifestHash(manifest.providerId);
    if (cachedHash) {
      return cachedHash;
    }

    return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  }

  /**
   * Get capability requirements for execution context
   */
  private getCapabilityRequirements(context: ExecutionContext): ProviderRequirements {
    const contextReqs = CONTEXT_REQUIREMENTS[context];

    const requirements: ProviderRequirements = {
      minContextWindow: contextReqs.minContextWindow,
      requiredFeatures: contextReqs.requiredFeatures,
      requiredTools: contextReqs.requiredTools,
    };

    if (contextReqs.maxCostPer1kTokens !== undefined) {
      requirements.maxCostPer1kTokens = contextReqs.maxCostPer1kTokens;
    }

    return requirements;
  }

  /**
   * Select provider matching capability requirements
   */
  private selectProvider(
    requirements: ProviderRequirements,
    preferredProviderId?: string
  ): AgentManifest | undefined {
    return this.manifestLoader.selectProvider(requirements, preferredProviderId);
  }

  /**
   * Classify error into taxonomy category
   */
  private classifyError(error: unknown): AgentErrorCategory {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Transient errors (retry automatically)
      if (
        message.includes('timeout') ||
        message.includes('rate limit') ||
        message.includes('503') ||
        message.includes('429') ||
        message.includes('network') ||
        message.includes('connection')
      ) {
        return 'transient';
      }

      // Human action required
      if (
        message.includes('ambiguous') ||
        message.includes('policy violation') ||
        message.includes('requires clarification') ||
        message.includes('human review')
      ) {
        return 'humanAction';
      }

      // Permanent errors (do not retry)
      // 400, 401, 403, 404, invalid input, unsupported feature, etc.
      return 'permanent';
    }

    return 'permanent';
  }

  /**
   * Create structured AgentError
   */
  private createError(
    category: AgentErrorCategory,
    message: string,
    code?: string,
    details?: string,
    providerId?: string,
    retryAfterSeconds?: number,
    fallbackAttempts?: number
  ): AgentAdapterError {
    return new AgentAdapterError({
      category,
      message,
      code,
      details,
      providerId,
      retryAfterSeconds,
      fallbackAttempts,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Normalize any error to AgentError
   */
  private normalizeError(error: unknown): AgentAdapterError {
    if (error instanceof AgentAdapterError) {
      return error;
    }

    const parsed = AgentErrorSchema.safeParse(error);
    if (parsed.success) {
      return new AgentAdapterError(parsed.data);
    }

    const category = this.classifyError(error);
    const message = getErrorMessage(error);
    const details = error instanceof Error ? error.stack : undefined;

    return this.createError(category, message, undefined, details);
  }

  /**
   * Hash prompt for redacted telemetry
   */
  private hashPrompt(prompt: unknown): string {
    try {
      const content = typeof prompt === 'string' ? prompt : JSON.stringify(prompt ?? null);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      this.logger.warn('Failed to stringify prompt for hashing', {
        error: getErrorMessage(error),
      });
      return crypto.createHash('sha256').update(String(prompt)).digest('hex');
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Record session telemetry
   */
  private async recordTelemetry(telemetry: SessionTelemetry): Promise<void> {
    this.sessionHistory.push(telemetry);

    if (!this.telemetryDir) {
      this.logger.debug('Session telemetry recorded', telemetry);
      return;
    }

    try {
      await fs.mkdir(this.telemetryDir, { recursive: true });
      const filePath = path.join(this.telemetryDir, TELEMETRY_FILENAME);
      await fs.appendFile(filePath, `${JSON.stringify(telemetry)}\n`, 'utf-8');
    } catch (error) {
      this.logger.warn('Failed to persist session telemetry', {
        error: getErrorMessage(error),
      });
    } finally {
      this.logger.debug('Session telemetry recorded', telemetry);
    }
  }

  /**
   * Sleep utility for rate limit backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get session history for diagnostics
   */
  getSessionHistory(): ReadonlyArray<SessionTelemetry> {
    return this.sessionHistory;
  }

  /**
   * Get adapter statistics
   */
  getStatistics(): {
    totalSessions: number;
    successfulSessions: number;
    failedSessions: number;
    fallbackUsed: number;
    totalCostUsd: number;
    totalTokens: number;
  } {
    const successful = this.sessionHistory.filter((s) => !s.errorCategory);
    const failed = this.sessionHistory.filter((s) => s.errorCategory);
    const withFallback = this.sessionHistory.filter((s) => s.usedFallback);

    return {
      totalSessions: this.sessionHistory.length,
      successfulSessions: successful.length,
      failedSessions: failed.length,
      fallbackUsed: withFallback.length,
      totalCostUsd: this.sessionHistory.reduce((sum, s) => sum + s.costUsd, 0),
      totalTokens: this.sessionHistory.reduce((sum, s) => sum + s.tokensConsumed, 0),
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create AgentAdapter instance
 */
export function createAgentAdapter(config: AgentAdapterConfig): AgentAdapter {
  return new AgentAdapter(config);
}
