import { Errors } from '@oclif/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, CliErrorCode } from '../../../src/cli/utils/cliErrors';
import {
  flushTelemetryError,
  flushTelemetrySuccess,
} from '../../../src/cli/utils/telemetryLifecycle';
import {
  TelemetryCommand,
  type TelemetryCommandOptions,
  type TelemetryContext,
  type TelemetryResult,
} from '../../../src/cli/telemetryCommand';

vi.mock('../../../src/cli/utils/telemetryLifecycle', () => ({
  flushTelemetrySuccess: vi.fn(),
  flushTelemetryError: vi.fn(),
}));

class TestTelemetryCommand extends TelemetryCommand {
  protected get commandName(): string {
    return 'test-command';
  }

  reportError<T extends Error>(error: T): T {
    return this.markErrorAsReported(error);
  }

  async invoke(
    options: TelemetryCommandOptions,
    execute: (ctx: TelemetryContext) => Promise<TelemetryResult | void>
  ): Promise<void> {
    await this.runWithTelemetry(options, execute);
  }
}

function createCommand(): TestTelemetryCommand {
  const command = new TestTelemetryCommand([], {} as never);
  command.error = vi.fn((message: string, options?: { exit?: number }) => {
    const error = new Error(message) as Error & { oclif: { exit: number } };
    error.oclif = { exit: options?.exit ?? 2 };
    throw error;
  }) as never;
  command.logToStderr = vi.fn() as never;
  return command;
}

describe('TelemetryCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flushes success telemetry for zero-exit execution', async () => {
    const command = createCommand();

    await command.invoke({}, async () => ({
      extraLogFields: { ok: true },
    }));

    expect(flushTelemetrySuccess).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'test-command' }),
      { ok: true },
      0
    );
    expect(flushTelemetryError).not.toHaveBeenCalled();
  });

  it('uses process.exit for non-zero success exits', async () => {
    const command = createCommand();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await command.invoke({}, async () => ({ exitCode: 7 }));

    expect(flushTelemetrySuccess).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'test-command' }),
      undefined,
      7
    );
    expect(flushTelemetryError).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(7);

    exitSpy.mockRestore();
  });

  it('flushes mapped CliError exit codes before exiting the CLI process', async () => {
    const command = createCommand();
    const cliError = new CliError('run missing', CliErrorCode.RUN_DIR_NOT_FOUND);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(Errors, 'error').mockImplementation(() => undefined as never);

    await command.invoke({}, async () => {
      throw cliError;
    });

    expect(flushTelemetryError).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'test-command' }),
      cliError,
      10
    );
    expect(errorSpy).toHaveBeenCalledWith('run missing', {
      exit: false,
      code: CliErrorCode.RUN_DIR_NOT_FOUND,
      suggestions: undefined,
    });
    expect(exitSpy).toHaveBeenCalledWith(10);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits silently after flushing telemetry for already-reported CliErrors', async () => {
    const command = createCommand();
    const cliError = command.reportError(
      new CliError('json already rendered', CliErrorCode.GENERAL)
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(Errors, 'error').mockImplementation(() => undefined as never);

    await command.invoke({}, async () => {
      throw cliError;
    });

    expect(flushTelemetryError).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'test-command' }),
      cliError,
      1
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(command.error).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('flushes oclif exit codes without rewriting the original error', async () => {
    const command = createCommand();
    const oclifError = new Error('already formatted') as Error & {
      oclif: { exit: number };
    };
    oclifError.oclif = { exit: 23 };

    await expect(
      command.invoke({}, async () => {
        throw oclifError;
      })
    ).rejects.toBe(oclifError);

    expect(flushTelemetryError).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'test-command' }),
      oclifError,
      23
    );
    expect(command.error).not.toHaveBeenCalled();
  });

  it('supports overriding the telemetry command label', async () => {
    const command = createCommand();

    await command.invoke({ commandNameOverride: 'validate.init' }, async () => undefined);

    expect(flushTelemetrySuccess).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'validate.init' }),
      undefined,
      0
    );
  });
});
