import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * NotificationEvent Model
 *
 * Optional outbound message log referencing channels, audiences, delivery status, metadata.
 *
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

const { parse: parseNotificationEvent, serialize: serializeNotificationEvent } =
  createModelParser<NotificationEvent>(NotificationEventSchema);
export { parseNotificationEvent, serializeNotificationEvent };
