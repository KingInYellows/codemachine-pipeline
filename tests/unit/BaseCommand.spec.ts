/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseCommand, type CommandContext } from '../../src/cli/BaseCommand';
import type { StructuredLogger } from '../../src/telemetry/logger';
import type { MetricsCollector } from '../../src/telemetry/metrics';
import type { TraceManager } from '../../src/telemetry/traces';
import { SpanStatusCode } from '../../src/telemetry/traces';

vi.mock('../../src/telemetry/logger');
vi.mock('../../src/telemetry/metrics');
vi.mock('../../src/telemetry/traces');
vi.mock('../../src/persistence/runDirectoryManager');
vi.mock('../../src/cli/utils/runDirectory');

class TestCommand extends BaseCommand {
  static description = 'Test command';
  static flags = {
    ...BaseCommand.baseFlags,
  };

  public executeCalled = false;
  public executeContext: CommandContext | undefined;
  public shouldThrow = false;

  protected get commandName() {
    return 'test-command';
  }

  protected async execute(context: CommandContext): Promise<void> {
    this.executeCalled = true;
    this.executeContext = context;
    if (this.shouldThrow) {
      throw new Error('Test error');
    }
  }
}

class NoFeatureCommand extends BaseCommand {
  static description = 'Command without feature requirement';
  static flags = {
    ...BaseCommand.baseFlags,
  };

  protected get commandName() {
    return 'no-feature';
  }

  protected get requiresFeature() {
    return false;
  }

  protected async execute(_context: CommandContext): Promise<void> {}
}

