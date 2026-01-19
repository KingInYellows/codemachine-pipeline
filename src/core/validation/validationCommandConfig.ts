import { z } from 'zod';

/**
 * Validation command types supported by the pipeline.
 */
export const ValidationCommandTypeSchema = z.enum(['lint', 'test', 'typecheck', 'build']);
export type ValidationCommandType = z.infer<typeof ValidationCommandTypeSchema>;

/**
 * Optional template context applied when rendering validation commands.
 */
const TemplateContextSchema = z.record(z.string(), z.string());
export type ValidationTemplateContext = z.infer<typeof TemplateContextSchema>;

/**
 * Validation command configuration schema shared between RepoConfig and the registry.
 */
export const ValidationCommandConfigSchema = z.object({
  type: ValidationCommandTypeSchema,
  command: z.string().min(1),
  cwd: z.string().default('.'),
  env: z.record(z.string(), z.string()).optional(),
  required: z.boolean().default(true),
  timeout_ms: z.number().int().min(1000).max(600000).default(120000),
  max_retries: z.number().int().min(0).max(10).default(3),
  backoff_ms: z.number().int().min(100).max(10000).default(1000),
  supports_auto_fix: z.boolean().default(false),
  auto_fix_command: z.string().optional(),
  description: z.string().optional(),
  template_context: TemplateContextSchema.optional(),
});

export type ValidationCommandConfig = z.infer<typeof ValidationCommandConfigSchema>;

/**
 * Default validation command definitions used when RepoConfig does not override them.
 */
export const DEFAULT_VALIDATION_COMMANDS: ValidationCommandConfig[] = [
  {
    type: 'lint',
    command: 'npm run lint',
    description: 'Run ESLint code quality checks',
    required: true,
    supports_auto_fix: true,
    auto_fix_command: 'npm run lint:fix',
    timeout_ms: 60000,
    max_retries: 2,
    backoff_ms: 500,
    cwd: '.',
  },
  {
    type: 'typecheck',
    command: 'npm run typecheck',
    description: 'Run TypeScript type checking',
    required: true,
    supports_auto_fix: false,
    timeout_ms: 120000,
    max_retries: 1,
    backoff_ms: 1000,
    cwd: '.',
  },
  {
    type: 'test',
    command: 'npm run test',
    description: 'Run automated test suite',
    required: true,
    supports_auto_fix: false,
    timeout_ms: 180000,
    max_retries: 2,
    backoff_ms: 2000,
    cwd: '.',
  },
  {
    type: 'build',
    command: 'npm run build',
    description: 'Create production-ready build artifacts',
    required: true,
    supports_auto_fix: false,
    timeout_ms: 180000,
    max_retries: 1,
    backoff_ms: 1000,
    cwd: '.',
  },
];
