import { z } from 'zod';

export const RawSnapshotSchema = z.object({
  schemaVersion: z.string().optional(),
  schema_version: z.string().optional(),
  tasks: z.record(z.string(), z.unknown()),
  counts: z.unknown().optional(),
  dependencyGraph: z.record(z.string(), z.array(z.string())).optional(),
  dependency_graph: z.record(z.string(), z.array(z.string())).optional(),
  checksum: z.string().min(1),
  timestamp: z.string().datetime(),
});
