/**
 * Credential Redaction Utilities
 *
 * Consolidated secret/credential redaction patterns used across
 * telemetry logging and command output normalization.
 */

export const CREDENTIAL_PATTERNS: ReadonlyArray<{
  name: string;
  pattern: RegExp;
  replacement: string;
}> = [
  // Specific token patterns MUST come before generic patterns
  {
    name: 'anthropic_key',
    pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g,
    replacement: '[ANTHROPIC_KEY_REDACTED]',
  },
  { name: 'openai_key', pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[OPENAI_KEY_REDACTED]' },
  {
    name: 'github_token',
    pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g,
    replacement: '[GITHUB_TOKEN_REDACTED]',
  },
  {
    name: 'github_pat',
    pattern: /github_pat_[a-zA-Z0-9_]{22,}/g,
    replacement: '[GITHUB_PAT_REDACTED]',
  },
  {
    name: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    replacement: '[JWT_REDACTED]',
  },
  {
    name: 'slack_token',
    pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
    replacement: '[SLACK_TOKEN_REDACTED]',
  },
  {
    name: 'linear_key',
    pattern: /lin_api_[a-zA-Z0-9]{40,}/g,
    replacement: '[LINEAR_KEY_REDACTED]',
  },
  {
    name: 'aws_access_key',
    pattern: /AKIA[A-Z0-9]{16}/g,
    replacement: '[AWS_ACCESS_KEY_REDACTED]',
  },
  {
    name: 'aws_secret',
    pattern: /(?:aws[_-]?secret|secret[_-]?access)[^=]*=\s*["']?[A-Za-z0-9/+=]{40}/gi,
    replacement: '[AWS_SECRET_REDACTED]',
  },
  {
    name: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END/g,
    replacement: '[PRIVATE_KEY_REDACTED]',
  },
  {
    name: 'connection_string',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s]+/gi,
    replacement: '[CONNECTION_STRING_REDACTED]',
  },
  {
    name: 'env_var',
    pattern: /(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|LINEAR_API_KEY)=["']?[^\s"']+/gi,
    replacement: '[ENV_VAR_REDACTED]',
  },
  // Generic patterns MUST come after specific patterns and exclude already-redacted values
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
    replacement: 'Bearer [TOKEN_REDACTED]',
  },
  {
    name: 'auth_header',
    pattern: /Authorization:\s*(?!\[)[^\s]+/gi,
    replacement: 'Authorization: [REDACTED]',
  },
  {
    name: 'api_key',
    pattern: /api[_-]?key[=:]\s*(?!\[)[^\s&"']+/gi,
    replacement: 'api_key=[REDACTED]',
  },
  { name: 'token', pattern: /token[=:]\s*(?!\[)[^\s&"']+/gi, replacement: 'token=[REDACTED]' },
  {
    name: 'password',
    pattern: /password[=:]\s*(?!\[)[^\s&"']+/gi,
    replacement: 'password=[REDACTED]',
  },
  { name: 'secret', pattern: /secret[=:]\s*(?!\[)[^\s&"']+/gi, replacement: 'secret=[REDACTED]' },
];

/**
 * Redact credentials and secrets from a string.
 * Applies all patterns in order; specific patterns run before generic ones.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const { pattern, replacement } of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function normalizeRedactionLabels(input: string): string {
  return input
    .replaceAll('[GITHUB_TOKEN_REDACTED]', '[REDACTED_GITHUB_TOKEN]')
    .replaceAll('[JWT_REDACTED]', '[REDACTED_JWT]');
}

export interface RedactionReport {
  /** Redacted text */
  text: string;
  /** Flags representing patterns matched during redaction */
  flags: string[];
}

export class RedactionEngine {
  private readonly patterns: ReadonlyArray<{ name: string; pattern: RegExp; replacement: string }>;
  private readonly enabled: boolean;

  constructor(
    enabled = true,
    customPatterns?: ReadonlyArray<{ name: string; pattern: RegExp; replacement: string }>
  ) {
    this.enabled = enabled;
    this.patterns = customPatterns ?? CREDENTIAL_PATTERNS;
  }

  redact(input: string): string {
    return this.redactWithReport(input).text;
  }

  redactWithReport(input: string): RedactionReport {
    if (!this.enabled) {
      return { text: input, flags: [] };
    }

    let output = input;
    const flags = new Set<string>();

    for (const { pattern, replacement, name } of this.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(output)) {
        flags.add(name);
      }
      pattern.lastIndex = 0;
      output = output.replace(pattern, replacement);
    }

    return { text: normalizeRedactionLabels(output), flags: Array.from(flags) };
  }

  redactObject(obj: unknown): unknown {
    if (!this.enabled) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.redact(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }

    if (obj && typeof obj === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: redaction output preserves arbitrary input keys
      const redacted: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj)) {
        if (RedactionEngine.isSensitiveFieldName(key)) {
          redacted[key] = '[REDACTED]';
        } else {
          redacted[key] = this.redactObject(value);
        }
      }

      return redacted;
    }

    return obj;
  }

  private static isSensitiveFieldName(name: string): boolean {
    const lowerName = name.toLowerCase();
    const sensitiveNames = [
      'password',
      'secret',
      'token',
      'api_key',
      'apikey',
      'auth',
      'authorization',
      'credential',
      'private_key',
      'privatekey',
    ];

    return sensitiveNames.some((pattern) => lowerName.includes(pattern));
  }
}
