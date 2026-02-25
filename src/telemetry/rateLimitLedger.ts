import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Provider } from '../core/sharedTypes';
import type { LoggerInterface } from './logger';
import { isFileNotFound } from '../utils/safeJson.js';

/**
 * Rate Limit Ledger
 *
 * Persistence layer for rate limit envelopes that:
 * - Records rate limit headers (remaining, reset, retry-after) per provider
 * - Persists envelopes to run directory as rate_limits.json
 * - Supports reading current rate limit state for cooldown decisions
 * - Provides schema for ledger JSON with provider-specific entries
 * - Integrates with runDirectoryManager for atomic writes
 *
 * Implements Rate Limit Discipline from the Rulebook.
 */

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * Rate limit envelope captured from HTTP response headers
 */
export interface RateLimitEnvelope {
  /** Provider identifier (github, linear, etc.) */
  provider: Provider | string;
  /** Number of requests remaining in current window */
  remaining?: number;
  /** Unix epoch timestamp when rate limit resets */
  reset?: number;
  /** Seconds to wait before retrying (from retry-after header) */
  retryAfter?: number;
  /** ISO 8601 timestamp when envelope was captured */
  timestamp: string;
  /** Request ID that triggered this envelope */
  requestId: string;
  /** API endpoint that was called */
  endpoint: string;
  /** HTTP status code */
  statusCode: number;
  /** Optional error message if rate limit was exceeded */
  errorMessage?: string;
}

/**
 * Rate limit state for a specific provider
 */
export interface ProviderRateLimitState {
  /** Provider identifier */
  provider: Provider | string;
  /** Current state */
  state: {
    /** Requests remaining */
    remaining: number;
    /** Reset timestamp (unix epoch) */
    reset: number;
    /** Whether in cooldown state */
    inCooldown: boolean;
    /** Cooldown end time (ISO 8601) if in cooldown */
    cooldownUntil?: string;
  };
  /** Last error encountered */
  lastError?: {
    timestamp: string;
    message: string;
    requestId: string;
  };
  /** Recent envelopes (last 10) */
  recentEnvelopes: RateLimitEnvelope[];
  /** Last updated timestamp */
  lastUpdated: string;
}

/**
 * Complete rate limit ledger schema (persisted to disk)
 */
export interface RateLimitLedgerData {
  /** Schema version for migrations */
  schema_version: string;
  /** Run directory feature ID */
  feature_id?: string;
  /** Provider-specific rate limit states */
  providers: Record<string, ProviderRateLimitState>;
  /** Metadata */
  metadata: {
    created_at: string;
    updated_at: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const LEDGER_FILENAME = 'rate_limits.json';
const LEDGER_SCHEMA_VERSION = '1.0.0';
const MAX_RECENT_ENVELOPES = 10;

// Cooldown thresholds
const COOLDOWN_THRESHOLD_REMAINING = 10; // Enter cooldown when less than 10 requests remain
const SECONDARY_LIMIT_RETRY_COUNT = 3; // Number of consecutive 429s before requiring manual ack

// ============================================================================
// Helpers
// ============================================================================

function getLedgerPath(runDir: string): string {
  return path.join(runDir, LEDGER_FILENAME);
}

function createEmptyLedgerData(): RateLimitLedgerData {
  const now = new Date().toISOString();

  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    providers: {},
    metadata: {
      created_at: now,
      updated_at: now,
    },
  };
}

async function loadLedgerFile(ledgerPath: string): Promise<RateLimitLedgerData> {
  try {
    const content = await fs.readFile(ledgerPath, 'utf-8');
    return JSON.parse(content) as RateLimitLedgerData;
  } catch (error) {
    if (isFileNotFound(error)) {
      return createEmptyLedgerData();
    }
    throw error;
  }
}

async function saveLedgerFile(ledgerPath: string, ledger: RateLimitLedgerData): Promise<void> {
  const content = JSON.stringify(ledger, null, 2);
  await fs.writeFile(ledgerPath, content, 'utf-8');
}

// ============================================================================
// Rate Limit Ledger Class
// ============================================================================

/**
 * Rate limit ledger writer and reader
 */
export class RateLimitLedger {
  private readonly provider: Provider | string;
  private readonly ledgerPath: string;
  private readonly logger: LoggerInterface;

