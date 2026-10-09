/**
 * tests/security/production/ac07-idempotency-races.test.ts — AC-07
 * idempotency races (Work Order P007 integrated pass; issue #159).
 *
 * "idempotency races (concurrent same-key submissions — exactly-once
 * outcome)" — the attack F-03 explicitly deferred to this pass (P002's
 * sequential replay proof does not prove the racing-insert path).
 *
 * The attack fires REAL concurrent HTTP submissions of the SAME
 * idempotency identity (tenant + idempotencyKey + correlationId) at the
 * REAL listener over the REAL embedded Postgres engine, plus concurrent
 * cross-tenant same-key races and concurrent body-rebinding attempts.
 *
 * The exactly-once INVARIANT (what must hold under every interleaving):
 *   - exactly ONE escalation record exists for the identity afterwards;
 *   - every successful response names the SAME requestId;
 *   - the webhook outbox never emits a duplicate event id;
 *   - the audit chain still verifies.
 * The OUTCOME DISTRIBUTION (how losers are served) is characterized
 * honestly: a racing loser that sees a typed fail-closed conflict
 * (PERSISTENCE_RECORD_EXISTS surfacing as the typed 500) is a finding
 * recorded in the findings register (F-08) — the double-act itself is
 * NOT reachable.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '@arena/job-protocol';
import type { AuditRecord } from '@arena/job-protocol';
import {
  bootAdversarialBattery,
  createBody,
  json,
  postJson,
} from './support/adversarial-harness.js';
import type { AdversarialBattery, HttpExchange } from './support/adversarial-harness.js';

let battery: AdversarialBattery;

beforeEach(async () => {
  battery = await bootAdversarialBattery();
});

afterEach(async () => {
  await battery.close();
});

function key(tenantId: string): Record<string, string> {
  const issuance = battery.keys.issue({ tenantId });
  return { authorization: `Bearer ${issuance.secret}` };
}

/** Fire N concurrent identical POSTs and settle ALL outcomes (never reject). */
async function fireConcurrent(
  url: string,
  bodies: readonly Record<string, unknown>[],
  auth: Record<string, string>,
): Promise<HttpExchange[]> {
  return Promise.all(
    bodies.map((body) =>
      postJson(url, body, auth).then(
        (exchange) => exchange,
        (error: unknown) => ({
          status: -1,
          headers: {},
          body: `client-side failure: ${String(error)}`,
        }),
      ),
    ),
  );
}

