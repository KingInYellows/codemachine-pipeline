/**
 * Validation Error Model
 *
 * Structured error representation for schema validation failures.
 * Maps Zod errors to a domain-specific format suitable for CLI output,
 * logging, and telemetry.
 */

import type { ZodError, ZodIssue } from 'zod';

/**
 * A single validation issue with path and context.
 */
export interface ValidationIssue {
  /** Dot-delimited path to the invalid field (e.g. "github.token") */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Zod issue code for programmatic handling */
  code: string;
  /** Expected value/type (when available) */
  expected?: string;
  /** Received value/type (when available) */
  received?: string;
}

/**
 * Structured validation error with all issues collected.
 */
export class ValidationError extends Error {
  readonly issues: ValidationIssue[];
  readonly boundary: string;

  constructor(boundary: string, issues: ValidationIssue[]) {
    const summary = issues.length === 1
      ? issues[0].message
      : `${issues.length} validation errors`;
    super(`[${boundary}] ${summary}`);
    this.name = 'ValidationError';
    this.boundary = boundary;
    this.issues = issues;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Format issues for CLI output. */
  formatForCLI(): string {
    return this.issues
      .map((i) => `  - ${i.path ? `${i.path}: ` : ''}${i.message}`)
      .join('\n');
  }

  /** Serialize for logging/telemetry. */
  toJSON(): { boundary: string; issues: ValidationIssue[]; message: string } {
    return {
      boundary: this.boundary,
      issues: this.issues.map((i) => ({
        path: i.path,
        message: i.message,
        code: i.code,
        // Redact expected/received to prevent leaking sensitive data
      })),
      message: this.message,
    };
  }
}

/**
 * Convert a ZodError to a ValidationError.
 */
export function fromZodError(boundary: string, zodError: ZodError): ValidationError {
  const issues: ValidationIssue[] = zodError.issues.map(mapZodIssue);
  return new ValidationError(boundary, issues);
}

function mapZodIssue(issue: ZodIssue): ValidationIssue {
  const base: ValidationIssue = {
    path: issue.path.join('.') || 'root',
    message: issue.message,
    code: issue.code,
  };

  if ('expected' in issue && issue.expected !== undefined) {
    base.expected = typeof issue.expected === 'string' ? issue.expected : String(issue.expected);
  }
  if ('received' in issue && issue.received !== undefined) {
    base.received = typeof issue.received === 'string' ? issue.received : String(issue.received);
  }

  return base;
}