  constructor(runDir: string, provider: Provider | string, logger: LoggerInterface) {
    this.provider = provider;
    this.ledgerPath = getLedgerPath(runDir);
    this.logger = logger;
  }

  /**
   * Record a rate limit envelope
   */
  async recordEnvelope(envelope: RateLimitEnvelope): Promise<void> {
    try {
      // Load existing ledger or create new one
      const ledger = await loadLedgerFile(this.ledgerPath);

      // Get or create provider state
      let providerState = ledger.providers[envelope.provider];

      if (!providerState) {
        providerState = this.createProviderState(envelope.provider);
        ledger.providers[envelope.provider] = providerState;
      }

      // Update state from envelope
      if (envelope.remaining !== undefined) {
        providerState.state.remaining = envelope.remaining;
      }

      if (envelope.reset !== undefined) {
        providerState.state.reset = envelope.reset;
      }

      // Check if in cooldown
      const inCooldown = this.shouldEnterCooldown(envelope);
      providerState.state.inCooldown = inCooldown;

      if (inCooldown) {
        const cooldownUntil = this.calculateCooldownEnd(envelope);
        providerState.state.cooldownUntil = cooldownUntil;

        this.logger.warn('Entering rate limit cooldown', {
          provider: envelope.provider,
          remaining: envelope.remaining,
          cooldownUntil,
        });
      } else {
        delete providerState.state.cooldownUntil;
      }

      // Record error if status indicates rate limit hit
      if (envelope.statusCode === 429) {
        providerState.lastError = {
          timestamp: envelope.timestamp,
          message: envelope.errorMessage ?? 'Rate limit exceeded',
          requestId: envelope.requestId,
        };

        this.logger.error('Rate limit exceeded', {
          provider: envelope.provider,
          endpoint: envelope.endpoint,
          requestId: envelope.requestId,
        });
      }

      // Add to recent envelopes (keep last N)
      providerState.recentEnvelopes.unshift(envelope);
      if (providerState.recentEnvelopes.length > MAX_RECENT_ENVELOPES) {
        providerState.recentEnvelopes = providerState.recentEnvelopes.slice(
          0,
          MAX_RECENT_ENVELOPES
        );
      }

      // Update timestamps
      providerState.lastUpdated = new Date().toISOString();
      ledger.metadata.updated_at = new Date().toISOString();

      // Persist ledger
      await saveLedgerFile(this.ledgerPath, ledger);

      this.logger.debug('Rate limit envelope recorded', {
        provider: envelope.provider,
        remaining: envelope.remaining,
        reset: envelope.reset,
      });
    } catch (error) {
      this.logger.error('Failed to record rate limit envelope', {
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: envelope.provider,
      });
      // Don't throw - rate limit recording should not break requests
    }
  }

  /**
   * Get current rate limit state for a provider
   */
  async getProviderState(provider: Provider | string): Promise<ProviderRateLimitState | undefined> {
    try {
      const ledger = await loadLedgerFile(this.ledgerPath);
      return ledger.providers[provider];
    } catch (error) {
      this.logger.error('Failed to read rate limit ledger', {
        error: error instanceof Error ? error.message : 'Unknown error',
        provider,
        ledgerPath: this.ledgerPath,
      });
      return undefined;
    }
  }

  /**
   * Check if provider is in cooldown
   */
  async isInCooldown(provider?: Provider | string): Promise<boolean> {
    const targetProvider = provider ?? this.provider;
    const state = await this.getProviderState(targetProvider);

    if (!state || !state.state.inCooldown) {
      return false;
    }

    // Check if cooldown has expired
    if (state.state.cooldownUntil) {
      const cooldownEnd = new Date(state.state.cooldownUntil).getTime();
      const now = Date.now();

      if (now >= cooldownEnd) {
        // Cooldown expired, clear it
        await this.clearCooldown(targetProvider);
        return false;
      }
    }

    return true;
  }

