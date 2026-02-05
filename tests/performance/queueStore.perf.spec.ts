/**
 * Queue Store V2 Performance Tests
 *
 * Implements Layer 8 of Issue #45: Performance validation for O(1) queue operations.
 *
 * Performance Targets:
 * - Queue updates: O(1) append time (constant regardless of queue size)
 * - 1000 tasks latency: <100ms total operations
 * - Linear scaling: N vs 2N should scale linearly, not quadratically
 *
 * Run benchmarks:
 *   npm test -- --run tests/performance/queueStore.perf.spec.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  initializeQueueFromPlan,
  loadQueue,
  updateTaskInQueue,
  getNextTask,
  invalidateV2Cache,
} from '../../src/workflows/queueStore.js';
import { createRunDirectory } from '../../src/persistence/runDirectoryManager.js';
import type { TaskPlan } from '../../src/workflows/queueStore.js';

// ============================================================================
// Performance Thresholds
// ============================================================================

const COLD_LOAD_MAX_MS = 1000;
const WARM_LOAD_MAX_MS = 10;
const UPDATE_MAX_MS = 100;
const GET_NEXT_TASK_MAX_MS = 50;
const JITTER_ALLOWANCE_FACTOR = 5;
const JITTER_ALLOWANCE_MS = 50;
const SCALING_TOLERANCE_FACTOR = 3;

// ============================================================================
// Test Fixtures
// ============================================================================

// Create a task plan with N tasks
function createPlan(taskCount: number): TaskPlan {
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    id: `task-${i.toString().padStart(5, '0')}`,
    title: `Task ${i}`,
    task_type: 'code_generation',
    dependency_ids: i > 0 ? [`task-${(i - 1).toString().padStart(5, '0')}`] : [],
  }));

  return {
    feature_id: `PERF-BENCH-${taskCount}`,
    tasks,
  };
}

// Setup benchmark environment
async function setupBenchmark(taskCount: number): Promise<{ runDir: string; tempDir: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `queue-perf-${taskCount}-`));
  const runDir = await createRunDirectory(tempDir, `PERF-${taskCount}`, {
    title: `Performance Test ${taskCount} tasks`,
    repo: {
      url: 'https://github.com/test/perf',
      default_branch: 'main',
    },
  });

  const plan = createPlan(taskCount);
  await initializeQueueFromPlan(runDir, plan);

  return { runDir, tempDir };
}

async function teardownBenchmark(runDir: string, tempDir: string): Promise<void> {
  invalidateV2Cache(runDir);
  await fs.rm(tempDir, { recursive: true, force: true });
}

// Measure execution time
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

// ============================================================================
// Performance Tests (Sequential to avoid lock contention)
// ============================================================================

describe('Queue V2 Performance', () => {
  let runDir: string;
  let tempDir: string;

  beforeEach(async () => {
    const setup = await setupBenchmark(500);
    runDir = setup.runDir;
    tempDir = setup.tempDir;
  }, 30000);

  afterEach(async () => {
    await teardownBenchmark(runDir, tempDir);
  });

  describe('Load Performance', () => {
    it('should load 500 tasks quickly (cold start)', async () => {
      invalidateV2Cache(runDir);
      const { result: tasks, durationMs } = await measureTime(() => loadQueue(runDir));

      console.log(`Cold load (500 tasks): ${durationMs.toFixed(2)}ms`);

      expect(tasks.size).toBe(500);
      // Cold load should complete in reasonable time (with I/O and migration)
      expect(durationMs).toBeLessThan(COLD_LOAD_MAX_MS);
    });

    it('should load 500 tasks very quickly (warm cache)', async () => {
      // Ensure cache is warm
      await loadQueue(runDir);

      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const { durationMs } = await measureTime(() => loadQueue(runDir));
        times.push(durationMs);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Warm load (500 tasks): ${avgTime.toFixed(2)}ms avg`);

      // Warm loads should be <5ms (cached)
      expect(avgTime).toBeLessThan(WARM_LOAD_MAX_MS);
    });
  });

  describe('Update Performance', () => {
    it('should update tasks with O(1) performance', async () => {
      const updateTimes: number[] = [];

      // Perform 10 sequential updates
      for (let i = 0; i < 10; i++) {
        const { durationMs } = await measureTime(() =>
          updateTaskInQueue(runDir, `task-${(i * 50).toString().padStart(5, '0')}`, {
            status: i % 2 === 0 ? 'running' : 'completed',
          })
        );
        updateTimes.push(durationMs);
      }

      const avgUpdate = updateTimes.reduce((a, b) => a + b, 0) / updateTimes.length;
      const maxUpdate = Math.max(...updateTimes);

      console.log(
        `Update times (10 ops): avg=${avgUpdate.toFixed(2)}ms, max=${maxUpdate.toFixed(2)}ms`
      );

      // Average update should be <100ms (including I/O)
      expect(avgUpdate).toBeLessThan(UPDATE_MAX_MS);
    });

    it('should have consistent update times regardless of position', async () => {
      // Update at beginning
      const { durationMs: beginTime } = await measureTime(() =>
        updateTaskInQueue(runDir, 'task-00000', { status: 'running' })
      );

      // Update at middle
      const { durationMs: middleTime } = await measureTime(() =>
        updateTaskInQueue(runDir, 'task-00250', { status: 'running' })
      );

      // Update at end
      const { durationMs: endTime } = await measureTime(() =>
        updateTaskInQueue(runDir, 'task-00499', { status: 'running' })
      );

      console.log(
        `Update position times: begin=${beginTime.toFixed(2)}ms, middle=${middleTime.toFixed(2)}ms, end=${endTime.toFixed(2)}ms`
      );

      // All positions should have similar times (O(1) access)
      // Allow 5x variance for filesystem jitter
      const times = [beginTime, middleTime, endTime];
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      expect(maxTime).toBeLessThan(minTime * JITTER_ALLOWANCE_FACTOR + JITTER_ALLOWANCE_MS);
    });
  });

  describe('getNextTask Performance', () => {
    it('should get next task quickly', async () => {
      const times: number[] = [];

      for (let i = 0; i < 5; i++) {
        const { durationMs } = await measureTime(() => getNextTask(runDir));
        times.push(durationMs);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`getNextTask (500 tasks): ${avgTime.toFixed(2)}ms avg`);

      // Should be <50ms
      expect(avgTime).toBeLessThan(GET_NEXT_TASK_MAX_MS);
    });
  });
});

describe('Queue V2 Scaling', () => {
  it('should scale linearly with queue size', async () => {
    // Test with small queue
    const small = await setupBenchmark(100);
    let avgSmall: number;
    try {
      // Measure 5 updates on small queue
      let smallTime = 0;
      for (let i = 0; i < 5; i++) {
        const { durationMs } = await measureTime(() =>
          updateTaskInQueue(small.runDir, `task-${(i * 20).toString().padStart(5, '0')}`, {
            status: 'running',
          })
        );
        smallTime += durationMs;
      }
      avgSmall = smallTime / 5;
    } finally {
      await teardownBenchmark(small.runDir, small.tempDir);
    }

    // Test with larger queue
    const large = await setupBenchmark(500);
    let avgLarge: number;
    try {
      // Measure 5 updates on larger queue
      let largeTime = 0;
      for (let i = 0; i < 5; i++) {
        const { durationMs } = await measureTime(() =>
          updateTaskInQueue(large.runDir, `task-${(i * 100).toString().padStart(5, '0')}`, {
            status: 'running',
          })
        );
        largeTime += durationMs;
      }
      avgLarge = largeTime / 5;
    } finally {
      await teardownBenchmark(large.runDir, large.tempDir);
    }

    console.log(
      `Scaling test: 100 tasks=${avgSmall.toFixed(2)}ms, 500 tasks=${avgLarge.toFixed(2)}ms`
    );

    // 5x more tasks should NOT result in 25x more time (O(n²))
    // O(1) means it should be similar; allow 3x for variance
    expect(avgLarge).toBeLessThan(avgSmall * SCALING_TOLERANCE_FACTOR + JITTER_ALLOWANCE_MS);
  }, 60000);
});
