/**
 * Write Action Rate Limiter
 *
 * Rate-limit enforcement for write-action queue operations.
 * Wraps RateLimitLedger to provide a focused cooldown-check interface.
 * Extracted from writeActionQueue.ts.
 */

import { RateLimitLedger } from '../telemetry/rateLimitLedger';
import type { LoggerInterface } from '../telemetry/logger';

export interface CooldownStatus {
  /** Whether the provider is currently in a rate-limit cooldown */
  inCooldown: boolean;
  /** Whether the cooldown requires manual operator acknowledgement */
  requiresManualAck: boolean;
}

/**
 * Checks rate-limit cooldown state for a given provider before executing
 * write actions.
 */
export class WriteActionRateLimiter {
  private readonly ledger: RateLimitLedger;
  private readonly provider: string;

  constructor(runDir: string, provider: string, logger: LoggerInterface) {
    this.ledger = new RateLimitLedger(runDir, provider, logger);
    this.provider = provider;
  }

  /**
   * Check whether the provider is in a cooldown period.
   */
  async checkCooldown(): Promise<CooldownStatus> {
    const inCooldown = await this.ledger.isInCooldown(this.provider);
    if (!inCooldown) {
      return { inCooldown: false, requiresManualAck: false };
    }
    const requiresManualAck = await this.ledger.requiresManualAcknowledgement(this.provider);
    return { inCooldown: true, requiresManualAck };
  }
}
