import { describe, it, expect } from 'vitest';
import {
  mapTaskToWorkflow,
  shouldUseNativeEngine,
  getSupportedEngines,
  isEngineSupported,
  assertEngineSupported,
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
});