describe('BaseCommand', () => {
  let mockLogger: Partial<StructuredLogger>;
  let mockMetrics: Partial<MetricsCollector>;
  let mockTraceManager: Partial<TraceManager>;
  let mockSpan: { end: ReturnType<typeof vi.fn>; setAttribute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockSpan = {
      end: vi.fn(),
      setAttribute: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    mockMetrics = {
      observe: vi.fn(),
      increment: vi.fn(),
    };

    mockTraceManager = {
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };

    const { createCliLogger } = await import('../../src/telemetry/logger');
    const { createRunMetricsCollector } = await import('../../src/telemetry/metrics');
    const { createRunTraceManager } = await import('../../src/telemetry/traces');
    const { resolveRunDirectorySettings, selectFeatureId, ensureTelemetryReferences } =
      await import('../../src/cli/utils/runDirectory');
    const { getRunDirectoryPath } = await import('../../src/persistence/runDirectoryManager');

    vi.mocked(createCliLogger).mockReturnValue(mockLogger as StructuredLogger);
    vi.mocked(createRunMetricsCollector).mockReturnValue(mockMetrics as MetricsCollector);
    vi.mocked(createRunTraceManager).mockReturnValue(mockTraceManager as TraceManager);
    vi.mocked(resolveRunDirectorySettings).mockReturnValue({
      baseDir: '/test/base',
      configPath: '/test/base/config.json',
      warnings: [],
      errors: [],
    });
    vi.mocked(selectFeatureId).mockResolvedValue('test-feature-123');
    vi.mocked(ensureTelemetryReferences).mockResolvedValue();
    vi.mocked(getRunDirectoryPath).mockReturnValue('/test/base/runs/test-feature-123');
  });

  describe('baseFlags', () => {
    it('should define json flag', () => {
      expect(BaseCommand.baseFlags.json).toBeDefined();
      expect(BaseCommand.baseFlags.json.default).toBe(false);
    });

    it('should define verbose flag', () => {
      expect(BaseCommand.baseFlags.verbose).toBeDefined();
      expect(BaseCommand.baseFlags.verbose.default).toBe(false);
    });
  });

  describe('telemetry initialization', () => {
    it('should initialize logger with correct parameters', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });

      await command.run();

      const { createCliLogger } = await import('../../src/telemetry/logger');
      expect(createCliLogger).toHaveBeenCalledWith(
        'test-command',
        'test-feature-123',
        '/test/base/runs/test-feature-123',
        expect.objectContaining({
          mirrorToStderr: true,
        })
      );
    });

    it('should initialize metrics with run directory', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });

      await command.run();

      const { createRunMetricsCollector } = await import('../../src/telemetry/metrics');
      expect(createRunMetricsCollector).toHaveBeenCalledWith(
        '/test/base/runs/test-feature-123',
        'test-feature-123'
      );
    });

    it('should start trace span with command name', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });

      await command.run();

      expect(mockTraceManager.startSpan).toHaveBeenCalledWith('cli.test-command');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('command', 'test-command');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('feature_id', 'test-feature-123');
    });
  });

  describe('execute()', () => {
    it('should call execute with context', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });

      await command.run();

      expect(command.executeCalled).toBe(true);
      expect(command.executeContext).toBeDefined();
      expect(command.executeContext?.logger).toBe(mockLogger);
      expect(command.executeContext?.metrics).toBe(mockMetrics);
      expect(command.executeContext?.traceManager).toBe(mockTraceManager);
      expect(command.executeContext?.featureId).toBe('test-feature-123');
    });

    it('should include flags in context', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({
        flags: { json: true, verbose: true, customFlag: 'value' },
      });

      await command.run();

      expect(command.executeContext?.flags).toEqual({
        json: true,
        verbose: true,
        customFlag: 'value',
      });
    });
  });

  describe('success metrics', () => {
    it('should record success metrics on completion', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });

      await command.run();

      expect(mockMetrics.observe).toHaveBeenCalledWith(
        'command_execution_duration_ms',
        expect.any(Number),
        { command: 'test-command', status: 'success' }
      );
      expect(mockMetrics.increment).toHaveBeenCalledWith('command_invocations_total', {
        command: 'test-command',
        status: 'success',
      });
    });

    it('should end span with OK status on success', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });

      await command.run();

      expect(mockSpan.end).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    });
  });

  describe('error handling', () => {
    it('should record error metrics on failure', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });
      command.shouldThrow = true;

      await expect(command.run()).rejects.toThrow();

      expect(mockMetrics.observe).toHaveBeenCalledWith(
        'command_execution_duration_ms',
        expect.any(Number),
        { command: 'test-command', status: 'error' }
      );
      expect(mockMetrics.increment).toHaveBeenCalledWith('command_invocations_total', {
        command: 'test-command',
        status: 'error',
      });
    });

    it('should end span with ERROR status on failure', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });
      command.shouldThrow = true;

      await expect(command.run()).rejects.toThrow();

      expect(mockSpan.end).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: expect.stringContaining('Test error'),
      });
    });

    it('should wrap errors with context', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });
      command.shouldThrow = true;

      await expect(command.run()).rejects.toThrow('test-command command failed: Test error');
    });

    it('should log error with duration', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });
      command.shouldThrow = true;

      await expect(command.run()).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'test-command command failed',
        expect.objectContaining({
          duration_ms: expect.any(Number),
        })
      );
    });
  });

  describe('json flag', () => {
    it('should set JSON_OUTPUT env var when json flag is true', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: true, verbose: false } });

      await command.run();

      expect(process.env.JSON_OUTPUT).toBe('1');
    });

    it('should disable stderr mirroring when json is true', async () => {
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: true, verbose: false } });

      await command.run();

      const { createCliLogger } = await import('../../src/telemetry/logger');
      expect(createCliLogger).toHaveBeenCalledWith(
        'test-command',
        'test-feature-123',
        '/test/base/runs/test-feature-123',
        expect.objectContaining({
          mirrorToStderr: false,
        })
      );
    });
  });

  describe('verbose flag', () => {
    it('should set DEBUG log level when verbose is true', async () => {
      const { LogLevel } = await import('../../src/telemetry/logger');
      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: true } });

      await command.run();

      const { createCliLogger } = await import('../../src/telemetry/logger');
      expect(createCliLogger).toHaveBeenCalledWith(
        'test-command',
        'test-feature-123',
        '/test/base/runs/test-feature-123',
        expect.objectContaining({
          minLevel: LogLevel.DEBUG,
        })
      );
    });
  });

  describe('requiresFeature', () => {
    it('should error when feature required but not found', async () => {
      const { selectFeatureId } = await import('../../src/cli/utils/runDirectory');
      vi.mocked(selectFeatureId).mockResolvedValue(undefined);

      const command = new TestCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });
      command.error = vi.fn();

      await command.run();

      expect(command.error).toHaveBeenCalledWith(
        'No feature found. Use --feature to specify feature ID.',
        {
          exit: 10,
        }
      );
    });

    it('should not error when feature not required', async () => {
      const { selectFeatureId } = await import('../../src/cli/utils/runDirectory');
      vi.mocked(selectFeatureId).mockResolvedValue(undefined);

      const command = new NoFeatureCommand([], {} as any);
      command.parse = vi.fn().mockResolvedValue({ flags: { json: false, verbose: false } });
      command.error = vi.fn();

      await command.run();

      expect(command.error).not.toHaveBeenCalled();
    });
  });
});
