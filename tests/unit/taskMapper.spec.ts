import { describe, it, expect } from 'vitest';
import {
  mapTaskToWorkflow,
  shouldUseNativeEngine,
  getSupportedEngines,
  isEngineSupported,
} from '../../src/workflows/taskMapper';

describe('taskMapper', () => {
  describe('mapTaskToWorkflow', () => {
    it('maps code_generation to correct workflow', () => {
      const mapping = mapTaskToWorkflow('code_generation');
      expect(mapping.agentId).toBe('code-generator');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('maps testing to native engine', () => {
      const mapping = mapTaskToWorkflow('testing');
      expect(mapping.agentId).toBe('test-runner');
      expect(mapping.useNativeEngine).toBe(true);
    });

    it('maps pr_creation correctly', () => {
      const mapping = mapTaskToWorkflow('pr_creation');
      expect(mapping.agentId).toBe('pr-creator');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('maps deployment to native engine', () => {
      const mapping = mapTaskToWorkflow('deployment');
      expect(mapping.useNativeEngine).toBe(true);
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
        expect(mapping.agentId).toBeTruthy();
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
  });

  describe('getSupportedEngines', () => {
    it('returns all supported engines', () => {
      const engines = getSupportedEngines();
      expect(engines).toContain('claude');
      expect(engines).toContain('codex');
      expect(engines).toContain('opencode');
      expect(engines).toContain('cursor');
      expect(engines).toContain('auggie');
      expect(engines).toContain('ccr');
      expect(engines.length).toBe(6);
    });
  });

  describe('isEngineSupported', () => {
    it('returns true for supported engines', () => {
      expect(isEngineSupported('claude')).toBe(true);
      expect(isEngineSupported('codex')).toBe(true);
      expect(isEngineSupported('opencode')).toBe(true);
    });

    it('returns false for unsupported engines', () => {
      expect(isEngineSupported('gpt4')).toBe(false);
      expect(isEngineSupported('invalid')).toBe(false);
      expect(isEngineSupported('')).toBe(false);
    });
  });
});