  /**
   * Clear cooldown for a provider
   */
  async clearCooldown(provider?: Provider | string): Promise<void> {
    const targetProvider = provider ?? this.provider;

    try {
      const ledger = await loadLedgerFile(this.ledgerPath);
      const providerState = ledger.providers[targetProvider];

      if (providerState) {
        providerState.state.inCooldown = false;
        delete providerState.state.cooldownUntil;
        providerState.lastUpdated = new Date().toISOString();
        ledger.metadata.updated_at = new Date().toISOString();

        await saveLedgerFile(this.ledgerPath, ledger);

        this.logger.info('Cooldown cleared', { provider: targetProvider });
      }
    } catch (error) {
      this.logger.error('Failed to clear cooldown', {
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: targetProvider,
      });
    }
  }

  /**
   * Get consecutive rate limit hits for secondary limit detection
   */
  async getConsecutiveRateLimitHits(provider?: Provider | string): Promise<number> {
    const targetProvider = provider ?? this.provider;
    const state = await this.getProviderState(targetProvider);

    if (!state || state.recentEnvelopes.length === 0) {
      return 0;
    }

    // Count consecutive 429s from most recent envelopes
    let count = 0;
    for (const envelope of state.recentEnvelopes) {
      if (envelope.statusCode === 429) {
        count++;
      } else {
        break; // Stop at first non-429
      }
    }

    return count;
  }

  /**
   * Check if manual acknowledgement is required due to repeated secondary limits
   */
  async requiresManualAcknowledgement(provider?: Provider | string): Promise<boolean> {
    const consecutiveHits = await this.getConsecutiveRateLimitHits(provider);
    return consecutiveHits >= SECONDARY_LIMIT_RETRY_COUNT;
  }

  /**
   * Create initial provider state
   */
  private createProviderState(provider: Provider | string): ProviderRateLimitState {
    return {
      provider,
      state: {
        remaining: Number.MAX_SAFE_INTEGER,
        reset: 0,
        inCooldown: false,
      },
      recentEnvelopes: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Determine if cooldown should be entered
   */
  private shouldEnterCooldown(envelope: RateLimitEnvelope): boolean {
    return envelope.statusCode === 429 || (envelope.remaining !== undefined && envelope.remaining <= COOLDOWN_THRESHOLD_REMAINING);
  }

  /**
   * Calculate when cooldown should end
   */
  private calculateCooldownEnd(envelope: RateLimitEnvelope): string {
    // Use retry-after if available
    if (envelope.retryAfter !== undefined) {
      const endMs = Date.now() + envelope.retryAfter * 1000;
      return new Date(endMs).toISOString();
    }

    // Use reset time if available
    if (envelope.reset !== undefined) {
      return new Date(envelope.reset * 1000).toISOString();
    }

    // Default to 5 minutes from now
    const endMs = Date.now() + 5 * 60 * 1000;
    return new Date(endMs).toISOString();
  }
}

// ============================================================================
// File helpers
// ============================================================================

export async function readRateLimitLedger(runDir: string): Promise<RateLimitLedgerData> {
  const ledgerPath = getLedgerPath(runDir);
  return loadLedgerFile(ledgerPath);
}

export async function writeRateLimitLedger(
  runDir: string,
  ledger: RateLimitLedgerData
): Promise<void> {
  const ledgerPath = getLedgerPath(runDir);
  await saveLedgerFile(ledgerPath, ledger);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Export helper to create a ledger instance
 */
export function createRateLimitLedger(
  runDir: string,
  provider: Provider | string,
  logger: LoggerInterface
): RateLimitLedger {
  return new RateLimitLedger(runDir, provider, logger);
}
