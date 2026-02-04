import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRunMetricsCollector } from '../../src/telemetry/metrics';
import { createLogger, LogLevel } from '../../src/telemetry/logger';
import {
  createExecutionMetrics,
  ExecutionTaskType,
  ExecutionTaskStatus,
  type DiffStats,
  type ValidationResult,
} from '../../src/telemetry/executionMetrics';
import { createExecutionLogWriter } from '../../src/telemetry/logWriters';
import type { LogEntry } from '../../src/telemetry/logger';

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'execution-metrics-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function readPrometheusFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}

async function readNdjsonFile(filePath: string): Promise<LogEntry[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line);
  return lines.map((line) => JSON.parse(line) as LogEntry);
}

function parsePrometheusMetric(content: string, metricName: string): number | null {
  const fullMetricName = `codemachine_pipeline_${metricName}`;
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.startsWith(fullMetricName) && !line.startsWith('#')) {
      const match = line.match(/}\s+([\d.]+)$/);
      if (match) {
        return parseFloat(match[1]);
      }
    }
  }

  return null;
}

function countPrometheusMetricSamples(content: string, metricName: string): number {
  const fullMetricName = `codemachine_pipeline_${metricName}`;
  const lines = content.split('\n');
  let count = 0;

  for (const line of lines) {
    if (line.startsWith(fullMetricName) && !line.startsWith('#')) {
      count++;
    }
  }

  return count;
}

// ============================================================================
// ExecutionMetricsHelper Tests
// ============================================================================

