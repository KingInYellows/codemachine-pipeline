/**
 * Integration domain sub-barrel
 *
 * Exports for external integration models: IntegrationCredential, AgentProviderCapability,
 * NotificationEvent.
 * Prefer these granular imports over the main index.ts barrel for better tree-shaking.
 *
 * Usage:
 *   import { IntegrationCredential } from '@/core/models/integration-types';
 */

export {
  IntegrationCredential,
  IntegrationCredentialSchema,
  parseIntegrationCredential,
} from './IntegrationCredential';

export {
  AgentProviderCapability,
  AgentProviderCapabilitySchema,
  parseAgentProviderCapability,
} from './AgentProviderCapability';

export {
  NotificationEvent,
  NotificationEventSchema,
  parseNotificationEvent,
} from './NotificationEvent';
