/**
 * Agent Adapter Types and Schemas
 *
 * Extracted from AgentAdapter.ts for separation of concerns:
 * - Error taxonomy types and schemas
 * - Execution context classification
 * - Capability requirements mapping
 * - Session request/response interfaces
 * - Telemetry schema
 * - Adapter configuration
 */

import { z } from 'zod';
import type { ManifestLoader, AgentManifest, Features, Tools } from './manifestLoader';
import type { ExecutionTaskType } from '../../core/models/ExecutionTask';
import type { StructuredLogger } from '../../telemetry/logger';
import type { CostTracker } from '../../telemetry/costTracker';

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
export const AgentErrorSchema = z
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

/**
 * Execution context classification for capability negotiation
 * Maps ExecutionTask types to provider capability requirements
 */
export const ExecutionContextSchema = z.enum([
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
    validation: 'code_generation',
    patch_application: 'code_generation',
    git_operation: 'code_generation',
    custom: 'summarization',
  };

  return mapping[taskType];
}

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
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: agent session metadata varies by provider and use case
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
  /** Maximum agent requests per hour (client-side sliding window; default 100) */
  rateLimitPerHour?: number;
}
