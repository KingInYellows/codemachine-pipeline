/**
 * Agent Manifest Tests
 *
 * Comprehensive test suite for agent manifest loading, validation, provider
 * selection, and cost tracker integration.
 *
 * Test coverage:
 * - Schema validation (valid/invalid manifests)
 * - Manifest loading and caching
 * - Cost config registration
 * - Provider selection and capability matching
 * - Hash-based change detection
 * - Error handling and CLI rejection scenarios
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { CostTracker } from '../../src/telemetry/costTracker';
import type { StructuredLogger } from '../../src/telemetry/logger';
import {
  parseAgentManifest,
  loadManifestFromFile,
  computeManifestHash,
  matchesRequirements,
  rankByPrice,
  ManifestLoader,
  createManifestLoader,
  type AgentManifest,
  type ProviderRequirements,
} from '../../src/adapters/agents/manifestLoader';

// Mock fs/promises module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const validMinimalManifest: AgentManifest = {
  schema_version: '1.0.0',
  providerId: 'test-provider',
  name: 'Test Provider',
  version: '1.0.0',
  rateLimits: {
    requestsPerMinute: 100,
  },
  costConfig: {
    currency: 'USD',
    models: [
      {
        modelId: 'test-model',
        inputCostPer1kTokens: 0.01,
        outputCostPer1kTokens: 0.03,
      },
    ],
  },
};

const validFullManifest: AgentManifest = {
  schema_version: '1.0.0',
  providerId: 'openai',
  name: 'OpenAI GPT-4',
  version: '2.1.0',
  description: 'OpenAI GPT-4 and GPT-3.5 Turbo models',
  rateLimits: {
    requestsPerMinute: 500,
    tokensPerMinute: 150000,
    burstCapacity: 50,
    concurrentRequests: 10,
  },
  costConfig: {
    currency: 'USD',
    models: [
      {
        modelId: 'gpt-4',
        inputCostPer1kTokens: 0.03,
        outputCostPer1kTokens: 0.06,
        contextWindow: 8192,
        maxOutputTokens: 4096,
      },
      {
        modelId: 'gpt-3.5-turbo',
        inputCostPer1kTokens: 0.0015,
        outputCostPer1kTokens: 0.002,
        contextWindow: 16384,
        maxOutputTokens: 4096,
      },
    ],
  },
  tools: {
    streaming: true,
    functionCalling: true,
    vision: false,
    jsonMode: true,
    embeddings: false,
  },
  features: {
    prdGeneration: true,
    specGeneration: true,
    codeGeneration: true,
    codeReview: true,
    testGeneration: true,
    summarization: true,
  },
  endpoint: {
    baseUrl: 'https://api.openai.com/v1',
    authMethod: 'bearer',
    timeout: 60000,
  },
  fallbackProvider: 'anthropic',
  metadata: {
    tier: 'production',
    region: 'us-east-1',
  },
};

// ============================================================================
// Mock Factories
// ============================================================================

type LoggerSpies = Record<'debug' | 'info' | 'warn' | 'error', Mock>;

interface MockedLogger {
  instance: StructuredLogger;
  spies: LoggerSpies;
}

type CostTrackerSpies = Record<'registerCostConfig' | 'recordUsage' | 'getState' | 'flush', Mock>;

interface MockedCostTracker {
  instance: CostTracker;
  spies: CostTrackerSpies;
}

function createMockLogger(): MockedLogger {
  const spies: LoggerSpies = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    instance: spies as unknown as StructuredLogger,
    spies,
  };
}

function createMockCostTracker(): MockedCostTracker {
  const spies: CostTrackerSpies = {
    registerCostConfig: vi.fn(),
    recordUsage: vi.fn(),
    getState: vi.fn(),
    flush: vi.fn(),
  };

  return {
    instance: spies as unknown as CostTracker,
    spies,
  };
}

interface DirentStub {
  name: string;
  isFile(): boolean;
}

function createDirentStub(name: string, isFile: boolean): DirentStub {
  return {
    name,
    isFile: () => isFile,
  };
}

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('parseAgentManifest - Schema Validation', () => {
  it('should accept minimal valid manifest', () => {
    const result = parseAgentManifest(validMinimalManifest);
    expect(result.success).toBe(true);
    expect(result.manifest).toEqual(validMinimalManifest);
  });

  it('should accept manifest with all optional fields', () => {
    const result = parseAgentManifest(validFullManifest);
    expect(result.success).toBe(true);
    expect(result.manifest).toEqual(validFullManifest);
  });

  it('should reject manifest missing schema_version', () => {
    const invalid = { ...validMinimalManifest };
    delete (invalid as Partial<AgentManifest>).schema_version;

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.path === 'schema_version')).toBe(true);
  });

  it('should reject manifest missing providerId', () => {
    const invalid = { ...validMinimalManifest };
    delete (invalid as Partial<AgentManifest>).providerId;

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path === 'providerId')).toBe(true);
  });

  it('should reject manifest missing rateLimits (ACCEPTANCE CRITERIA)', () => {
    const invalid = { ...validMinimalManifest };
    delete (invalid as Partial<AgentManifest>).rateLimits;

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path === 'rateLimits')).toBe(true);
  });

  it('should reject manifest with rateLimits missing requestsPerMinute (ACCEPTANCE CRITERIA)', () => {
    const invalid = {
      ...validMinimalManifest,
      rateLimits: {
        tokensPerMinute: 10000,
      },
    };

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path.includes('requestsPerMinute'))).toBe(true);
  });

  it('should reject manifest missing costConfig (ACCEPTANCE CRITERIA)', () => {
    const invalid = { ...validMinimalManifest };
    delete (invalid as Partial<AgentManifest>).costConfig;

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path === 'costConfig')).toBe(true);
  });

  it('should reject manifest with empty models array (ACCEPTANCE CRITERIA)', () => {
    const invalid = {
      ...validMinimalManifest,
      costConfig: {
        currency: 'USD',
        models: [],
      },
    };

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path.includes('models'))).toBe(true);
  });

  it('should reject manifest with invalid semver in schema_version', () => {
    const invalid = {
      ...validMinimalManifest,
      schema_version: 'v1.0',
    };

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path === 'schema_version')).toBe(true);
  });

  it('should reject manifest with invalid providerId characters', () => {
    const invalid = {
      ...validMinimalManifest,
      providerId: 'Invalid_Provider!',
    };

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path === 'providerId')).toBe(true);
  });

  it('should reject manifest with negative cost values', () => {
    const invalid = {
      ...validMinimalManifest,
      costConfig: {
        currency: 'USD',
        models: [
          {
            modelId: 'test-model',
            inputCostPer1kTokens: -0.01,
            outputCostPer1kTokens: 0.03,
          },
        ],
      },
    };

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path.includes('inputCostPer1kTokens'))).toBe(true);
  });

  it('should reject manifest with extra unknown fields (strict mode)', () => {
    const invalid = {
      ...validMinimalManifest,
      unknownField: 'should cause failure',
    };

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.message.includes('Unrecognized'))).toBe(true);
  });

  it('should validate currency format (ISO 4217)', () => {
    const validCurrency = {
      ...validMinimalManifest,
      costConfig: {
        currency: 'EUR',
        models: validMinimalManifest.costConfig.models,
      },
    };

    const result = parseAgentManifest(validCurrency);
    expect(result.success).toBe(true);
  });

  it('should reject invalid currency format', () => {
    const invalid = {
      ...validMinimalManifest,
      costConfig: {
        currency: 'dollars',
        models: validMinimalManifest.costConfig.models,
      },
    };

    const result = parseAgentManifest(invalid);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Manifest Loading Tests
// ============================================================================

describe('loadManifestFromFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load and parse valid manifest file', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as Mock).mockResolvedValue(JSON.stringify(validMinimalManifest));

    const result = await loadManifestFromFile('/fake/path/manifest.json');

    expect(result.success).toBe(true);
    expect(result.manifest).toEqual(validMinimalManifest);
    expect(readFile).toHaveBeenCalledWith('/fake/path/manifest.json', 'utf-8');
  });

  it('should reject invalid manifest file', async () => {
    const invalidManifest = { ...validMinimalManifest };
    delete (invalidManifest as Partial<AgentManifest>).rateLimits;

    const { readFile } = await import('node:fs/promises');
    (readFile as Mock).mockResolvedValue(JSON.stringify(invalidManifest));

    const result = await loadManifestFromFile('/fake/path/invalid.json');

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('should throw on file read error', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as Mock).mockRejectedValue(new Error('ENOENT: no such file'));

    await expect(loadManifestFromFile('/nonexistent/manifest.json')).rejects.toThrow();
  });

  it('should throw on invalid JSON', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as Mock).mockResolvedValue('not valid json{');

    await expect(loadManifestFromFile('/fake/path/bad.json')).rejects.toThrow();
  });
});

// ============================================================================
// Hash Computation Tests
// ============================================================================

describe('computeManifestHash', () => {
  it('should compute consistent SHA-256 hash', () => {
    const content = JSON.stringify(validMinimalManifest);
    const hash1 = computeManifestHash(content);
    const hash2 = computeManifestHash(content);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
  });

  it('should produce different hashes for different content', () => {
    const content1 = JSON.stringify(validMinimalManifest);
    const content2 = JSON.stringify(validFullManifest);

    const hash1 = computeManifestHash(content1);
    const hash2 = computeManifestHash(content2);

    expect(hash1).not.toBe(hash2);
  });

  it('should be sensitive to whitespace changes', () => {
    const content1 = JSON.stringify(validMinimalManifest);
    const content2 = JSON.stringify(validMinimalManifest, null, 2); // Pretty-printed

    const hash1 = computeManifestHash(content1);
    const hash2 = computeManifestHash(content2);

    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================================
// Capability Matching Tests
// ============================================================================

describe('matchesRequirements', () => {
  it('should match manifest with no requirements', () => {
    const requirements: ProviderRequirements = {};
    expect(matchesRequirements(validFullManifest, requirements)).toBe(true);
  });

  it('should match manifest meeting minRequestsPerMinute', () => {
    const requirements: ProviderRequirements = {
      minRequestsPerMinute: 100,
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(true);
  });

  it('should reject manifest below minRequestsPerMinute', () => {
    const requirements: ProviderRequirements = {
      minRequestsPerMinute: 1000,
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(false);
  });

  it('should match manifest with sufficient context window', () => {
    const requirements: ProviderRequirements = {
      minContextWindow: 8000,
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(true);
  });

  it('should reject manifest with insufficient context window', () => {
    const requirements: ProviderRequirements = {
      minContextWindow: 100000,
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(false);
  });

  it('should match manifest with required tools', () => {
    const requirements: ProviderRequirements = {
      requiredTools: {
        streaming: true,
        functionCalling: true,
      },
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(true);
  });

  it('should reject manifest missing required tools', () => {
    const requirements: ProviderRequirements = {
      requiredTools: {
        vision: true, // validFullManifest has vision: false
      },
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(false);
  });

  it('should match manifest with required features', () => {
    const requirements: ProviderRequirements = {
      requiredFeatures: {
        prdGeneration: true,
        summarization: true,
      },
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(true);
  });

  it('should reject manifest missing required features', () => {
    const manifestWithoutCodeReview = {
      ...validFullManifest,
      features: {
        ...validFullManifest.features,
        codeReview: false,
      },
    };

    const requirements: ProviderRequirements = {
      requiredFeatures: {
        codeReview: true,
      },
    };

    expect(matchesRequirements(manifestWithoutCodeReview, requirements)).toBe(false);
  });

  it('should match manifest within cost budget', () => {
    const requirements: ProviderRequirements = {
      maxCostPer1kTokens: 0.1,
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(true);
  });

  it('should reject manifest exceeding cost budget', () => {
    const requirements: ProviderRequirements = {
      maxCostPer1kTokens: 0.01, // validFullManifest avg is ~0.045
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(false);
  });

  it('should match manifest meeting all requirements', () => {
    const requirements: ProviderRequirements = {
      minContextWindow: 8000,
      minRequestsPerMinute: 100,
      requiredTools: { streaming: true },
      requiredFeatures: { prdGeneration: true },
      maxCostPer1kTokens: 0.1,
    };
    expect(matchesRequirements(validFullManifest, requirements)).toBe(true);
  });
});

// ============================================================================
// Provider Ranking Tests
// ============================================================================

describe('rankByPrice', () => {
  it('should rank providers by ascending cost', () => {
    const cheap: AgentManifest = {
      ...validMinimalManifest,
      providerId: 'cheap',
      costConfig: {
        currency: 'USD',
        models: [
          {
            modelId: 'm1',
            inputCostPer1kTokens: 0.001,
            outputCostPer1kTokens: 0.002,
          },
        ],
      },
    };

    const expensive: AgentManifest = {
      ...validMinimalManifest,
      providerId: 'expensive',
      costConfig: {
        currency: 'USD',
        models: [
          {
            modelId: 'm1',
            inputCostPer1kTokens: 0.05,
            outputCostPer1kTokens: 0.1,
          },
        ],
      },
    };

    const ranked = rankByPrice([expensive, cheap, validFullManifest]);

    expect(ranked[0].providerId).toBe('cheap');
    expect(ranked[ranked.length - 1].providerId).toBe('expensive');
  });

  it('should handle single manifest', () => {
    const ranked = rankByPrice([validMinimalManifest]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toEqual(validMinimalManifest);
  });

  it('should not mutate input array', () => {
    const original = [validFullManifest, validMinimalManifest];
    const copy = [...original];

    rankByPrice(original);

    expect(original).toEqual(copy);
  });
});

// ============================================================================
// ManifestLoader Tests
// ============================================================================

describe('ManifestLoader', () => {
  let loader: ManifestLoader;
  let logger: MockedLogger;
  let costTracker: MockedCostTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
    costTracker = createMockCostTracker();
    loader = createManifestLoader(logger.instance);
  });

  describe('loadManifest', () => {
    it('should load and cache valid manifest', async () => {
      const { readFile } = await import('node:fs/promises');
      (readFile as Mock).mockResolvedValue(JSON.stringify(validMinimalManifest));

      const manifest = await loader.loadManifest('/fake/path/manifest.json');

      expect(manifest).toEqual(validMinimalManifest);
      expect(logger.spies.info).toHaveBeenCalledWith(
        'Loading agent manifest',
        expect.objectContaining({ path: '/fake/path/manifest.json' })
      );
    });

    it('should throw descriptive error for invalid manifest', async () => {
      const invalidManifest = { ...validMinimalManifest };
      delete (invalidManifest as Partial<AgentManifest>).rateLimits;

      const { readFile } = await import('node:fs/promises');
      (readFile as Mock).mockResolvedValue(JSON.stringify(invalidManifest));

      await expect(loader.loadManifest('/fake/path/invalid.json')).rejects.toThrow(/rateLimits/);
      await expect(loader.loadManifest('/fake/path/invalid.json')).rejects.toThrow(
        /acceptance criteria/
      );
    });

    it('should reuse cached manifest with same hash', async () => {
      const content = JSON.stringify(validMinimalManifest);
      const { readFile } = await import('node:fs/promises');
      (readFile as Mock).mockResolvedValue(content);

      const manifest1 = await loader.loadManifest('/fake/path/manifest.json');
      const manifest2 = await loader.loadManifest('/fake/path/manifest.json');

      expect(manifest1).toBe(manifest2); // Same reference
      expect(readFile).toHaveBeenCalledTimes(2); // Still reads to compute hash
    });

    it('should reload manifest if hash changes', async () => {
      const content1 = JSON.stringify(validMinimalManifest);
      const content2 = JSON.stringify({
        ...validMinimalManifest,
        version: '2.0.0',
      });

      const { readFile } = await import('node:fs/promises');
      (readFile as Mock).mockResolvedValueOnce(content1).mockResolvedValueOnce(content2);

      const manifest1 = await loader.loadManifest('/fake/path/manifest.json');
      const manifest2 = await loader.loadManifest('/fake/path/manifest.json');

      expect(manifest1.version).toBe('1.0.0');
      expect(manifest2.version).toBe('2.0.0');
    });

    it('should register cost configs when cost tracker provided', async () => {
      loader.setCostTracker(costTracker.instance);

      const { readFile } = await import('node:fs/promises');
      (readFile as Mock).mockResolvedValue(JSON.stringify(validFullManifest));

      await loader.loadManifest('/fake/path/manifest.json');

      expect(costTracker.spies.registerCostConfig).toHaveBeenCalledTimes(2); // Two models
      expect(costTracker.spies.registerCostConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4',
          inputCostPer1kTokens: 0.03,
          outputCostPer1kTokens: 0.06,
        })
      );
    });
  });

  describe('getManifest', () => {
    it('should return cached manifest by providerId', async () => {
      const { readFile } = await import('node:fs/promises');
      (readFile as Mock).mockResolvedValue(JSON.stringify(validMinimalManifest));

      await loader.loadManifest('/fake/path/manifest.json');
      const manifest = loader.getManifest('test-provider');

      expect(manifest).toEqual(validMinimalManifest);
    });

    it('should return undefined for unknown provider', () => {
      const manifest = loader.getManifest('nonexistent');
      expect(manifest).toBeUndefined();
    });
  });

  describe('getManifestHash', () => {
    it('should return hash for cached manifest', async () => {
      const content = JSON.stringify(validMinimalManifest);
      const expectedHash = computeManifestHash(content);

      const { readFile } = await import('node:fs/promises');
      (readFile as Mock).mockResolvedValue(content);

      await loader.loadManifest('/fake/path/manifest.json');
      const hash = loader.getManifestHash('test-provider');

      expect(hash).toBe(expectedHash);
    });

    it('should return undefined for unknown provider', () => {
      const hash = loader.getManifestHash('nonexistent');
      expect(hash).toBeUndefined();
    });
  });

  describe('selectProvider', () => {
    beforeEach(async () => {
      const cheap: AgentManifest = {
        ...validMinimalManifest,
        providerId: 'cheap',
        costConfig: {
          currency: 'USD',
          models: [
            {
              modelId: 'm1',
              inputCostPer1kTokens: 0.001,
              outputCostPer1kTokens: 0.002,
            },
          ],
        },
      };

      const expensive: AgentManifest = {
        ...validMinimalManifest,
        providerId: 'expensive',
        costConfig: {
          currency: 'USD',
          models: [
            {
              modelId: 'm1',
              inputCostPer1kTokens: 0.05,
              outputCostPer1kTokens: 0.1,
              contextWindow: 200000,
            },
          ],
        },
        tools: {
          streaming: true,
          functionCalling: true,
          vision: true,
          jsonMode: false,
          embeddings: false,
        },
      };

      const { readFile } = await import('node:fs/promises');
      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(cheap))
        .mockResolvedValueOnce(JSON.stringify(expensive));

      await loader.loadManifest('/fake/cheap.json');
      await loader.loadManifest('/fake/expensive.json');
    });

    it('should select cheapest provider when multiple match', () => {
      const requirements: ProviderRequirements = {
        minRequestsPerMinute: 50,
      };

      const selected = loader.selectProvider(requirements);

      expect(selected?.providerId).toBe('cheap');
    });

    it('should select preferred provider if it matches', () => {
      const requirements: ProviderRequirements = {
        minRequestsPerMinute: 50,
      };

      const selected = loader.selectProvider(requirements, 'expensive');

      expect(selected?.providerId).toBe('expensive');
    });

    it('should fallback to cost ranking if preferred does not match', () => {
      const requirements: ProviderRequirements = {
        requiredTools: { vision: true },
      };

      const selected = loader.selectProvider(requirements, 'cheap'); // cheap doesn't have vision

      expect(selected?.providerId).toBe('expensive');
    });

    it('should return undefined when no providers match', () => {
      const requirements: ProviderRequirements = {
        minContextWindow: 500000, // Neither provider has this
      };

      const selected = loader.selectProvider(requirements);

      expect(selected).toBeUndefined();
      expect(logger.spies.warn).toHaveBeenCalledWith(
        'No providers match requirements',
        expect.any(Object)
      );
    });
  });

  describe('listProviders', () => {
    it('should return empty array when no manifests loaded', () => {
      const providers = loader.listProviders();
      expect(providers).toEqual([]);
    });

    it('should list all loaded provider IDs', async () => {
      const { readFile } = await import('node:fs/promises');
      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(validMinimalManifest))
        .mockResolvedValueOnce(JSON.stringify(validFullManifest));

      await loader.loadManifest('/fake/manifest1.json');
      await loader.loadManifest('/fake/manifest2.json');

      const providers = loader.listProviders();

      expect(providers).toContain('test-provider');
      expect(providers).toContain('openai');
      expect(providers).toHaveLength(2);
    });
  });

  describe('loadManifestsFromDirectory', () => {
    it('should load all valid manifests from directory', async () => {
      const { readdir, readFile } = await import('node:fs/promises');
      (readdir as Mock).mockResolvedValue([
        createDirentStub('manifest1.json', true),
        createDirentStub('manifest2.json', true),
        createDirentStub('README.md', true),
      ]);

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(validMinimalManifest))
        .mockResolvedValueOnce(JSON.stringify(validFullManifest));

      const result = await loader.loadManifestsFromDirectory('/fake/dir');

      expect(result.loaded).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect errors for invalid manifests', async () => {
      const invalidManifest = { ...validMinimalManifest };
      delete (invalidManifest as Partial<AgentManifest>).rateLimits;

      const { readdir, readFile } = await import('node:fs/promises');
      (readdir as Mock).mockResolvedValue([
        createDirentStub('valid.json', true),
        createDirentStub('invalid.json', true),
      ]);

      (readFile as Mock)
        .mockResolvedValueOnce(JSON.stringify(validMinimalManifest))
        .mockResolvedValueOnce(JSON.stringify(invalidManifest));

      const result = await loader.loadManifestsFromDirectory('/fake/dir');

      expect(result.loaded).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('rateLimits');
    });

    it('should handle directory read errors gracefully', async () => {
      const { readdir } = await import('node:fs/promises');
      (readdir as Mock).mockRejectedValue(new Error('ENOENT: no such directory'));

      const result = await loader.loadManifestsFromDirectory('/nonexistent');

      expect(result.loaded).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(logger.spies.warn).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear cached manifests', async () => {
      const { readFile } = await import('node:fs/promises');
      (readFile as Mock).mockResolvedValue(JSON.stringify(validMinimalManifest));

      await loader.loadManifest('/fake/path/manifest.json');
      expect(loader.listProviders()).toHaveLength(1);

      loader.clear();
      expect(loader.listProviders()).toHaveLength(0);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration - Manifest Loader with Cost Tracker', () => {
  it('should register cost configs for all models on load', async () => {
    const logger = createMockLogger();
    const costTracker = createMockCostTracker();
    const loader = createManifestLoader(logger.instance);
    loader.setCostTracker(costTracker.instance);

    const { readFile } = await import('node:fs/promises');
    (readFile as Mock).mockResolvedValue(JSON.stringify(validFullManifest));

    await loader.loadManifest('/fake/path/openai.json');

    expect(costTracker.spies.registerCostConfig).toHaveBeenCalledTimes(2);
    expect(costTracker.spies.registerCostConfig).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4',
      inputCostPer1kTokens: 0.03,
      outputCostPer1kTokens: 0.06,
    });
    expect(costTracker.spies.registerCostConfig).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      inputCostPer1kTokens: 0.0015,
      outputCostPer1kTokens: 0.002,
    });
  });

  it('should select provider and expose cost data for telemetry', async () => {
    const logger = createMockLogger();
    const loader = createManifestLoader(logger.instance);

    const manifest1: AgentManifest = {
      ...validMinimalManifest,
      providerId: 'cheap-provider',
      costConfig: {
        currency: 'USD',
        models: [
          {
            modelId: 'cheap-model',
            inputCostPer1kTokens: 0.001,
            outputCostPer1kTokens: 0.002,
          },
        ],
      },
    };

    const manifest2: AgentManifest = {
      ...validMinimalManifest,
      providerId: 'expensive-provider',
      costConfig: {
        currency: 'USD',
        models: [
          {
            modelId: 'expensive-model',
            inputCostPer1kTokens: 0.05,
            outputCostPer1kTokens: 0.1,
          },
        ],
      },
    };

    const { readFile } = await import('node:fs/promises');
    (readFile as Mock)
      .mockResolvedValueOnce(JSON.stringify(manifest1))
      .mockResolvedValueOnce(JSON.stringify(manifest2));

    await loader.loadManifest('/fake/cheap.json');
    await loader.loadManifest('/fake/expensive.json');

    const selected = loader.selectProvider({});

    expect(selected?.providerId).toBe('cheap-provider');
    expect(selected?.costConfig.models[0].inputCostPer1kTokens).toBe(0.001);
  });
});
