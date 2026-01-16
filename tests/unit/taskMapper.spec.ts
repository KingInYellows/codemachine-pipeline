/**
 * Unit Tests for Task Mapper
 *
 * Tests the task mapping workflow including:
 * - ExecutionTaskType to WorkflowMapping conversion
 * - All 8 task types have explicit mappings
 * - Native engine routing for testing tasks
 * - Supported engine validation
 * - Error handling for unsupported engines
 *
 * Implements:
 * - CDMCH-17: TaskMapper refactoring for ExecutionTaskType -> CodeMachine workflows
 */

import { describe, it, expect } from 'vitest';
import {
  mapTaskToWorkflow,
  getSupportedEngines,
  isEngineSupported,
  validateEngine,
  getTaskTypesForWorkflow,
  getNativeEngineTasks,
  getWorkflowSummary,
  TASK_TYPE_TO_WORKFLOW,
  type SupportedEngine,
} from '../../src/workflows/taskMapper';
import type { ExecutionTaskType } from '../../src/core/models/ExecutionTask';

// ============================================================================
// Test Data
// ============================================================================

const ALL_TASK_TYPES: ExecutionTaskType[] = [
  'code_generation',
  'testing',
  'pr_creation',
  'deployment',
  'review',
  'refactoring',
  'documentation',
  'other',
];

// ============================================================================
// Test Suites
// ============================================================================

