/**
 * The deterministic developers demo corpus (Work Order C017): REAL
 * developer-platform + escalation-api services on the local-parity
 * fabric, a fixed clock and sequential secret material — one demo
 * client app, live + sandbox keys, one sandbox run, one live
 * escalation, webhook registration. Visibly labelled demo state; demo
 * state is never customer state (the truth-label law).
 */

import { DeveloperPlatformService } from '../../../../services/developer-platform/src/index.js';
import { InMemoryDeveloperKeyStore } from '../../../../services/developer-platform/src/index.js';
import type { ObservabilityDashboard } from '../../../../services/developer-platform/src/index.js';
import { EscalationApiService } from '../../../../services/escalation-api/src/index.js';
import { FixedClock } from '../../../../services/escalation-api/src/index.js';
import { REFERENCE_EXPERTS } from '../../../../services/escalation-api/src/index.js';
import type { ClientEscalationProjection } from '../../../../packages/developer-platform/src/index.js';
import type { ClientAppRecord } from '../../../../packages/developer-platform/src/index.js';
import { createNodeSecretHasher } from '../../../../packages/developer-platform/src/index.js';

import { DEMO_TENANT_ID } from './runtime-labels.js';

/** Deterministic sequential secret material (DEMO ONLY — never production).
 * The call counter occupies the LEADING 8 hex chars so every derived id
 * (client apps use the first 8 chars, keys the first 32) is distinct. */
export class DemoSequentialMaterial {
  private counter = 0;
  bytes32Hex(): string {
    this.counter += 1;
    const prefix = this.counter.toString(16).padStart(8, '0');
    return `${prefix}${'0'.repeat(56)}`;
  }
}

/** One keys-page row (a wire projection + presentation hints; NEVER a secret). */
export interface DemoKeyRow {
  readonly keyId: string;
  readonly label: string;
  readonly environment: 'live' | 'sandbox';
  readonly scopes: readonly string[];
  readonly status: string;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
  readonly rotatedTo?: string;
}

/** The demo corpus assembled through the REAL service surfaces. */
export interface DemoDevelopersCorpus {
  readonly app: ClientAppRecord;
  readonly sandboxApp: ClientAppRecord;
  readonly keys: readonly DemoKeyRow[];
  /** The shown-once issuance moment the keys page replays (demo-labelled). */
  readonly issuance: {
    readonly keyId: string;
    readonly label: string;
    readonly environment: 'sandbox' | 'live';
    readonly scopes: readonly string[];
    readonly secret: string;
  };
  readonly sandboxRun: {
    readonly scenarioId: string;
    readonly requestId: string;
    readonly state: string;
    readonly events: readonly { readonly eventId: string; readonly eventType: string }[];
  };
  readonly liveEscalation: {
    readonly requestId: string;
    readonly state: string;
  };
  readonly dashboard: ObservabilityDashboard;
  readonly sandboxDashboard: ObservabilityDashboard;
  readonly projection: ClientEscalationProjection;
}

const DEMO_NOW = Date.parse('2026-10-07T12:00:00.000Z');

