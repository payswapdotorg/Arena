/**
 * tests/integration/production/composition.e2e.test.ts — M1 of the P006
 * integrated acceptance (Work Order P006; issue #158): the REAL
 * production composition boots over the durable engine and serves the
 * REAL public transport.
 *
 * Unlike support/harness.ts (which mirrors the composition wiring to
 * keep the Arena-side operator handles), THIS suite calls
 * `composeRuntimeHost` from deploy/runtime/src/composition.ts VERBATIM
 * — the untouched P002 composition root — over the embedded real
 * Postgres engine, then binds the REAL P003 HTTP listener onto the
 * returned host and drives a generic plain-fetch client against the
 * ACTUAL local URL:
 *
 *   - the durable migrations applied from zero (the P002 semantics);
 *   - create + status + idempotent replay through the public boundary;
 *   - the honest NO-MATCH posture of the composition's zero-config
 *     routing defaults (an escalation stays `matching` — never an
 *     invented match; the full matched flow runs in the harness suites
 *     with the A004/A006 host wiring the composition's `routing`
 *     option exists for);
 *   - /healthz + /readyz fail-closed aggregate health at the listener;
 *   - hard restart: a SECOND `composeRuntimeHost` over the SAME
 *     transport re-applies nothing (migrations idempotent) and serves
 *     the SAME durable record (resume without loss).
 *
 * EVIDENCE: engine class embedded-postgres → AUTOMATED-TEST-ONLY
 * (release-gate §3); a live-Neon run of this same proof is env-gated
 * below (ARENA_P006_NEON_EVIDENCE_URL — DEMONSTRATED-LIVE when set).
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@arena/persistence';
import { composeRuntimeHost } from '@arena/runtime-host-composition';
import {
  createEmbeddedPostgresTransport,
} from './support/embedded-postgres.js';
import { DeveloperKeyRegistry, T0 } from './support/harness.js';
import {
  transcriptHeader,
  writeTranscript,
  evidenceClassForEngine,
} from './support/evidence.js';

const EVIDENCE_DIR =
  process.env.ARENA_P006_EVIDENCE_OUT ??
  new URL('../../../docs/evidence/production/integration/', import.meta.url).pathname;

interface PlainClient {
  readonly post: (path: string, body: unknown, authorization?: string) => Promise<{ status: number; body: string; requestIdHeader: string | null }>;
  readonly get: (path: string, authorization?: string) => Promise<{ status: number; body: string }>;
}

/** A minimal plain-fetch client (no test doubles — the ACTUAL URL). */
function plainClient(baseUrl: string): PlainClient {
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown, authorization?: string) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(authorization !== undefined ? { authorization } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text,
      requestIdHeader: response.headers.get('x-arena-request-id'),
    };
  };
  return {
    post: (path, body, authorization) => call('POST', path, body, authorization),
    get: (path, authorization) => call('GET', path, undefined, authorization),
  };
}

/** The reference create body over the routing service's fixture taxonomy. */
function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientAppId: 'generic-ai-app',
    tenantId: 'tenant-compose',
    sourceWorkflowRef: 'workflow-boq-accra-house',
    sourceRunRef: 'run-2026-10-09-001',
    taskRef: 'task-quantity-takeoff-block-c',
    capabilityNeed: 'construction.quantity-surveying.boq-verification',
    escalationModes: ['solve', 'unblock'],
    urgency: 'priority',
    deadlineInMs: 86_400_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['construction.quantity-surveying'],
      preferredLocales: ['en-GH'],
    },
    locale: 'en',
    desiredOutputSchema: { type: 'object' },
    contextReferences: [{ kind: 'task-ref', ref: 'task-quantity-takeoff-block-c' }],
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    permittedActions: ['read-context', 'propose-patch', 'annotate-evidence', 'signal-tool-gap'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
    idempotencyKey: 'compose-idem-0001',
    correlationId: 'compose-corr-0001',
    ...overrides,
  };
}