describe('Task Mapper', () => {
  describe('TASK_TYPE_TO_WORKFLOW constant', () => {
    it('should have mappings for all 8 ExecutionTaskType values', () => {
      expect(Object.keys(TASK_TYPE_TO_WORKFLOW)).toHaveLength(8);

      for (const taskType of ALL_TASK_TYPES) {
        expect(TASK_TYPE_TO_WORKFLOW[taskType]).toBeDefined();
      }
    });

    it('should have valid WorkflowMapping structure for each task type', () => {
      for (const taskType of ALL_TASK_TYPES) {
        const mapping = TASK_TYPE_TO_WORKFLOW[taskType];

        expect(mapping).toHaveProperty('workflow');
        expect(mapping).toHaveProperty('command');
        expect(mapping).toHaveProperty('useNativeEngine');

        expect(typeof mapping.workflow).toBe('string');
        expect(mapping.workflow.length).toBeGreaterThan(0);
        expect(['start', 'run', 'step']).toContain(mapping.command);
        expect(typeof mapping.useNativeEngine).toBe('boolean');
      }
    });
  });

  describe('mapTaskToWorkflow', () => {
    it('should return correct mapping for code_generation', () => {
      const mapping = mapTaskToWorkflow('code_generation');

      expect(mapping.workflow).toBe('codemachine');
      expect(mapping.command).toBe('start');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('should return correct mapping for refactoring', () => {
      const mapping = mapTaskToWorkflow('refactoring');

      expect(mapping.workflow).toBe('codemachine');
      expect(mapping.command).toBe('start');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('should return correct mapping for other', () => {
      const mapping = mapTaskToWorkflow('other');

      expect(mapping.workflow).toBe('codemachine');
      expect(mapping.command).toBe('start');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('should return correct mapping for pr_creation', () => {
      const mapping = mapTaskToWorkflow('pr_creation');

      expect(mapping.workflow).toBe('pr');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('should return correct mapping for review', () => {
      const mapping = mapTaskToWorkflow('review');

      expect(mapping.workflow).toBe('review');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('should return correct mapping for documentation', () => {
      const mapping = mapTaskToWorkflow('documentation');

      expect(mapping.workflow).toBe('docs');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('should return correct mapping for testing with native engine', () => {
      const mapping = mapTaskToWorkflow('testing');

      expect(mapping.workflow).toBe('autofix');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(true);
    });

    it('should return correct mapping for deployment', () => {
      const mapping = mapTaskToWorkflow('deployment');

      expect(mapping.workflow).toBe('deploy');
      expect(mapping.command).toBe('run');
      expect(mapping.useNativeEngine).toBe(false);
    });

    it('should throw error for unknown task type', () => {
      expect(() => {
        mapTaskToWorkflow('invalid_type' as ExecutionTaskType);
      }).toThrow('Unknown task type: invalid_type');
    });
  });

  describe('getSupportedEngines', () => {
    it('should return array of supported engines', () => {
      const engines = getSupportedEngines();

      expect(Array.isArray(engines)).toBe(true);
      expect(engines).toContain('codemachine');
      expect(engines).toContain('autofix');
    });

    it('should return exactly 2 engines', () => {
      const engines = getSupportedEngines();

      expect(engines).toHaveLength(2);
    });
  });

  describe('isEngineSupported', () => {
    it('should return true for codemachine', () => {
      expect(isEngineSupported('codemachine')).toBe(true);
    });

    it('should return true for autofix', () => {
      expect(isEngineSupported('autofix')).toBe(true);
    });

    it('should return false for unsupported engines', () => {
      expect(isEngineSupported('unknown')).toBe(false);
      expect(isEngineSupported('claude')).toBe(false);
      expect(isEngineSupported('codex')).toBe(false);
      expect(isEngineSupported('')).toBe(false);
    });

    it('should act as type guard', () => {
      const engine = 'codemachine';
      if (isEngineSupported(engine)) {
        const supportedEngine: SupportedEngine = engine;
        expect(supportedEngine).toBe('codemachine');
      }
    });
  });

  describe('validateEngine', () => {
    it('should return engine for valid engines', () => {
      expect(validateEngine('codemachine')).toBe('codemachine');
      expect(validateEngine('autofix')).toBe('autofix');
    });

    it('should throw error for unsupported engines', () => {
      expect(() => validateEngine('unknown')).toThrow('Unsupported engine: unknown');
      expect(() => validateEngine('claude')).toThrow('Unsupported engine: claude');
      expect(() => validateEngine('')).toThrow('Unsupported engine: ');
    });
  });

  describe('getTaskTypesForWorkflow', () => {
    it('should return task types for codemachine workflow', () => {
      const taskTypes = getTaskTypesForWorkflow('codemachine');

      expect(taskTypes).toContain('code_generation');
      expect(taskTypes).toContain('refactoring');
      expect(taskTypes).toContain('other');
      expect(taskTypes).toHaveLength(3);
    });

    it('should return task types for pr workflow', () => {
      const taskTypes = getTaskTypesForWorkflow('pr');

      expect(taskTypes).toContain('pr_creation');
      expect(taskTypes).toHaveLength(1);
    });

    it('should return task types for review workflow', () => {
      const taskTypes = getTaskTypesForWorkflow('review');

      expect(taskTypes).toContain('review');
      expect(taskTypes).toHaveLength(1);
    });

    it('should return task types for docs workflow', () => {
      const taskTypes = getTaskTypesForWorkflow('docs');

      expect(taskTypes).toContain('documentation');
      expect(taskTypes).toHaveLength(1);
    });

    it('should return task types for autofix workflow', () => {
      const taskTypes = getTaskTypesForWorkflow('autofix');

      expect(taskTypes).toContain('testing');
      expect(taskTypes).toHaveLength(1);
    });

    it('should return task types for deploy workflow', () => {
      const taskTypes = getTaskTypesForWorkflow('deploy');

      expect(taskTypes).toContain('deployment');
      expect(taskTypes).toHaveLength(1);
    });

    it('should return empty array for unknown workflow', () => {
      const taskTypes = getTaskTypesForWorkflow('unknown');

      expect(taskTypes).toHaveLength(0);
    });
  });

  describe('getNativeEngineTasks', () => {
    it('should return only testing task type', () => {
      const nativeTasks = getNativeEngineTasks();

      expect(nativeTasks).toContain('testing');
      expect(nativeTasks).toHaveLength(1);
    });

    it('should not include non-native engine tasks', () => {
      const nativeTasks = getNativeEngineTasks();

      expect(nativeTasks).not.toContain('code_generation');
      expect(nativeTasks).not.toContain('pr_creation');
      expect(nativeTasks).not.toContain('deployment');
    });
  });

  describe('getWorkflowSummary', () => {
    it('should return correct total mappings count', () => {
      const summary = getWorkflowSummary();

      expect(summary.totalMappings).toBe(8);
    });

    it('should return correct native engine count', () => {
      const summary = getWorkflowSummary();

      expect(summary.nativeEngineCount).toBe(1);
    });

    it('should return workflow breakdown', () => {
      const summary = getWorkflowSummary();

      expect(summary.workflowBreakdown).toHaveProperty('codemachine');
      expect(summary.workflowBreakdown).toHaveProperty('pr');
      expect(summary.workflowBreakdown).toHaveProperty('review');
      expect(summary.workflowBreakdown).toHaveProperty('docs');
      expect(summary.workflowBreakdown).toHaveProperty('autofix');
      expect(summary.workflowBreakdown).toHaveProperty('deploy');

      expect(summary.workflowBreakdown['codemachine']).toBe(3);
      expect(summary.workflowBreakdown['pr']).toBe(1);
      expect(summary.workflowBreakdown['review']).toBe(1);
      expect(summary.workflowBreakdown['docs']).toBe(1);
      expect(summary.workflowBreakdown['autofix']).toBe(1);
      expect(summary.workflowBreakdown['deploy']).toBe(1);
    });

    it('should return command breakdown', () => {
      const summary = getWorkflowSummary();

      expect(summary.commandBreakdown).toHaveProperty('start');
      expect(summary.commandBreakdown).toHaveProperty('run');

      expect(summary.commandBreakdown['start']).toBe(3);
      expect(summary.commandBreakdown['run']).toBe(5);
    });
  });

  describe('Native Engine Routing', () => {
    it('should route testing tasks to native engine (AutoFixEngine)', () => {
      const mapping = mapTaskToWorkflow('testing');

      expect(mapping.useNativeEngine).toBe(true);
      expect(mapping.workflow).toBe('autofix');
    });

    it('should not route non-testing tasks to native engine', () => {
      const nonTestingTypes: ExecutionTaskType[] = [
        'code_generation',
        'refactoring',
        'pr_creation',
        'review',
        'documentation',
        'deployment',
        'other',
      ];

      for (const taskType of nonTestingTypes) {
        const mapping = mapTaskToWorkflow(taskType);
        expect(mapping.useNativeEngine).toBe(false);
      }
    });
  });

  describe('Command Semantics', () => {
    it('should use start command for complex multi-step tasks', () => {
      const startTasks: ExecutionTaskType[] = ['code_generation', 'refactoring', 'other'];

      for (const taskType of startTasks) {
        const mapping = mapTaskToWorkflow(taskType);
        expect(mapping.command).toBe('start');
      }
    });

    it('should use run command for atomic one-shot tasks', () => {
      const runTasks: ExecutionTaskType[] = [
        'pr_creation',
        'review',
        'documentation',
        'testing',
        'deployment',
      ];

      for (const taskType of runTasks) {
        const mapping = mapTaskToWorkflow(taskType);
        expect(mapping.command).toBe('run');
      }
    });
  });

  describe('Workflow Mapping Consistency', () => {
    it('should have consistent workflow names across all mappings', () => {
      const validWorkflows = new Set(['codemachine', 'pr', 'review', 'docs', 'autofix', 'deploy']);

      for (const taskType of ALL_TASK_TYPES) {
        const mapping = mapTaskToWorkflow(taskType);
        expect(validWorkflows.has(mapping.workflow)).toBe(true);
      }
    });

    it('should have consistent command types across all mappings', () => {
      const validCommands = new Set(['start', 'run', 'step']);

      for (const taskType of ALL_TASK_TYPES) {
        const mapping = mapTaskToWorkflow(taskType);
        expect(validCommands.has(mapping.command)).toBe(true);
      }
    });
  });
});