/** Build the deterministic demo corpus (pure factories; byte-stable across calls). */
export async function buildDemoDevelopersCorpus(): Promise<DemoDevelopersCorpus> {
  const clock = new FixedClock(DEMO_NOW);
  const escalation = new EscalationApiService({
    clock,
    directory: { listQualifiedExperts: async () => REFERENCE_EXPERTS },
  });
  const service = new DeveloperPlatformService({
    clock,
    store: new InMemoryDeveloperKeyStore(),
    escalation: {
      createEscalation: (input) => escalation.createEscalation(input as never),
      getEscalationStatus: (params) => escalation.getEscalationStatus(params),
      listRecentEscalations: async (tenantId: string) =>
        (await escalation.store.list()).filter((record) => record.request.tenantId === tenantId),
      listRecentWebhookEvents: async (tenantId: string) => {
        const views: {
          eventId: string;
          eventType: string;
          requestId: string;
          tenantId: string;
          sequence: number;
          createdAt: number;
        }[] = [];
        for (const delivery of await escalation.outbox.listAll()) {
          if (delivery.tenantId !== tenantId) continue;
          let eventType = 'escalation.progressed';
          try {
            const parsed = JSON.parse(delivery.payload) as { eventType?: unknown };
            if (typeof parsed.eventType === 'string') eventType = parsed.eventType;
          } catch {
            /* conservative default projection */
          }
          views.push({
            eventId: delivery.eventId,
            eventType,
            requestId: delivery.requestId,
            tenantId: delivery.tenantId,
            sequence: delivery.sequence,
            createdAt: delivery.createdAt,
          });
        }
        return views;
      },
    },
    hasher: createNodeSecretHasher(),
    material: new DemoSequentialMaterial(),
  });

  const app = await service.registerClientApp({
    tenantId: DEMO_TENANT_ID,
    displayName: 'Epoch (demo) — AI build planning',
    environment: 'live',
  });
  const sandboxApp = await service.registerClientApp({
    tenantId: DEMO_TENANT_ID,
    displayName: 'Epoch (demo sandbox)',
    environment: 'sandbox',
  });

  const liveKey = await service.issueKey({
    tenantId: DEMO_TENANT_ID,
    clientAppId: app.clientAppId,
    environment: 'live',
    scopes: ['escalations:create', 'escalations:read', 'observability:read'],
    label: 'epoch demo production key',
  });
  const sandboxKey = await service.issueKey({
    tenantId: DEMO_TENANT_ID,
    clientAppId: sandboxApp.clientAppId,
    environment: 'sandbox',
    scopes: ['sandbox:run', 'escalations:read', 'observability:read'],
    label: 'epoch demo sandbox key',
  });

  const sandboxRun = await service.runSandboxEscalation({
    presentedSecret: sandboxKey.secret,
    tenantId: DEMO_TENANT_ID,
    scenarioId: 'boq-quantity-takeoff',
  });

  const live = await service.createLiveEscalation({
    presentedSecret: liveKey.secret,
    tenantId: DEMO_TENANT_ID,
    escalation: {
      clientAppId: app.clientAppId,
      tenantId: DEMO_TENANT_ID,
      sourceWorkflowRef: 'demo-workflow-42',
      sourceRunRef: 'demo-run-2026-10-07-001',
      capabilityNeed: 'boq-estimation.quantity-takeoff',
      escalationModes: ['solve'],
      urgency: 'priority',
      now: DEMO_NOW,
      deadlineInMs: 3_600_000,
      budget: { amountMinorUnits: 25_000, currency: 'USD' },
      expertRequirements: { requiredCapabilities: ['boq-estimation.quantity-takeoff'] },
      locale: 'en',
      desiredOutputSchema: { type: 'object' },
      contextReferences: [],
      environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
      privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
      permittedActions: ['read-context', 'propose-patch'],
      learningPermissions: {
        allowKnowledgeCapture: true,
        allowToolGapSignals: true,
        allowArtifactReuse: false,
        requireApproval: true,
      },
      retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
      idempotencyKey: 'demo-idem-0001',
      correlationId: 'demo-corr-0001',
    } as never,
  });

  const dashboard = await service.observabilityDashboard({
    tenantId: DEMO_TENANT_ID,
    clientAppId: app.clientAppId,
  });
  const sandboxDashboard = await service.observabilityDashboard({
    tenantId: DEMO_TENANT_ID,
    clientAppId: sandboxApp.clientAppId,
  });

  const keyRows = await service.listKeys({
    tenantId: DEMO_TENANT_ID,
    clientAppId: app.clientAppId,
  });

  return Object.freeze({
    app,
    sandboxApp,
    keys: Object.freeze(
      keyRows.map((row) => ({
        keyId: String(row['keyId']),
        label: String(row['label']),
        environment: row['environment'] as 'live' | 'sandbox',
        scopes: row['scopes'] as readonly string[],
        status: String(row['status']),
        createdAt: String(row['createdAt']),
        ...(row['lastUsedAt'] !== undefined ? { lastUsedAt: String(row['lastUsedAt']) } : {}),
      })),
    ),
    issuance: Object.freeze({
      keyId: sandboxKey.record.keyId,
      label: sandboxKey.record.label,
      environment: sandboxKey.record.environment,
      scopes: sandboxKey.record.scopes,
      secret: sandboxKey.secret,
    }),
    sandboxRun: Object.freeze({
      scenarioId: sandboxRun.run.scenarioId,
      requestId: sandboxRun.run.requestId,
      state: sandboxRun.projection.state,
      events: Object.freeze(
        sandboxRun.emittedEvents.map((event) =>
          Object.freeze({ eventId: event.eventId, eventType: event.eventType }),
        ),
      ),
    }),
    liveEscalation: Object.freeze({
      requestId: live.requestId,
      state: live.projection.state,
    }),
    dashboard,
    sandboxDashboard,
    projection: live.projection,
  });
}