describe('AC-07 — concurrent same-key submissions (the exactly-once invariant)', () => {
  it('N=12 racing identical submissions produce exactly ONE record, one requestId, zero double-events', async () => {
    const auth = key('tenant-alpha');
    const identity = {
      idempotencyKey: 'idem-race-1',
      correlationId: 'corr-race-1',
    };
    const bodies = Array.from({ length: 12 }, () => createBody(identity));
    const exchanges = await fireConcurrent(`${battery.baseUrl}/v1/escalations`, bodies, auth);

    // The exactly-once INVARIANT (must hold under every interleaving) —
    // these assertions are the regression test for the attack class.
    const created = exchanges.filter((exchange) => exchange.status === 201);
    const replayed = exchanges.filter((exchange) => exchange.status === 200);
    const conflicts = exchanges.filter((exchange) => exchange.status === 409);
    const failClosed = exchanges.filter(
      (exchange) => exchange.status >= 500 || exchange.status === -1,
    );

    // Exactly one record for the identity in the durable store.
    const ownList = await battery.host.escalations.listByCorrelationId(
      'tenant-alpha',
      identity.correlationId,
    );
    expect(ownList).toHaveLength(1);
    const winnerRequestId = ownList[0]?.request.requestId ?? '';

    // Every non-error response names the SAME request id.
    for (const exchange of [...created, ...replayed, ...conflicts]) {
      const requestId = json(exchange.body)['requestId'];
      if (typeof requestId === 'string' && requestId.length > 0) {
        expect(requestId).toBe(winnerRequestId);
      }
    }
    // No client-side failures.
    expect(failClosed.every((exchange) => exchange.status !== -1)).toBe(true);

    // The outbox never carries a duplicate event id (per-EVENT dedupe).
    const allOutbox = await battery.durable.webhookOutbox.listAll();
    const eventIds = allOutbox.map((delivery) => delivery.eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);

    // The audit chain still verifies over the whole raced store — with
    // REAL audited mutations in it (the DurableEventSink chain carries
    // job-mutation events; drive one through the host so the
    // verification is non-vacuous, never an empty-chain trivial pass).
    const job = await battery.host.jobs.submitByKind({
      kindName: 'escalation-recompute',
      input: {},
      correlationId: 'corr-race-audit' as never,
      idempotencyKey: 'idem-race-audit' as never,
      actor: { type: 'service', tenant: 'arena', principalId: 'p007-ac07' },
    });
    await battery.host.claimWithLease({
      jobId: job.jobId,
      actor: { type: 'service', tenant: 'arena', principalId: 'p007-ac07' },
    });
    await battery.engines.runner.complete({
      jobId: job.jobId,
      actor: { type: 'service', tenant: 'arena', principalId: 'p007-ac07' },
      result: 'done',
    });
    const chain = (await battery.host.auditRecords()) as readonly AuditRecord[];
    expect(chain.length).toBeGreaterThanOrEqual(3);
    await expect(verifyAuditChain({ records: [...chain] })).resolves.toBeTypeOf('string');

    // The recorded idempotency outcome exists and is deterministic.
    const recorded = await battery.host.recordedOutcome({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: identity.idempotencyKey as never,
      correlationId: identity.correlationId as never,
    });
    expect(recorded).toBeDefined();
    expect(recorded?.outcome.requestId).toBe(winnerRequestId);

    // HONEST outcome distribution (characterized, not asserted to a
    // single shape — the register row F-08 tracks the spurious typed
    // 500s a racing loser can observe; the double-act never occurs):
    // every response is 201 created, 200 replay, 409 conflict or a
    // typed fail-closed error — never a second record.
    const outcomeCounts = {
      created: created.length,
      replayed: replayed.length,
      conflicts: conflicts.length,
      failClosed: failClosed.length,
    };
    expect(outcomeCounts.created + outcomeCounts.replayed + outcomeCounts.conflicts + outcomeCounts.failClosed).toBe(12);
    expect(outcomeCounts.created).toBe(1);
    // A racing loser is EITHER served the replay (200) or fails closed
    // (typed 500 with the honest concurrent-insert message) — never a
    // silent second create.
    for (const exchange of failClosed) {
      expect(exchange.status).toBe(500);
      const body = json(exchange.body);
      expect(body['code']).toBe('ESCALATION_UNKNOWN_ERROR');
      // Fail-closed body is typed and honest (never a raw passthrough).
      expect(typeof body['message']).toBe('string');
      expect(body['stack']).toBeUndefined();
    }
  });

  it('sequential retry AFTER the race resolves to the recorded outcome verbatim', async () => {
    const auth = key('tenant-alpha');
    const identity = { idempotencyKey: 'idem-race-2', correlationId: 'corr-race-2' };
    const bodies = Array.from({ length: 8 }, () => createBody(identity));
    await fireConcurrent(`${battery.baseUrl}/v1/escalations`, bodies, auth);

    // Once the race has settled, a SEQUENTIAL retry must deterministically
    // replay the recorded outcome (the client's safe recovery path).
    const replay = await postJson(`${battery.baseUrl}/v1/escalations`, createBody(identity), auth);
    expect(replay.status).toBe(200);
    const replayBody = json(replay.body);
    expect(replayBody['kind']).toBe('escalation-replayed');
    expect(replayBody['duplicate']).toBe(true);
    const again = await postJson(`${battery.baseUrl}/v1/escalations`, createBody(identity), auth);
    expect(json(again.body)['requestId']).toBe(replayBody['requestId']);
  });
});