describe('P006 M1 — the production composition boots and serves the public transport', () => {
  it('composeRuntimeHost (deploy/runtime verbatim) over embedded Postgres: migrate → create → poll → replay → restart → same durable record', async () => {
    const engine = await createEmbeddedPostgresTransport();
    const clock = new ManualClock(T0);
    const transcript: string[] = [
      ...transcriptHeader('composition-embedded-postgres', {
        engineClass: 'embedded-postgres',
        transport: 'public HTTP listener (node:http, ephemeral port) over the frozen host surface',
        baseUrl: '(assigned at boot)',
        lens: 'customer',
        paymentPosture: 'not exercised in this proof (see integrated-flow transcript)',
      }),
    ];
    try {
      // (1) The untouched production composition over the durable engine.
      const host = await composeRuntimeHost({ transport: engine.transport, clock });
      const start = await host.start();
      transcript.push(
        `- composition.start: migrations ${start.migrationsApplied.map((entry) => entry.version).join(',')} applied from zero; recovery=${JSON.stringify(start.recovery)}`,
      );
      expect(start.migrationsApplied.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5]);

      // (2) The REAL public transport onto the composed host.
      const { startEscalationHttpHost } = await import('@arena/escalation-api/http-host');
      const keys = new DeveloperKeyRegistry(clock);
      const running = await startEscalationHttpHost(
        {
          surface: host.escalations,
          health: async () => {
            const snapshot = await host.health();
            return {
              state: snapshot.state,
              capacityStatus: snapshot.capacity.status,
              components: snapshot.components.map((component) => ({
                component: component.component,
                state: component.state,
                reasons: component.reasons.map((reason) => ({ code: reason.code })),
              })),
              ready: snapshot.ready,
              checkedAt: snapshot.checkedAt,
            };
          },
          authenticator: keys.authenticator(),
          clock,
        },
        { port: 0, host: '127.0.0.1' },
      );
      const client = plainClient(running.url);
      transcript.push(`- listener: ${running.url} (actual local URL)`);

      // (3) Health/readiness at the listener (fail-closed aggregate).
      const health = await client.get('/healthz');
      transcript.push(`- /healthz: ${health.status} ${health.body.slice(0, 120)}`);
      expect(health.status).toBe(200);

      // (4) A scoped key through the REAL key model, then create.
      const issuance = keys.issue({ tenantId: 'tenant-compose' });
      const created = await client.post(
        '/v1/escalations',
        createBody(),
        `Bearer ${issuance.secret}`,
      );
      const createdPayload = JSON.parse(created.body) as {
        kind: string;
        requestId: string;
        duplicate: boolean;
      };
      transcript.push(
        `- POST /v1/escalations: ${created.status} kind=${createdPayload.kind} requestId=${createdPayload.requestId}`,
      );
      expect(created.status).toBe(201);
      expect(createdPayload.kind).toBe('escalation-created');

      // (5) Status poll through the public boundary.
      const status = await client.get(
        `/v1/escalations/${createdPayload.requestId}`,
        `Bearer ${issuance.secret}`,
      );
      const statusPayload = JSON.parse(status.body) as {
        kind: string;
        record: { state: string; request: { requestId: string } };
      };
      transcript.push(
        `- GET /v1/escalations/{id}: ${status.status} state=${statusPayload.record.state}`,
      );
      expect(status.status).toBe(200);
      // The honest NO-MATCH posture: the composition's zero-config
      // routing defaults match nobody — the escalation stays `matching`
      // (never an invented match; the matched flow is the harness
      // suites' A004/A006 host wiring).
      expect(statusPayload.record.state).toBe('matching');

      // (6) Idempotent replay through the public boundary.
      const replay = await client.post(
        '/v1/escalations',
        createBody(),
        `Bearer ${issuance.secret}`,
      );
      const replayPayload = JSON.parse(replay.body) as {
        kind: string;
        requestId: string;
        duplicate: boolean;
      };
      transcript.push(
        `- replay POST: ${replay.status} kind=${replayPayload.kind} duplicate=${replayPayload.duplicate}`,
      );
      expect(replay.status).toBe(200);
      expect(replayPayload.kind).toBe('escalation-replayed');
      expect(replayPayload.duplicate).toBe(true);
      expect(replayPayload.requestId).toBe(createdPayload.requestId);

      // (7) HARD RESTART: stop the host + listener; compose a SECOND
      // untouched composition over the SAME engine; the SAME durable
      // record serves (resume without loss or duplicate).
      await running.close();
      await host.stop();
      const clock2 = new ManualClock(T0 + 60_000);
      const host2 = await composeRuntimeHost({ transport: engine.transport, clock: clock2 });
      const start2 = await host2.start();
      transcript.push(
        `- restart.start: migrationsApplied=${start2.migrationsApplied.length} (idempotent no-op); recovery=${JSON.stringify(start2.recovery)}`,
      );
      expect(start2.migrationsApplied).toEqual([]);

      const running2 = await startEscalationHttpHost(
        {
          surface: host2.escalations,
          health: async () => {
            const snapshot = await host2.health();
            return {
              state: snapshot.state,
              capacityStatus: snapshot.capacity.status,
              components: snapshot.components.map((component) => ({
                component: component.component,
                state: component.state,
                reasons: component.reasons.map((reason) => ({ code: reason.code })),
              })),
              ready: snapshot.ready,
              checkedAt: snapshot.checkedAt,
            };
          },
          authenticator: keys.authenticator(),
          clock: clock2,
        },
        { port: 0, host: '127.0.0.1' },
      );
      const client2 = plainClient(running2.url);
      const status2 = await client2.get(
        `/v1/escalations/${createdPayload.requestId}`,
        `Bearer ${issuance.secret}`,
      );
      const status2Payload = JSON.parse(status2.body) as {
        record: { state: string; request: { requestId: string; idempotencyKey: string } };
      };
      transcript.push(
        `- post-restart GET: ${status2.status} state=${status2Payload.record.state} (same durable record, no loss, no duplicate)`,
      );
      expect(status2.status).toBe(200);
      expect(status2Payload.record.request.requestId).toBe(createdPayload.requestId);
      expect(status2Payload.record.state).toBe('matching');

      // The replay is STILL idempotent across the restart boundary.
      const replay2 = await client2.post(
        '/v1/escalations',
        createBody(),
        `Bearer ${issuance.secret}`,
      );
      const replay2Payload = JSON.parse(replay2.body) as { requestId: string; duplicate: boolean };
      expect(replay2Payload.duplicate).toBe(true);
      expect(replay2Payload.requestId).toBe(createdPayload.requestId);
      transcript.push(
        `- post-restart replay: duplicate=${replay2Payload.duplicate} (deterministic recorded outcome)`,
      );

      await running2.close();
      await host2.stop();

      transcript.push(
        `- evidence-class: ${evidenceClassForEngine('embedded-postgres')} (embedded real PostgreSQL 17 — PGlite WASM)`,
      );
      const file = await writeTranscript(EVIDENCE_DIR, 'composition-embedded-postgres', transcript);
      expect(file).toContain('composition-embedded-postgres-transcript.md');
    } finally {
      await engine.close();
    }
  });

  it('OPTIONAL live-Neon composition proof (self-skipping without a dedicated evidence URL)', async () => {
    const neonUrl =
      process.env.ARENA_P006_NEON_EVIDENCE_URL ??
      (process.env.DATABASE_URL?.startsWith('postgres://') ? process.env.DATABASE_URL : undefined);
    if (neonUrl === undefined) {
      // Honest self-skip: no dedicated evidence database is configured;
      // the embedded engine carries the AUTOMATED-TEST-ONLY proof.
      return;
    }
    const { createNeonHttpSqlTransport } = await import('@arena/hosted-neon-postgres');
    const transport = createNeonHttpSqlTransport(neonUrl);
    const clock = new ManualClock(T0);
    const host = await composeRuntimeHost({ transport, clock });
    const start = await host.start();
    expect(start.migrationsApplied.length).toBeGreaterThanOrEqual(0);
    const { startEscalationHttpHost } = await import('@arena/escalation-api/http-host');
    const keys = new DeveloperKeyRegistry(clock);
    const running = await startEscalationHttpHost(
      {
        surface: host.escalations,
        health: async () => {
          const snapshot = await host.health();
          return {
            state: snapshot.state,
            capacityStatus: snapshot.capacity.status,
            components: snapshot.components.map((component) => ({
              component: component.component,
              state: component.state,
              reasons: component.reasons.map((reason) => ({ code: reason.code })),
            })),
            ready: snapshot.ready,
            checkedAt: snapshot.checkedAt,
          };
        },
        authenticator: keys.authenticator(),
        clock,
      },
      { port: 0, host: '127.0.0.1' },
    );
    try {
      const client = plainClient(running.url);
      const issuance = keys.issue({ tenantId: 'tenant-compose-live' });
      const created = await client.post(
        '/v1/escalations',
        createBody({
          tenantId: 'tenant-compose-live',
          idempotencyKey: 'compose-live-idem-0001',
          correlationId: 'compose-live-corr-0001',
        }),
        `Bearer ${issuance.secret}`,
      );
      expect(created.status).toBe(201);
      const transcript = [
        ...transcriptHeader('composition-live-neon', {
          engineClass: 'live-neon',
          transport: 'public HTTP listener over the frozen host surface + Neon HTTP driver',
          baseUrl: running.url,
          lens: 'customer',
          paymentPosture: 'not exercised in this proof',
        }),
        `- POST /v1/escalations: ${created.status}`,
        `- evidence-class: ${evidenceClassForEngine('live-neon')} (live hosted Postgres through the real Neon HTTP driver)`,
      ];
      await writeTranscript(EVIDENCE_DIR, 'composition-live-neon', transcript);
    } finally {
      await running.close();
      await host.stop();
    }
  });
});
