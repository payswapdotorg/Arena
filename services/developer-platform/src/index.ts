/**
 * The developer-platform service barrel (Work Order C017;
 * services/developer-platform): one import surface, exactly like the
 * sibling reference services. Hosts (apps/web/src/developers) wire the
 * C001 escalation seam (services/escalation-api) onto EscalationPort —
 * boundary rule B2 keeps services from importing each other's
 * internals; the HOST owns the adapter.
 */

export { DeveloperPlatformService } from './service.js';
export type {
  DeveloperPlatformServiceConfig,
  KeyIssuanceResult,
  ObservabilityDashboard,
  SandboxRunResult,
} from './service.js';
export { FixedClock, InMemoryDeveloperKeyStore } from './fabric.js';
export type { Clock, DeveloperKeyStore, EscalationPort, SandboxCapacityProbe, WebhookEventView } from './ports.js';
export { adaptEscalationApiService } from './escalation-adapter.js';
