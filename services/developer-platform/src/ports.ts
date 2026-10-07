/**
 * Developer-platform service ports (Work Order C017) — the ONLY things
 * services/developer-platform depends on besides the domain packages
 * (@arena/developer-platform, @arena/escalation, @arena/payments,
 * @arena/protocol-core). Mirrors services/escalation-api's ports.ts
 * discipline:
 *
 *   - Clock              — time is INJECTED (never a wall clock);
 *   - DeveloperKeyStore  — persistence for key records + at-rest secret
 *                          bindings (hash only) + client apps + sandbox runs;
 *   - EscalationPort     — THE C001 SEAM. Structurally satisfied by the
 *                          escalation-api reference service; HOSTS wire it
 *                          (boundary rule B2 — services never import each
 *                          other's internals);
 *   - SandboxCapacityProbe — the free-tier capacity surface (FT2.0:
 *                          EXHAUSTED/DISABLED fail closed, never faked).
 *
 * Authority boundary: this service OWNS key lifecycle orchestration,
 * registration and projections; it NEVER judges escalation outcomes
 * and never mutates canonical escalation records.
 */

import type {
  CreateEscalationRequestInput,
  EscalationRecord,
  EscalationWebhookEvent,
} from '@arena/escalation';
import type {
  ClientAppRecord,
  DeveloperKeyRecord,
  DeveloperKeySecretBinding,
  SandboxRunRecord,
  SandboxCapacityProbe,
} from '@arena/developer-platform';
import type { WebhookSigningBinding } from '@arena/developer-platform';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** Persistence port for the developer-platform records. */
export interface DeveloperKeyStore {
  /** Persist a NEW key record; throws on duplicate key id. */
  insertKey(record: DeveloperKeyRecord): Promise<void>;
  /** Replace the latest snapshot of a key record (append-only history retained inside it). */
  updateKey(record: DeveloperKeyRecord): Promise<void>;
  /** Look up one key record by id (tenant guard applied by the service). */
  findKey(keyId: string): Promise<DeveloperKeyRecord | undefined>;
  /** All keys for one client app (tenant guard applied by the service). */
  listKeysByClientApp(clientAppId: string): Promise<readonly DeveloperKeyRecord[]>;
  /** Persist the at-rest secret binding (hash only). */
  insertKeyBinding(binding: DeveloperKeySecretBinding): Promise<void>;
  /** Resolve the binding for key-based auth (the ONLY hash read path). */
  findKeyBinding(keyId: string): Promise<DeveloperKeySecretBinding | undefined>;
  /** Remove the binding when its key is rotated/revoked (defense in depth). */
  deleteKeyBinding(keyId: string): Promise<void>;
  /** Persist a NEW client app; throws on duplicate client app id. */
  insertClientApp(app: ClientAppRecord): Promise<void>;
  /** Replace the latest client-app snapshot (webhook endpoint list). */
  updateClientApp(app: ClientAppRecord): Promise<void>;
  /** Tenant-scoped client-app lookup. */
  findClientApp(clientAppId: string, tenantId: string): Promise<ClientAppRecord | undefined>;
  /** All client apps of one tenant. */
  listClientApps(tenantId: string): Promise<readonly ClientAppRecord[]>;
  /** Persist a webhook signing binding (hash only). */
  insertWebhookBinding(binding: WebhookSigningBinding): Promise<void>;
  /** Append a sandbox run record. */
  appendSandboxRun(run: SandboxRunRecord): Promise<void>;
  /** Sandbox runs for one client app (tenant guard applied by the service). */
  listSandboxRuns(clientAppId: string): Promise<readonly SandboxRunRecord[]>;
}

/** One webhook delivery projection surfaced to the developer portal. */
export interface WebhookEventView {
  readonly eventId: string;
  readonly eventType: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly createdAt: number;
}

/**
 * THE C001 SEAM. Structurally satisfied by services/escalation-api's
 * EscalationApiService (hosts wire the adapter — boundary rule B2).
 */
export interface EscalationPort {
  /** POST /v1/escalations — durable, idempotent creation. */
  createEscalation(
    input: CreateEscalationRequestInput,
  ): Promise<{
    readonly requestId: string;
    readonly record: EscalationRecord;
    readonly emittedEvents: readonly EscalationWebhookEvent[];
  }>;
  /** GET /v1/escalations/{id} — idempotent tenant-scoped status polling. */
  getEscalationStatus(params: {
    readonly requestId: string;
    readonly tenantId: string;
  }): Promise<{ readonly record: EscalationRecord }>;
  /** Recent escalation records of a tenant (the observability read path). */
  listRecentEscalations(tenantId: string): Promise<readonly EscalationRecord[]>;
  /** Recent webhook deliveries of a tenant (the sandbox console event stream). */
  listRecentWebhookEvents(tenantId: string): Promise<readonly WebhookEventView[]>;
}

export type { SandboxCapacityProbe };
