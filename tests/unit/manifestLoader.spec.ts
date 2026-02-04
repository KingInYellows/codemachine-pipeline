import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseAgentManifest,
  loadManifestFromFile,
  computeManifestHash,
  matchesRequirements,
  rankByPrice,
  ManifestLoader,
  createManifestLoader,
  loadManifestLoaderFromRepo,
  type AgentManifest,
  type ProviderRequirements,
} from '../../src/adapters/agents/manifestLoader';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { CostTracker, ProviderCostConfig } from '../../src/telemetry/costTracker';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-loader-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createMockLogger(): StructuredLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  } as unknown as StructuredLogger;
}

function createMockCostTracker(): CostTracker & { configs: ProviderCostConfig[] } {
  const configs: ProviderCostConfig[] = [];
  return {
    configs,
    registerCostConfig: vi.fn((config: ProviderCostConfig) => {
      configs.push(config);
    }),
  } as unknown as CostTracker & { configs: ProviderCostConfig[] };
}

function createValidManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
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
          inputCostPer1kTokens: 0.001,
          outputCostPer1kTokens: 0.002,
          contextWindow: 128000,
        },
      ],
    },
    ...overrides,
  };
}

// ============================================================================
// parseAgentManifest Tests
// ============================================================================

describe('parseAgentManifest', () => {
  describe('valid manifests', () => {
    it('should parse minimal valid manifest', () => {
      const manifest = createValidManifest();
      const result = parseAgentManifest(manifest);

      expect(result.success).toBe(true);
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.providerId).toBe('test-provider');
    });

    it('should parse manifest with all optional fields', () => {
      const manifest = createValidManifest({
        description: 'A test provider',
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
          baseUrl: 'https://api.example.com',
          authMethod: 'bearer',
          timeout: 60000,
        },
        fallbackProvider: 'openai',
        errorTaxonomy: {
          transientErrorCodes: ['429', '503'],
          permanentErrorCodes: ['401', '403'],
          retryPolicy: {
            maxAttempts: 3,
            baseDelayMs: 1000,
            maxDelayMs: 30000,
            backoffMultiplier: 2,
          },
        },
        executionContexts: {
          code_generation: {
            preferredModelId: 'code-model',
            maxTokensOverride: 4096,
          },
        },
        metadata: {
          custom_field: 'value',
        },
      });

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(true);
    });

    it('should apply default values for optional fields', () => {
      const manifest = createValidManifest();
      const result = parseAgentManifest(manifest);

      expect(result.success).toBe(true);
      expect(result.manifest?.costConfig.currency).toBe('USD');
    });
  });

  describe('invalid manifests', () => {
    it('should reject manifest without rateLimits', () => {
      const manifest = { ...createValidManifest() };
      delete (manifest as Record<string, unknown>).rateLimits;

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((e) => e.path.includes('rateLimits'))).toBe(true);
    });

    it('should reject manifest without costConfig', () => {
      const manifest = { ...createValidManifest() };
      delete (manifest as Record<string, unknown>).costConfig;

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.path.includes('costConfig'))).toBe(true);
    });

    it('should reject invalid schema_version format', () => {
      const manifest = createValidManifest({ schema_version: 'invalid' });

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('semver'))).toBe(true);
    });

    it('should reject invalid providerId format', () => {
      const manifest = createValidManifest({ providerId: 'Invalid Provider!' });

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(false);
    });

    it('should reject negative rate limits', () => {
      const manifest = createValidManifest({
        rateLimits: { requestsPerMinute: -1 },
      });

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(false);
    });

    it('should reject empty models array in costConfig', () => {
      const manifest = createValidManifest({
        costConfig: { currency: 'USD', models: [] },
      });

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(false);
    });

    it('should reject invalid currency format', () => {
      const manifest = createValidManifest({
        costConfig: {
          currency: 'usd', // Must be uppercase
          models: [{ modelId: 'test', inputCostPer1kTokens: 0.001, outputCostPer1kTokens: 0.002 }],
        },
      });

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(false);
    });

    it('should reject unknown fields in strict mode', () => {
      const manifest = {
        ...createValidManifest(),
        unknownField: 'value',
      };

      const result = parseAgentManifest(manifest);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// loadManifestFromFile Tests
// ============================================================================

describe('loadManifestFromFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should load and parse valid manifest file', async () => {
    const manifest = createValidManifest();
    const manifestPath = path.join(tempDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

    const result = await loadManifestFromFile(manifestPath);

    expect(result.success).toBe(true);
    expect(result.manifest?.providerId).toBe('test-provider');
  });

  it('should return errors for invalid manifest file', async () => {
    const invalidManifest = { invalid: 'data' };
    const manifestPath = path.join(tempDir, 'invalid.json');
    await fs.writeFile(manifestPath, JSON.stringify(invalidManifest), 'utf-8');

    const result = await loadManifestFromFile(manifestPath);

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('should throw for non-existent file', async () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.json');

    await expect(loadManifestFromFile(nonExistentPath)).rejects.toThrow();
  });

  it('should throw for invalid JSON', async () => {
    const manifestPath = path.join(tempDir, 'invalid.json');
    await fs.writeFile(manifestPath, 'not valid json', 'utf-8');

    await expect(loadManifestFromFile(manifestPath)).rejects.toThrow();
  });
});

// ============================================================================
// computeManifestHash Tests
// ============================================================================

describe('computeManifestHash', () => {
  it('should return SHA-256 hash of content', () => {
    const content = JSON.stringify(createValidManifest());
    const hash = computeManifestHash(content);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return different hashes for different content', () => {
    const content1 = JSON.stringify(createValidManifest({ providerId: 'provider-1' }));
    const content2 = JSON.stringify(createValidManifest({ providerId: 'provider-2' }));

    const hash1 = computeManifestHash(content1);
    const hash2 = computeManifestHash(content2);

    expect(hash1).not.toBe(hash2);
  });

  it('should return same hash for same content', () => {
    const content = JSON.stringify(createValidManifest());

    const hash1 = computeManifestHash(content);
    const hash2 = computeManifestHash(content);

    expect(hash1).toBe(hash2);
  });
});

// ============================================================================
// matchesRequirements Tests
// ============================================================================

describe('matchesRequirements', () => {
  it('should match manifest with no requirements', () => {
    const manifest = createValidManifest();
    const requirements: ProviderRequirements = {};

    expect(matchesRequirements(manifest, requirements)).toBe(true);
  });

  it('should check minRequestsPerMinute', () => {
    const manifest = createValidManifest({
      rateLimits: { requestsPerMinute: 100 },
    });

    expect(matchesRequirements(manifest, { minRequestsPerMinute: 50 })).toBe(true);
    expect(matchesRequirements(manifest, { minRequestsPerMinute: 100 })).toBe(true);
    expect(matchesRequirements(manifest, { minRequestsPerMinute: 150 })).toBe(false);
  });

  it('should check minContextWindow', () => {
    const manifest = createValidManifest({
      costConfig: {
        currency: 'USD',
        models: [
          { modelId: 'small', inputCostPer1kTokens: 0.001, outputCostPer1kTokens: 0.002, contextWindow: 8000 },
          { modelId: 'large', inputCostPer1kTokens: 0.01, outputCostPer1kTokens: 0.02, contextWindow: 128000 },
        ],
      },
    });

    expect(matchesRequirements(manifest, { minContextWindow: 8000 })).toBe(true);
    expect(matchesRequirements(manifest, { minContextWindow: 64000 })).toBe(true);
    expect(matchesRequirements(manifest, { minContextWindow: 200000 })).toBe(false);
  });

  it('should check required tools', () => {
    const manifest = createValidManifest({
      tools: {
        streaming: true,
        functionCalling: true,
        vision: false,
        jsonMode: false,
        embeddings: false,
      },
    });

    expect(
      matchesRequirements(manifest, {
        requiredTools: { streaming: true, functionCalling: true },
      })
    ).toBe(true);

    expect(
      matchesRequirements(manifest, {
        requiredTools: { vision: true },
      })
    ).toBe(false);
  });

  it('should check required features', () => {
    const manifest = createValidManifest({
      features: {
        prdGeneration: true,
        codeGeneration: true,
        codeReview: false,
        specGeneration: true,
        testGeneration: true,
        summarization: true,
      },
    });

    expect(
      matchesRequirements(manifest, {
        requiredFeatures: { prdGeneration: true, codeGeneration: true },
      })
    ).toBe(true);

    expect(
      matchesRequirements(manifest, {
        requiredFeatures: { codeReview: true },
      })
    ).toBe(false);
  });

  it('should check maxCostPer1kTokens', () => {
    const manifest = createValidManifest({
      costConfig: {
        currency: 'USD',
        models: [
          { modelId: 'cheap', inputCostPer1kTokens: 0.001, outputCostPer1kTokens: 0.002 }, // avg: 0.003
          { modelId: 'expensive', inputCostPer1kTokens: 0.01, outputCostPer1kTokens: 0.02 }, // avg: 0.03
        ],
      },
    });

    // Average cost = (0.003 + 0.03) / 2 = 0.0165
    expect(matchesRequirements(manifest, { maxCostPer1kTokens: 0.02 })).toBe(true);
    expect(matchesRequirements(manifest, { maxCostPer1kTokens: 0.01 })).toBe(false);
  });

  it('should handle missing tools/features gracefully', () => {
    const manifest = createValidManifest();
    // No tools or features defined

    expect(
      matchesRequirements(manifest, {
        requiredTools: { streaming: true },
      })
    ).toBe(false);

    expect(
      matchesRequirements(manifest, {
        requiredFeatures: { codeGeneration: true },
      })
    ).toBe(false);
  });
});

// ============================================================================
// rankByPrice Tests
// ============================================================================

describe('rankByPrice', () => {
  it('should sort manifests by ascending average cost', () => {
    const cheap = createValidManifest({
      providerId: 'cheap-provider',
      costConfig: {
        currency: 'USD',
        models: [{ modelId: 'cheap', inputCostPer1kTokens: 0.001, outputCostPer1kTokens: 0.001 }],
      },
    });

    const expensive = createValidManifest({
      providerId: 'expensive-provider',
      costConfig: {
        currency: 'USD',
        models: [{ modelId: 'expensive', inputCostPer1kTokens: 0.01, outputCostPer1kTokens: 0.01 }],
      },
    });

    const medium = createValidManifest({
      providerId: 'medium-provider',
      costConfig: {
        currency: 'USD',
        models: [{ modelId: 'medium', inputCostPer1kTokens: 0.005, outputCostPer1kTokens: 0.005 }],
      },
    });

    const ranked = rankByPrice([expensive, cheap, medium]);

    expect(ranked[0].providerId).toBe('cheap-provider');
    expect(ranked[1].providerId).toBe('medium-provider');
    expect(ranked[2].providerId).toBe('expensive-provider');
  });

  it('should not mutate original array', () => {
    const manifests = [
      createValidManifest({
        providerId: 'b',
        costConfig: {
          currency: 'USD',
          models: [{ modelId: 'model', inputCostPer1kTokens: 0.01, outputCostPer1kTokens: 0.01 }],
        },
      }),
      createValidManifest({
        providerId: 'a',
        costConfig: {
          currency: 'USD',
          models: [{ modelId: 'model', inputCostPer1kTokens: 0.001, outputCostPer1kTokens: 0.001 }],
        },
      }),
    ];

    const ranked = rankByPrice(manifests);

    expect(manifests[0].providerId).toBe('b');
    expect(ranked[0].providerId).toBe('a');
  });

  it('should handle single manifest', () => {
    const manifest = createValidManifest();
    const ranked = rankByPrice([manifest]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toBe(manifest);
  });

  it('should handle empty array', () => {
    const ranked = rankByPrice([]);
    expect(ranked).toEqual([]);
  });
});

// ============================================================================
// ManifestLoader Class Tests
// ============================================================================

describe('ManifestLoader', () => {
  let tempDir: string;
  let logger: StructuredLogger;
  let loader: ManifestLoader;

  beforeEach(async () => {
    tempDir = await createTempDir();
    logger = createMockLogger();
    loader = new ManifestLoader(logger);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('loadManifest', () => {
    it('should load and cache valid manifest', async () => {
      const manifest = createValidManifest();
      const manifestPath = path.join(tempDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

      const loaded = await loader.loadManifest(manifestPath);

      expect(loaded.providerId).toBe('test-provider');
      expect(loader.getManifest('test-provider')).toEqual(loaded);
    });

    it('should return cached manifest on repeated load with same hash', async () => {
      const manifest = createValidManifest();
      const manifestPath = path.join(tempDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

      const first = await loader.loadManifest(manifestPath);
      const second = await loader.loadManifest(manifestPath);

      expect(first).toEqual(second);
      expect(logger.debug).toHaveBeenCalledWith('Using cached manifest', expect.any(Object));
    });

    it('should reload manifest when content changes', async () => {
      const manifest = createValidManifest({ version: '1.0.0' });
      const manifestPath = path.join(tempDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

      await loader.loadManifest(manifestPath);

      // Update manifest
      const updated = createValidManifest({ version: '2.0.0' });
      await fs.writeFile(manifestPath, JSON.stringify(updated), 'utf-8');

      const reloaded = await loader.loadManifest(manifestPath);

      expect(reloaded.version).toBe('2.0.0');
    });

    it('should throw for invalid manifest', async () => {
      const invalidManifest = { invalid: 'data' };
      const manifestPath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(manifestPath, JSON.stringify(invalidManifest), 'utf-8');

      await expect(loader.loadManifest(manifestPath)).rejects.toThrow('Invalid agent manifest');
    });

    it('should register cost configs with cost tracker', async () => {
      const costTracker = createMockCostTracker();
      loader.setCostTracker(costTracker);

      const manifest = createValidManifest({
        costConfig: {
          currency: 'USD',
          models: [
            { modelId: 'model-1', inputCostPer1kTokens: 0.001, outputCostPer1kTokens: 0.002 },
            { modelId: 'model-2', inputCostPer1kTokens: 0.01, outputCostPer1kTokens: 0.02 },
          ],
        },
      });
      const manifestPath = path.join(tempDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

      await loader.loadManifest(manifestPath);

      expect(costTracker.registerCostConfig).toHaveBeenCalledTimes(2);
      expect(costTracker.configs).toHaveLength(2);
    });
  });

  describe('registerManifest', () => {
    it('should register manifest directly', () => {
      const manifest = createValidManifest();

      loader.registerManifest(manifest);

      expect(loader.getManifest('test-provider')).toEqual(manifest);
    });

    it('should accept custom metadata', () => {
      const manifest = createValidManifest();
      const metadata = {
        hash: 'custom-hash',
        loadedAt: '2025-01-01T00:00:00Z',
        sourcePath: '/custom/path.json',
      };

      loader.registerManifest(manifest, metadata);

      expect(loader.getManifestHash('test-provider')).toBe('custom-hash');
    });
  });

  describe('loadManifestsFromDirectory', () => {
    it('should load all JSON files from directory', async () => {
      const manifest1 = createValidManifest({ providerId: 'provider-1' });
      const manifest2 = createValidManifest({ providerId: 'provider-2' });

      await fs.writeFile(
        path.join(tempDir, 'provider1.json'),
        JSON.stringify(manifest1),
        'utf-8'
      );
      await fs.writeFile(
        path.join(tempDir, 'provider2.json'),
        JSON.stringify(manifest2),
        'utf-8'
      );

      const { loaded, errors } = await loader.loadManifestsFromDirectory(tempDir);

      expect(loaded).toHaveLength(2);
      expect(errors).toHaveLength(0);
      expect(loaded.map((m) => m.providerId).sort()).toEqual(['provider-1', 'provider-2']);
    });

    it('should skip non-JSON files', async () => {
      const manifest = createValidManifest();
      await fs.writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
      await fs.writeFile(path.join(tempDir, 'readme.txt'), 'not json', 'utf-8');

      const { loaded, errors } = await loader.loadManifestsFromDirectory(tempDir);

      expect(loaded).toHaveLength(1);
      expect(errors).toHaveLength(0);
    });

    it('should collect errors for invalid manifests', async () => {
      const validManifest = createValidManifest({ providerId: 'valid' });
      const invalidManifest = { invalid: 'data' };

      await fs.writeFile(path.join(tempDir, 'valid.json'), JSON.stringify(validManifest), 'utf-8');
      await fs.writeFile(
        path.join(tempDir, 'invalid.json'),
        JSON.stringify(invalidManifest),
        'utf-8'
      );

      const { loaded, errors } = await loader.loadManifestsFromDirectory(tempDir);

      expect(loaded).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toContain('invalid.json');
    });

    it('should handle non-existent directory gracefully', async () => {
      const { loaded, errors } = await loader.loadManifestsFromDirectory('/non/existent/dir');

      expect(loaded).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  });

  describe('selectProvider', () => {
    beforeEach(() => {
      const cheap = createValidManifest({
        providerId: 'cheap',
        costConfig: {
          currency: 'USD',
          models: [{ modelId: 'model', inputCostPer1kTokens: 0.001, outputCostPer1kTokens: 0.001 }],
        },
        rateLimits: { requestsPerMinute: 100 },
      });
      const expensive = createValidManifest({
        providerId: 'expensive',
        costConfig: {
          currency: 'USD',
          models: [{ modelId: 'model', inputCostPer1kTokens: 0.01, outputCostPer1kTokens: 0.01 }],
        },
        rateLimits: { requestsPerMinute: 200 },
      });

      loader.registerManifest(cheap);
      loader.registerManifest(expensive);
    });

    it('should select cheapest provider matching requirements', () => {
      const selected = loader.selectProvider({ minRequestsPerMinute: 50 });

      expect(selected?.providerId).toBe('cheap');
    });

    it('should respect preferred provider when it matches requirements', () => {
      const selected = loader.selectProvider({ minRequestsPerMinute: 50 }, 'expensive');

      expect(selected?.providerId).toBe('expensive');
    });

    it('should fall back to best match when preferred does not meet requirements', () => {
      const selected = loader.selectProvider({ minRequestsPerMinute: 150 }, 'cheap');

      expect(selected?.providerId).toBe('expensive');
    });

    it('should return undefined when no providers match', () => {
      const selected = loader.selectProvider({ minRequestsPerMinute: 500 });

      expect(selected).toBeUndefined();
    });
  });

  describe('listProviders', () => {
    it('should return empty array when no providers registered', () => {
      expect(loader.listProviders()).toEqual([]);
    });

    it('should return all registered provider IDs', () => {
      loader.registerManifest(createValidManifest({ providerId: 'a' }));
      loader.registerManifest(createValidManifest({ providerId: 'b' }));

      const providers = loader.listProviders();

      expect(providers.sort()).toEqual(['a', 'b']);
    });
  });

  describe('getRegistryState', () => {
    it('should return registry state for diagnostics', () => {
      const manifest = createValidManifest({ providerId: 'test', version: '2.0.0' });
      loader.registerManifest(manifest, {
        hash: 'test-hash',
        loadedAt: '2025-01-01T00:00:00Z',
        sourcePath: '/test/path.json',
      });

      const state = loader.getRegistryState();

      expect(state).toHaveLength(1);
      expect(state[0]).toEqual({
        providerId: 'test',
        version: '2.0.0',
        hash: 'test-hash',
        loadedAt: '2025-01-01T00:00:00Z',
        sourcePath: '/test/path.json',
      });
    });
  });

  describe('clear', () => {
    it('should remove all cached manifests', () => {
      loader.registerManifest(createValidManifest({ providerId: 'a' }));
      loader.registerManifest(createValidManifest({ providerId: 'b' }));

      loader.clear();

      expect(loader.listProviders()).toEqual([]);
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createManifestLoader', () => {
  it('should create new ManifestLoader instance', () => {
    const logger = createMockLogger();
    const loader = createManifestLoader(logger);

    expect(loader).toBeInstanceOf(ManifestLoader);
  });
});

describe('loadManifestLoaderFromRepo', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should load manifests from standard directory structure', async () => {
    // Create standard directory structure
    const agentsDir = path.join(tempDir, '.codepipe', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });

    const manifest = createValidManifest({ providerId: 'repo-provider' });
    await fs.writeFile(path.join(agentsDir, 'provider.json'), JSON.stringify(manifest), 'utf-8');

    const logger = createMockLogger();
    const { loader, errors } = await loadManifestLoaderFromRepo(tempDir, logger);

    expect(errors).toHaveLength(0);
    expect(loader.getManifest('repo-provider')).toBeDefined();
  });

  it('should set cost tracker when provided', async () => {
    const agentsDir = path.join(tempDir, '.codepipe', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });

    const manifest = createValidManifest();
    await fs.writeFile(path.join(agentsDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    const logger = createMockLogger();
    const costTracker = createMockCostTracker();
    const { loader } = await loadManifestLoaderFromRepo(tempDir, logger, costTracker);

    expect(loader.getManifest('test-provider')).toBeDefined();
    expect(costTracker.registerCostConfig).toHaveBeenCalled();
  });

  it('should handle missing agents directory gracefully', async () => {
    const logger = createMockLogger();
    const { loader, errors } = await loadManifestLoaderFromRepo(tempDir, logger);

    expect(errors).toHaveLength(0);
    expect(loader.listProviders()).toEqual([]);
  });
});
