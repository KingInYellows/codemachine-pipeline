import { describe, it, expect } from 'vitest';
import {
  mapTaskToWorkflow,
  shouldUseNativeEngine,
  getSupportedEngines,
  isEngineSupported,
  assertEngineSupported,
  isValidCommand,
  isValidSubcommand,
  validateCommandStructure,
  createStepCommand,
  createStatusCommand,
  ALLOWED_COMMANDS,
  type CommandStructure,
} from '../../src/workflows/taskMapper';

describe('taskMapper', () => {
  describe('mapTaskToWorkflow', () => {
    it('maps code_generation to correct workflow', () => {
      const mapping = mapTaskToWorkflow('code_generation');
      expect(mapping.workflow).toBe('codemachine start');
      expect(mapping.command).toBe('start');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('maps testing to native engine', () => {
      const mapping = mapTaskToWorkflow('testing');
      expect(mapping.workflow).toBe('native-autofix');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(true);
    });

    it('maps pr_creation correctly', () => {
      const mapping = mapTaskToWorkflow('pr_creation');
      expect(mapping.workflow).toBe('codemachine run pr');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('maps deployment to native engine', () => {
      const mapping = mapTaskToWorkflow('deployment');
      expect(mapping.workflow).toBe('native-deployment');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(true);
    });

    it('maps review correctly', () => {
      const mapping = mapTaskToWorkflow('review');
      expect(mapping.workflow).toBe('codemachine run review');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('maps refactoring correctly', () => {
      const mapping = mapTaskToWorkflow('refactoring');
      expect(mapping.workflow).toBe('codemachine start');
      expect(mapping.command).toBe('start');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('maps documentation correctly', () => {
      const mapping = mapTaskToWorkflow('documentation');
      expect(mapping.workflow).toBe('codemachine run docs');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('maps other correctly', () => {
      const mapping = mapTaskToWorkflow('other');
      expect(mapping.workflow).toBe('codemachine start');
      expect(mapping.command).toBe('start');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('maps all task types', () => {
      const taskTypes = [
        'code_generation',
        'testing',
        'pr_creation',
        'deployment',
        'review',
        'refactoring',
        'documentation',
        'other',
      ] as const;

      for (const taskType of taskTypes) {
        const mapping = mapTaskToWorkflow(taskType);
        expect(mapping).toBeDefined();
        expect(mapping.workflow).toBeTruthy();
        expect(['run', 'start']).toContain(mapping.command);
      }
    });
  });

  describe('shouldUseNativeEngine', () => {
    it('returns true for testing', () => {
      expect(shouldUseNativeEngine('testing')).toBe(true);
    });

    it('returns true for deployment', () => {
      expect(shouldUseNativeEngine('deployment')).toBe(true);
    });

    it('returns false for code_generation', () => {
      expect(shouldUseNativeEngine('code_generation')).toBe(false);
    });

    it('returns false for pr_creation', () => {
      expect(shouldUseNativeEngine('pr_creation')).toBe(false);
    });

    it('returns false for review', () => {
      expect(shouldUseNativeEngine('review')).toBe(false);
    });

    it('returns false for refactoring', () => {
      expect(shouldUseNativeEngine('refactoring')).toBe(false);
    });

    it('returns false for documentation', () => {
      expect(shouldUseNativeEngine('documentation')).toBe(false);
    });

    it('returns false for other', () => {
      expect(shouldUseNativeEngine('other')).toBe(false);
    });
  });

  describe('getSupportedEngines', () => {
    it('returns all supported engines', () => {
      const engines = getSupportedEngines();
      expect(engines).toContain('claude');
      expect(engines).toContain('codex');
      expect(engines).toContain('openai');
      expect(engines.length).toBe(3);
    });
  });

  describe('isEngineSupported', () => {
    it('returns true for supported engines', () => {
      expect(isEngineSupported('claude')).toBe(true);
      expect(isEngineSupported('codex')).toBe(true);
      expect(isEngineSupported('openai')).toBe(true);
    });

    it('returns false for unsupported engines', () => {
      expect(isEngineSupported('gpt4')).toBe(false);
      expect(isEngineSupported('invalid')).toBe(false);
      expect(isEngineSupported('')).toBe(false);
    });
  });

  describe('assertEngineSupported', () => {
    it('does not throw for supported engines', () => {
      expect(() => assertEngineSupported('claude')).not.toThrow();
      expect(() => assertEngineSupported('codex')).not.toThrow();
      expect(() => assertEngineSupported('openai')).not.toThrow();
    });

    it('throws EC-EXEC-007 for unsupported engines', () => {
      try {
        assertEngineSupported('unsupported-engine');
        expect(false).toBe(true);
      } catch (error) {
        const err = error as Error & { code?: string };
        expect(err.message).toContain('Engine');
        expect(err.code).toBe('EC-EXEC-007');
      }
    });
  });

  describe('command validation', () => {
    it('accepts valid commands', () => {
      expect(isValidCommand('start')).toBe(true);
      expect(isValidCommand('run')).toBe(true);
    });

    it('rejects invalid commands', () => {
      expect(isValidCommand('build')).toBe(false);
      expect(isValidCommand('')).toBe(false);
    });

    it('accepts valid subcommands', () => {
      expect(isValidSubcommand('pr')).toBe(true);
      expect(isValidSubcommand('review')).toBe(true);
      expect(isValidSubcommand('docs')).toBe(true);
    });

    it('rejects invalid subcommands', () => {
      expect(isValidSubcommand('deploy')).toBe(false);
      expect(isValidSubcommand('')).toBe(false);
    });

    it('validates command structures and error codes', () => {
      const validStart: CommandStructure = {
        executable: 'codemachine',
        command: 'start',
        args: [],
      };

      const validRun: CommandStructure = {
        executable: 'codemachine',
        command: 'run',
        subcommand: 'pr',
        args: [],
      };

      expect(() => validateCommandStructure(validStart)).not.toThrow();
      expect(() => validateCommandStructure(validRun)).not.toThrow();

      try {
        validateCommandStructure({ ...validStart, command: 'build' });
        expect(false).toBe(true);
      } catch (error) {
        const err = error as Error & { code?: string };
        expect(err.code).toBe('EC-EXEC-008');
      }

      try {
        validateCommandStructure({ ...validRun, subcommand: 'deploy' });
        expect(false).toBe(true);
      } catch (error) {
        const err = error as Error & { code?: string };
        expect(err.code).toBe('EC-EXEC-009');
      }

      try {
        validateCommandStructure({ ...validStart, subcommand: 'pr' });
        expect(false).toBe(true);
      } catch (error) {
        const err = error as Error & { code?: string };
        expect(err.code).toBe('EC-EXEC-010');
      }
    });
  });

  describe('step command', () => {
    it('should include step in ALLOWED_COMMANDS', () => {
      expect(ALLOWED_COMMANDS).toContain('step');
    });

    it('should have step as the third command in ALLOWED_COMMANDS', () => {
      expect(ALLOWED_COMMANDS[2]).toBe('step');
    });

    it('should validate step command as allowed', () => {
      const structure: CommandStructure = {
        executable: 'codemachine',
        command: 'step',
        args: [],
      };
      expect(() => validateCommandStructure(structure)).not.toThrow();
    });

    it('should validate that step is a valid command', () => {
      expect(isValidCommand('step')).toBe(true);
    });

    it('should create step command without args', () => {
      const stepCmd = createStepCommand();
      expect(stepCmd.command).toBe('step');
      expect(stepCmd.args).toEqual([]);
      expect(stepCmd.executable).toBe('codemachine');
      expect(stepCmd.subcommand).toBeUndefined();
    });

    it('should create step command with args', () => {
      const stepCmd = createStepCommand(['--step-id', 'my-step']);
      expect(stepCmd.command).toBe('step');
      expect(stepCmd.args).toEqual(['--step-id', 'my-step']);
      expect(stepCmd.executable).toBe('codemachine');
      expect(stepCmd.subcommand).toBeUndefined();
    });

    it('should create step command with engine option', () => {
      const stepCmd = createStepCommand(['--engine', 'claude']);
      expect(stepCmd.command).toBe('step');
      expect(stepCmd.args).toEqual(['--engine', 'claude']);
    });

    it('should reject step command with subcommand', () => {
      const structure: CommandStructure = {
        executable: 'codemachine',
        command: 'step',
        subcommand: 'pr',
        args: [],
      };
      try {
        validateCommandStructure(structure);
        expect(false).toBe(true);
      } catch (error) {
        const err = error as Error & { code?: string };
        expect(err.message).toContain('does not support subcommands');
        expect(err.code).toBe('EC-EXEC-010');
      }
    });

    it('should handle empty args array in createStepCommand', () => {
      const stepCmd = createStepCommand([]);
      expect(stepCmd.args).toHaveLength(0);
    });

    it('should preserve all args passed to createStepCommand', () => {
      const args = ['--step-id', 'step-1', '--engine', 'claude', '--verbose'];
      const stepCmd = createStepCommand(args);
      expect(stepCmd.args).toEqual(args);
      expect(stepCmd.args).toHaveLength(5);
    });
  });

  describe('status command', () => {
    it('should include status in ALLOWED_COMMANDS', () => {
      expect(ALLOWED_COMMANDS).toContain('status');
    });

    it('should have status as the fourth command in ALLOWED_COMMANDS', () => {
      expect(ALLOWED_COMMANDS[3]).toBe('status');
    });

    it('should validate status command as allowed', () => {
      const structure: CommandStructure = {
        executable: 'codemachine',
        command: 'status',
        args: [],
      };
      expect(() => validateCommandStructure(structure)).not.toThrow();
    });

    it('should validate that status is a valid command', () => {
      expect(isValidCommand('status')).toBe(true);
    });

    it('should create status command without args', () => {
      const statusCmd = createStatusCommand();
      expect(statusCmd.command).toBe('status');
      expect(statusCmd.args).toEqual([]);
      expect(statusCmd.executable).toBe('codemachine');
      expect(statusCmd.subcommand).toBeUndefined();
    });

    it('should create status command with args', () => {
      const statusCmd = createStatusCommand(['--json', '--verbose']);
      expect(statusCmd.command).toBe('status');
      expect(statusCmd.args).toEqual(['--json', '--verbose']);
      expect(statusCmd.executable).toBe('codemachine');
      expect(statusCmd.subcommand).toBeUndefined();
    });

    it('should create status command with single arg', () => {
      const statusCmd = createStatusCommand(['--json']);
      expect(statusCmd.command).toBe('status');
      expect(statusCmd.args).toEqual(['--json']);
    });

    it('should reject status command with subcommand', () => {
      const structure: CommandStructure = {
        executable: 'codemachine',
        command: 'status',
        subcommand: 'pr',
        args: [],
      };
      try {
        validateCommandStructure(structure);
        expect(false).toBe(true);
      } catch (error) {
        const err = error as Error & { code?: string };
        expect(err.message).toContain('does not support subcommands');
        expect(err.code).toBe('EC-EXEC-010');
      }
    });

    it('should handle empty args array in createStatusCommand', () => {
      const statusCmd = createStatusCommand([]);
      expect(statusCmd.args).toHaveLength(0);
    });

    it('should preserve all args passed to createStatusCommand', () => {
      const args = ['--format', 'table', '--filter', 'running', '--limit', '10'];
      const statusCmd = createStatusCommand(args);
      expect(statusCmd.args).toEqual(args);
      expect(statusCmd.args).toHaveLength(6);
    });
  });
});
