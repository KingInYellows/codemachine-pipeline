import type { ExecutionTask } from '../core/models/ExecutionTask.js';

export interface ExecutionContext {
  runDir: string;
  workspaceDir: string;
  logPath: string;
  timeoutMs: number;
  envAllowlist: string[];
}

export interface ExecutionStrategyResult {
  success: boolean;
  status: 'completed' | 'failed' | 'timeout' | 'killed';
  summary: string;
  errorMessage?: string;
  recoverable: boolean;
  durationMs: number;
  artifacts: string[];
}

export interface ExecutionStrategy {
  readonly name: string;
  canHandle(task: ExecutionTask): boolean;
  execute(task: ExecutionTask, context: ExecutionContext): Promise<ExecutionStrategyResult>;
}
