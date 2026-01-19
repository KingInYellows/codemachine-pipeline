import { z } from 'zod';

/**
 * NotificationEvent Model
 *
 * Optional outbound message log referencing channels, audiences, delivery status, metadata.
 *
 * Implements ADR-7 (Validation Policy): Zod-based validation
 * Used by CLI commands: notify, status
 */

export const NotificationEventSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    event_id: z.string().min(1),
    feature_id: z.string().min(1),
    channel: z.enum(['email', 'slack', 'linear', 'github', 'webhook', 'other']),
    audience: z.array(z.string()).default([]),
    message: z.string().min(1),
    delivery_status: z.enum(['pending', 'sent', 'failed', 'delivered']),
    sent_at: z.string().datetime().nullable().optional(),
    delivered_at: z.string().datetime().nullable().optional(),
    error_message: z.string().optional(),
    created_at: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type NotificationEvent = Readonly<z.infer<typeof NotificationEventSchema>>;

export function parseNotificationEvent(json: unknown) {
  const result = NotificationEventSchema.safeParse(json);
  if (result.success) {
    return { success: true as const, data: result.data as NotificationEvent };
  }
  return {
    success: false as const,
    errors: result.error.issues.map((err) => ({
      path: err.path.join('.') || 'root',
      message: err.message,
    })),
  };
}