describe('AC-07 — concurrent cross-tenant same-key race (no cross-tenant replay leak)', () => {
  it('alpha and beta racing the SAME key produce two DISTINCT records (one per tenant)', async () => {
    const alpha = key('tenant-alpha');
    const beta = key('tenant-beta');
    const identity = { idempotencyKey: 'idem-race-x', correlationId: 'corr-race-x' };
    const alphaBody = createBody(identity);
    const betaBody = createBody({ ...identity, tenantId: 'tenant-beta' });

    const [alphaExchanges, betaExchanges] = await Promise.all([
      fireConcurrent(`${battery.baseUrl}/v1/escalations`, Array.from({ length: 5 }, () => alphaBody), alpha),
      fireConcurrent(`${battery.baseUrl}/v1/escalations`, Array.from({ length: 5 }, () => betaBody), beta),
    ]);

    // Each tenant ends with EXACTLY ONE record — a cross-tenant replay
    // leak would surface as one tenant's race resolving to the OTHER
    // tenant's requestId (asserted impossible here).
    const alphaList = await battery.host.escalations.listByCorrelationId(
      'tenant-alpha',
      identity.correlationId,
    );
    const betaList = await battery.host.escalations.listByCorrelationId(
      'tenant-beta',
      identity.correlationId,
    );
    expect(alphaList).toHaveLength(1);
    expect(betaList).toHaveLength(1);
    expect(alphaList[0]?.request.requestId).not.toBe(betaList[0]?.request.requestId);

    const alphaRequestIds = new Set(
      [...alphaExchanges, ...betaExchanges]
        .map((exchange) => {
          try {
            const id = json(exchange.body)['requestId'];
            return typeof id === 'string' ? id : undefined;
          } catch {
            return undefined;
          }
        })
        .filter((id): id is string => id !== undefined),
    );
    // Alpha's responses only ever named alpha's record — never beta's.
    for (const exchange of alphaExchanges) {
      const requestId = json(exchange.body)['requestId'];
      if (typeof requestId === 'string' && requestId.length > 0) {
        expect(requestId).toBe(alphaList[0]?.request.requestId);
      }
    }
    for (const exchange of betaExchanges) {
      const requestId = json(exchange.body)['requestId'];
      if (typeof requestId === 'string' && requestId.length > 0) {
        expect(requestId).toBe(betaList[0]?.request.requestId);
      }
    }
    expect(alphaRequestIds.size).toBeGreaterThanOrEqual(1);
  });
});

describe('AC-07 — concurrent body-rebinding attempt (same key, DIFFERENT bodies racing)', () => {
  it('never silently rebinds: at most one body wins, the others replay or conflict typed', async () => {
    const auth = key('tenant-alpha');
    const identity = { idempotencyKey: 'idem-race-rebind', correlationId: 'corr-race-rebind' };
    const bodyA = createBody({ ...identity, capabilityNeed: 'rebind-capability-a' });
    const bodyB = createBody({ ...identity, capabilityNeed: 'rebind-capability-b' });

    const exchanges = await fireConcurrent(
      `${battery.baseUrl}/v1/escalations`,
      [bodyA, bodyB, bodyA, bodyB, bodyA, bodyB],
      auth,
    );

    // Exactly ONE record exists; its capabilityNeed is ONE of the two
    // bodies (whichever insert won) — never a merge, never a rebind.
    const records = await battery.host.escalations.listByCorrelationId(
      'tenant-alpha',
      identity.correlationId,
    );
    expect(records).toHaveLength(1);
    const winner = records[0]?.request.capabilityNeed ?? '';
    expect(['rebind-capability-a', 'rebind-capability-b']).toContain(winner);

    // Every response is created / replay / typed 409 conflict / typed
    // fail-closed — no 2xx ever carried the OTHER body's record.
    for (const exchange of exchanges) {
      expect([200, 201, 409, 500]).toContain(exchange.status);
      if (exchange.status === 409) {
        expect(json(exchange.body)['code']).toBe('ESCALATION_IDENTITY_CONFLICT');
      }
      if (exchange.status === 200 || exchange.status === 201) {
        const body = json(exchange.body);
        if (typeof body['requestId'] === 'string') {
          expect(body['requestId']).toBe(records[0]?.request.requestId);
        }
      }
    }
  });
});