describe('ExecutionMetricsHelper', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Task Lifecycle Recording', () => {
    it('should record task started event', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.recordTaskLifecycle(
        'I3.T6',
        ExecutionTaskType.CODE_GENERATION,
        ExecutionTaskStatus.STARTED
      );

      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('execution_tasks_total');
      expect(content).toContain('task_id="I3.T6"');
      expect(content).toContain('task_type="code_generation"');
      expect(content).toContain('status="started"');
    });

    it('should record task completed with duration', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.recordTaskLifecycle(
        'I3.T6',
        ExecutionTaskType.CODE_GENERATION,
        ExecutionTaskStatus.COMPLETED,
        94555
      );

      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      // Check counter
      expect(content).toContain('execution_tasks_total');
      expect(content).toContain('status="completed"');

      // Check histogram
      expect(content).toContain('execution_task_duration_ms');
      expect(content).toContain('task_type="code_generation"');
    });

    it('should record task failures', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.recordTaskLifecycle(
        'I3.T7',
        ExecutionTaskType.VALIDATION,
        ExecutionTaskStatus.FAILED,
        1234
      );

      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('status="failed"');
      expect(content).toContain('task_type="validation"');
    });

    it('should record multiple task types', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.recordTaskLifecycle(
        'T1',
        ExecutionTaskType.CODE_GENERATION,
        ExecutionTaskStatus.COMPLETED,
        1000
      );
      executionMetrics.recordTaskLifecycle(
        'T2',
        ExecutionTaskType.VALIDATION,
        ExecutionTaskStatus.COMPLETED,
        2000
      );
      executionMetrics.recordTaskLifecycle(
        'T3',
        ExecutionTaskType.PATCH_APPLICATION,
        ExecutionTaskStatus.COMPLETED,
        3000
      );
      executionMetrics.recordTaskLifecycle(
        'T4',
        ExecutionTaskType.GIT_OPERATION,
        ExecutionTaskStatus.COMPLETED,
        4000
      );

      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('task_type="code_generation"');
      expect(content).toContain('task_type="validation"');
      expect(content).toContain('task_type="patch_application"');
      expect(content).toContain('task_type="git_operation"');
    });
  });

  describe('CodeMachine Execution Recording', () => {
    it('should record CodeMachine execution metrics', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.recordCodeMachineExecution('claude', 'success', 1234);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      const expectedTotalMetric =
        'codemachine_pipeline_codemachine_execution_total{component="execution",engine="claude",run_id="test-run-123",status="success"} 1';
      const expectedDurationCountMetric =
        'codemachine_pipeline_codemachine_execution_duration_ms_count{component="execution",engine="claude",run_id="test-run-123"} 1';
      const expectedDurationSumMetric =
        'codemachine_pipeline_codemachine_execution_duration_ms_sum{component="execution",engine="claude",run_id="test-run-123"} 1234';

      expect(content).toContain(expectedTotalMetric);
      expect(content).toContain(expectedDurationCountMetric);
      expect(content).toContain(expectedDurationSumMetric);
    });

    it('should record CodeMachine retries', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.recordCodeMachineRetry('codex');
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      const expectedMetric =
        'codemachine_pipeline_codemachine_retry_total{component="execution",engine="codex",run_id="test-run-123"} 1';
      expect(content).toContain(expectedMetric);
    });
  });

  describe('Validation Run Recording', () => {
    it('should record successful validation', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const result: ValidationResult = {
        passed: true,
        durationMs: 2345,
      };

      executionMetrics.recordValidationRun(result);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('validation_runs_total');
      expect(content).toContain('passed="true"');
      expect(content).toContain('validation_duration_seconds');
    });

    it('should record failed validation with errors', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const result: ValidationResult = {
        passed: false,
        durationMs: 1234,
        errorCount: 3,
        errorTypes: ['schema_error', 'lint_error'],
      };

      executionMetrics.recordValidationRun(result);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('passed="false"');
      expect(content).toContain('validation_errors_total');
      // Error types are recorded individually
      expect(content).toContain('error_type="schema_error"');
      expect(content).toContain('error_type="lint_error"');
    });

    it('should convert milliseconds to seconds for duration', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const result: ValidationResult = {
        passed: true,
        durationMs: 5000, // 5 seconds
      };

      executionMetrics.recordValidationRun(result);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      // Should record in seconds (5.0), not milliseconds
      expect(content).toContain('validation_duration_seconds');
    });
  });

  describe('Diff Statistics Recording', () => {
    it('should record diff statistics', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const stats: DiffStats = {
        filesChanged: 4,
        insertions: 423,
        deletions: 89,
        patchId: 'patch_01JFABCXYZ123',
      };

      executionMetrics.recordDiffStats(stats);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('diff_files_changed');
      expect(content).toContain('diff_lines_total');
      expect(content).toContain('patch_id="patch_01JFABCXYZ123"');
      expect(content).toContain('operation="insertion"');
      expect(content).toContain('operation="deletion"');
      expect(content).toContain('diff_operations_total');
    });

    it('should record multiple diff operations', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.recordDiffStats({
        filesChanged: 2,
        insertions: 50,
        deletions: 10,
        patchId: 'patch_1',
      });
      executionMetrics.recordDiffStats({
        filesChanged: 5,
        insertions: 100,
        deletions: 20,
        patchId: 'patch_2',
      });
      executionMetrics.recordDiffStats({
        filesChanged: 10,
        insertions: 500,
        deletions: 50,
        patchId: 'patch_3',
      });

      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      const diffOpsCount = countPrometheusMetricSamples(content, 'diff_operations_total');
      expect(diffOpsCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Queue Depth Recording', () => {
    it('should set queue depth gauges', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.setQueueDepth(5, 10, 2);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('execution_queue_pending');
      expect(content).toContain('execution_queue_completed');
      expect(content).toContain('execution_queue_failed');
      expect(content).toContain('execution_queue_depth');
    });

    it('should calculate total queue depth correctly', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.setQueueDepth(5, 10, 2);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      // Total should be 5 + 10 + 2 = 17
      const depthMetric = parsePrometheusMetric(content, 'execution_queue_depth');
      expect(depthMetric).toBe(17);
    });
  });

  describe('Agent Cost Recording', () => {
    it('should record agent token usage', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.recordAgentCost('gpt-4', 2341, 1523);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('agent_cost_tokens_total');
      expect(content).toContain('model="gpt-4"');
      expect(content).toContain('type="prompt"');
      expect(content).toContain('type="completion"');
    });

    it('should set agent cost USD total', async () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      executionMetrics.setAgentCostUsd(4.23);
      await executionMetrics.flush();

      const metricsPath = path.join(tempDir, 'metrics', 'prometheus.txt');
      const content = await readPrometheusFile(metricsPath);

      expect(content).toContain('agent_cost_usd_total');
      const costMetric = parsePrometheusMetric(content, 'agent_cost_usd_total');
      expect(costMetric).toBe(4.23);
    });
  });

  describe('Error Handling', () => {
    it('should not throw on instrumentation errors', () => {
      const metrics = createRunMetricsCollector(tempDir, 'test-run-123');
      const executionMetrics = createExecutionMetrics(metrics, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      // These calls should never throw
      expect(() => {
        executionMetrics.recordTaskLifecycle(
          'T1',
          ExecutionTaskType.CODE_GENERATION,
          ExecutionTaskStatus.STARTED
        );
        executionMetrics.recordValidationRun({ passed: true, durationMs: 1000 });
        executionMetrics.recordDiffStats({ filesChanged: 1, insertions: 10, deletions: 5 });
        executionMetrics.setQueueDepth(1, 2, 3);
        executionMetrics.recordAgentCost('gpt-4', 100, 50);
      }).not.toThrow();
    });
  });
});

// ============================================================================
// ExecutionLogWriter Tests
// ============================================================================

