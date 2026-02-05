import { describe, it, expect } from 'vitest';
import {
  createPlanArtifact,
  parsePlanArtifact,
  serializePlanArtifact,
  validateDAG,
  getEntryTasks,
  getDependentTasks,
  type TaskNode,
  type PlanArtifact,
} from '../../../src/core/models/PlanArtifact';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id: string, deps: string[] = [], title?: string): TaskNode {
  return {
    task_id: id,
    title: title ?? `Task ${id}`,
    task_type: 'code_generation',
    dependencies: deps.map((d) => ({ task_id: d, type: 'required' as const })),
  };
}

/** Build a minimal valid PlanArtifact object for use with validate / query helpers. */
function makePlan(tasks: TaskNode[]): PlanArtifact {
  return createPlanArtifact('feat-1', tasks);
}

// ---------------------------------------------------------------------------
// createPlanArtifact
// ---------------------------------------------------------------------------

describe('createPlanArtifact', () => {
  it('creates a plan with basic tasks', () => {
    const tasks: TaskNode[] = [makeTask('a'), makeTask('b', ['a'])];
    const plan = createPlanArtifact('feat-42', tasks);

    expect(plan.feature_id).toBe('feat-42');
    expect(plan.schema_version).toBe('1.0.0');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.created_at).toBe(plan.updated_at);
    expect(plan.dag_metadata.generated_at).toBeDefined();
  });

  it('auto-calculates total_tasks from the tasks array length', () => {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')];
    const plan = createPlanArtifact('feat-x', tasks);

    expect(plan.dag_metadata.total_tasks).toBe(3);
  });

  it('passes optional generatedBy and metadata through', () => {
    const plan = createPlanArtifact('feat-y', [makeTask('a')], {
      generatedBy: 'test-agent',
      metadata: { priority: 'high' },
    });

    expect(plan.dag_metadata.generated_by).toBe('test-agent');
    expect(plan.metadata).toEqual({ priority: 'high' });
  });
});

// ---------------------------------------------------------------------------
// parsePlanArtifact
// ---------------------------------------------------------------------------

describe('parsePlanArtifact', () => {
  it('parses a valid PlanArtifact JSON object', () => {
    const plan = createPlanArtifact('feat-1', [makeTask('a')]);
    const result = parsePlanArtifact(plan);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feature_id).toBe('feat-1');
      expect(result.data.tasks).toHaveLength(1);
    }
  });

  it('returns errors for completely invalid input', () => {
    const result = parsePlanArtifact({ bad: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty('path');
      expect(result.errors[0]).toHaveProperty('message');
    }
  });

  it('returns errors when required fields are missing', () => {
    const result = parsePlanArtifact({
      schema_version: '1.0.0',
      // feature_id missing, tasks missing, etc.
    });

    expect(result.success).toBe(false);
  });

  it('rejects extra unknown fields due to strict schema', () => {
    const plan = createPlanArtifact('feat-1', [makeTask('a')]);
    const withExtra = { ...plan, unknown_field: 'nope' };
    const result = parsePlanArtifact(withExtra);

    expect(result.success).toBe(false);
  });

  it('rejects invalid schema_version format', () => {
    const plan = createPlanArtifact('feat-1', [makeTask('a')]);
    const bad = { ...plan, schema_version: 'v1' };
    // Need to remove readonly for test mutation
    const result = parsePlanArtifact(bad);

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// serializePlanArtifact
// ---------------------------------------------------------------------------

describe('serializePlanArtifact', () => {
  it('round-trips through serialize then parse', () => {
    const original = createPlanArtifact('feat-rt', [
      makeTask('step1'),
      makeTask('step2', ['step1']),
    ]);

    const json = serializePlanArtifact(original);
    const parsed = parsePlanArtifact(JSON.parse(json));

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.feature_id).toBe('feat-rt');
      expect(parsed.data.tasks).toHaveLength(2);
      expect(parsed.data.dag_metadata.total_tasks).toBe(2);
    }
  });

  it('produces pretty output by default', () => {
    const plan = createPlanArtifact('f', [makeTask('a')]);
    const pretty = serializePlanArtifact(plan);

    expect(pretty).toContain('\n');
  });

  it('produces compact output when pretty is false', () => {
    const plan = createPlanArtifact('f', [makeTask('a')]);
    const compact = serializePlanArtifact(plan, false);

    expect(compact).not.toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// validateDAG
// ---------------------------------------------------------------------------

describe('validateDAG', () => {
  it('returns valid for a correct DAG', () => {
    const plan = makePlan([
      makeTask('a'),
      makeTask('b', ['a']),
      makeTask('c', ['a']),
      makeTask('d', ['b', 'c']),
    ]);

    const result = validateDAG(plan);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects cycles', () => {
    const plan = makePlan([makeTask('a', ['c']), makeTask('b', ['a']), makeTask('c', ['b'])]);

    const result = validateDAG(plan);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /[Cc]ycle/.test(e))).toBe(true);
  });

  it('detects duplicate task IDs', () => {
    const plan = makePlan([makeTask('dup'), makeTask('dup')]);

    const result = validateDAG(plan);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /[Dd]uplicate/.test(e))).toBe(true);
  });

  it('detects invalid dependency references', () => {
    const plan = makePlan([makeTask('a', ['nonexistent'])]);

    const result = validateDAG(plan);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /non-existent/.test(e) || /nonexistent/.test(e))).toBe(true);
  });

  it('returns valid for a plan with no tasks', () => {
    const plan = makePlan([]);
    const result = validateDAG(plan);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getEntryTasks
// ---------------------------------------------------------------------------

describe('getEntryTasks', () => {
  it('returns tasks with no dependencies', () => {
    const plan = makePlan([
      makeTask('root1'),
      makeTask('root2'),
      makeTask('child', ['root1', 'root2']),
    ]);

    const entries = getEntryTasks(plan);

    expect(entries).toContain('root1');
    expect(entries).toContain('root2');
    expect(entries).not.toContain('child');
  });

  it('returns empty array when all tasks have dependencies', () => {
    const plan = makePlan([makeTask('a', ['b']), makeTask('b', ['a'])]);

    const entries = getEntryTasks(plan);

    expect(entries).toEqual([]);
  });

  it('returns all task IDs when none have dependencies', () => {
    const plan = makePlan([makeTask('x'), makeTask('y'), makeTask('z')]);

    const entries = getEntryTasks(plan);

    expect(entries).toEqual(['x', 'y', 'z']);
  });
});

// ---------------------------------------------------------------------------
// getDependentTasks
// ---------------------------------------------------------------------------

describe('getDependentTasks', () => {
  it('returns direct dependents of a task', () => {
    const plan = makePlan([
      makeTask('a'),
      makeTask('b', ['a']),
      makeTask('c', ['a']),
      makeTask('d', ['b']),
    ]);

    const dependents = getDependentTasks(plan, 'a');

    expect(dependents).toContain('b');
    expect(dependents).toContain('c');
    // 'd' depends on 'b', not directly on 'a'
    expect(dependents).not.toContain('d');
  });

  it('returns empty array when no tasks depend on the given task', () => {
    const plan = makePlan([makeTask('a'), makeTask('b', ['a'])]);

    const dependents = getDependentTasks(plan, 'b');

    expect(dependents).toEqual([]);
  });

  it('returns empty array for a non-existent task ID', () => {
    const plan = makePlan([makeTask('a')]);
    const dependents = getDependentTasks(plan, 'ghost');

    expect(dependents).toEqual([]);
  });
});