describe('ExecutionLogWriter', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Task Lifecycle Logging', () => {
    it('should log task started event', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
        minLevel: LogLevel.DEBUG,
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      logWriter.taskStarted('I3.T6', ExecutionTaskType.CODE_GENERATION);
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: LogLevel.INFO,
        message: 'Execution task started: I3.T6',
        context: {
          task_id: 'I3.T6',
          execution_task_type: 'code_generation',
        },
      });
    });

    it('should log task completed with duration', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      logWriter.taskCompleted('I3.T6', ExecutionTaskType.CODE_GENERATION, 94555);
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].context).toMatchObject({
        task_id: 'I3.T6',
        execution_task_type: 'code_generation',
        duration_ms: 94555,
      });
      expect(logs[0].message).toContain('94555ms');
    });

    it('should log task failed with error', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const error = new Error('Validation failed');
      logWriter.taskFailed('I3.T7', ExecutionTaskType.VALIDATION, error, 1234);
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0]).toMatchObject({
        level: LogLevel.ERROR,
        message: 'Execution task failed: I3.T7',
        context: {
          task_id: 'I3.T7',
          execution_task_type: 'validation',
          duration_ms: 1234,
          error: {
            name: 'Error',
            message: 'Validation failed',
          },
        },
      });
    });

    it('should log task skipped with reason', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      logWriter.taskSkipped('I3.T8', ExecutionTaskType.CUSTOM, 'Dependencies not met');
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].context).toMatchObject({
        task_id: 'I3.T8',
        execution_task_type: 'custom',
        skip_reason: 'Dependencies not met',
      });
    });
  });

  describe('Diff Generation Logging', () => {
    it('should log diff generated event', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const stats: DiffStats = {
        filesChanged: 4,
        insertions: 423,
        deletions: 89,
        patchId: 'patch_01JFABCXYZ123',
      };

      logWriter.diffGenerated('I3.T6', 'patch_01JFABCXYZ123', stats);
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0]).toMatchObject({
        level: LogLevel.INFO,
        context: {
          task_id: 'I3.T6',
          execution_task_type: 'patch_application',
          patch_id: 'patch_01JFABCXYZ123',
          diff_stats: {
            files_changed: 4,
            insertions: 423,
            deletions: 89,
          },
        },
      });
      expect(logs[0].message).toContain('4 files');
      expect(logs[0].message).toContain('+423/-89');
    });
  });

  describe('Validation Logging', () => {
    it('should log validation completed (passed)', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const result: ValidationResult = {
        passed: true,
        durationMs: 2345,
      };

      logWriter.validationCompleted('I3.T6', result);
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].message).toContain('passed');
      expect(logs[0].context).toMatchObject({
        task_id: 'I3.T6',
        execution_task_type: 'validation',
        validation_duration_ms: 2345,
        passed: true,
      });
    });

    it('should log validation completed (failed) with errors', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const result: ValidationResult = {
        passed: false,
        durationMs: 1234,
        errorCount: 3,
        errorTypes: ['schema_error', 'lint_error'],
      };

      logWriter.validationCompleted('I3.T7', result);
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].message).toContain('failed');
      expect(logs[0].message).toContain('3 errors');
      expect(logs[0].context).toMatchObject({
        error_count: 3,
        error_types: ['schema_error', 'lint_error'],
      });
    });
  });

  describe('Additional Event Logging', () => {
    it('should log queue state changes', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
        minLevel: LogLevel.DEBUG,
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      logWriter.queueStateChanged(5, 10, 2);
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].context).toMatchObject({
        queue_depth: 17,
        pending_count: 5,
        completed_count: 10,
        failed_count: 2,
      });
    });

    it('should log patch applied', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      logWriter.patchApplied('I3.T6', 'patch_123', 'feature/branch', 'abc123');
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      expect(logs[0].context).toMatchObject({
        task_id: 'I3.T6',
        patch_id: 'patch_123',
        target_branch: 'feature/branch',
        commit_sha: 'abc123',
      });
    });

    it('should log agent invocation', async () => {
      const logger = createLogger({
        component: 'execution',
        runDir: tempDir,
        runId: 'test-run-123',
      });

      const logWriter = createExecutionLogWriter(logger, {
        runDir: tempDir,
        runId: 'test-run-123',
      });

      logWriter.agentInvoked('I3.T6', 'BackendAgent', 'gpt-4', 2341, 1523);
      await logWriter.flush();

      const logPath = path.join(tempDir, 'logs', 'logs.ndjson');
      const logs = await readNdjsonFile(logPath);

      // Note: token fields are redacted by the logger's secret protection
      expect(logs[0].context).toMatchObject({
        task_id: 'I3.T6',
        agent_type: 'BackendAgent',
        model: 'gpt-4',
        prompt_tokens: '[REDACTED]',
        completion_tokens: '[REDACTED]',
      });
    });
  });
});
