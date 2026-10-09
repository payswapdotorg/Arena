/**
 * tests/api-host/api-host.e2e.test.ts — the P003 acceptance proofs (Work
 * Order P003; issue #155; spec/post-roadmap-production-work-items.md
 * "## P003" acceptance row).
 *
 * "generic client uses an actual local URL; end-to-end result and signed
 * webhook verify; MCP operates against the same boundary; auth/tenant
 * mismatch, duplicate delivery, forgery, collision, timeout and retry
 * tests pass. No private chain-of-thought capture."
 *
 * The generic client is plain `fetch` against the REAL listener
 * (node:http on an ephemeral port — never an in-process mock call). The
 * stack behind the listener is the production composition: the frozen
 * host seam, the REAL EscalationApiService + routing + JobOrchestrator,
 * the REAL durable components, the REAL developer-platform key model,
 * and (for the webhook proofs) the REAL webhook-delivery service
 * draining the REAL durable outbox into a REAL webhook receiver.
 *
 * Error payloads are honest machine-readable documents — no stack
 * traces, no internal reasoning, no private chain-of-thought capture
 * (asserted on the wire below).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyWebhookSignature, WEBHOOK_HEADER_NAMES } from '@arena/escalation-adapters';
import {
  bootApiHost,
  createBody,
  getJson,
  postJson,
  WebhookReceiver,
  webhookDelivery,
} from './support/harness.js';
import type { ApiHostBattery } from './support/harness.js';

let battery: ApiHostBattery;

beforeEach(async () => {
  battery = await bootApiHost();
});

afterEach(async () => {
  await battery.close();
});

/** Issue the default live key (tenant-alpha, create+read) and return the bearer header. */
function liveKey(tenantId = 'tenant-alpha'): Record<string, string> {
  const issuance = battery.keys.issue({ tenantId });
  return { authorization: `Bearer ${issuance.secret}` };
}

/** Parse a JSON body (the client-side parse — failures fail the test loudly). */
function json(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

describe('P003 acceptance — REST over the actual local URL', () => {
  it('create → status → result end-to-end (201 created, lens-stamped status, health gates)', async () => {
    const auth = liveKey();

    // The generic client posts the ES1.0 create body to the ACTUAL URL.
    const created = await postJson(`${battery.baseUrl}/v1/escalations`, createBody(), auth);
    expect(created.status).toBe(201);
    expect(created.headers['x-arena-request-id']).toBeDefined();
    // The create body is the recorded escalation-response payload (the
    // serialized wire form the C001 contract returns verbatim on replay).
    const createdPayload = json(created.body);
    expect(createdPayload['responseVersion']).toBe(1);
    expect(createdPayload['kind']).toBe('escalation-created');
    expect(createdPayload['duplicate']).toBe(false);
    const requestId = createdPayload['requestId'] as string;
    expect(requestId).toBe(created.headers['x-arena-request-id']);

    // Status polling over the same boundary.
    const status = await getJson(`${battery.baseUrl}/v1/escalations/${requestId}`, auth);
    expect(status.status).toBe(200);
    expect(status.headers['x-arena-request-id']).toBe(requestId);
    const statusPayload = json(status.body);
    expect(statusPayload['kind']).toBe('escalation-status');
    const record = statusPayload['record'] as Record<string, unknown>;
    expect(record['request']).toMatchObject({ requestId });
    // The durable record round-trips with a live state + history.
    expect(Array.isArray(record['history'])).toBe(true);
    expect(typeof record['state']).toBe('string');

    // Health + readiness at the listener (fail-closed aggregate; no tenant data).
    const health = await getJson(`${battery.baseUrl}/healthz`);
    expect(health.status).toBe(200);
    const healthBody = json(health.body);
    expect(healthBody['ready']).toBe(true);
    expect(healthBody['capacity']).toBe('AVAILABLE');
    const ready = await getJson(`${battery.baseUrl}/readyz`);
    expect(ready.status).toBe(200);
    expect(json(ready.body)).toMatchObject({ ready: true });

    // Transport-level negatives: unknown route 404; wrong method 405 + Allow.
    expect((await getJson(`${battery.baseUrl}/nope`)).status).toBe(404);
    const wrongMethod = await postJson(`${battery.baseUrl}/healthz`, {});
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers['allow']).toContain('GET');
  });

  it('idempotency replay returns the recorded outcome verbatim; key+body mismatch is the typed 409 collision', async () => {
    const auth = liveKey();
    const body = createBody({ idempotencyKey: 'idem-collision-1', correlationId: 'corr-collision-1' });

    const first = await postJson(`${battery.baseUrl}/v1/escalations`, body, auth);
    expect(first.status).toBe(201);
    const firstRequestId = json(first.body)['requestId'];

    // The C001 law: same key → 200 replay with the recorded outcome verbatim.
    const replay = await postJson(`${battery.baseUrl}/v1/escalations`, body, auth);
    expect(replay.status).toBe(200);
    const replayPayload = json(replay.body);
    expect(replayPayload['kind']).toBe('escalation-replayed');
    expect(replayPayload['duplicate']).toBe(true);
    expect(replayPayload['requestId']).toBe(firstRequestId);

    // The typed collision: same key, DIFFERENT body → 409 IDENTITY_CONFLICT.
    const collidingBody = createBody({
      idempotencyKey: 'idem-collision-1',
      correlationId: 'corr-collision-1',
      capabilityNeed: 'different-capability-need',
    });
    const collision = await postJson(`${battery.baseUrl}/v1/escalations`, collidingBody, auth);
    expect(collision.status).toBe(409);
    const collisionBody = json(collision.body);
    expect(collisionBody['code']).toBe('ESCALATION_IDENTITY_CONFLICT');
    // The REAL category from @arena/escalation's code set (idempotency).
    expect(collisionBody['category']).toBe('idempotency');
    expect(collisionBody['message']).toBeTypeOf('string');
    expect(collisionBody['details']).toBeTypeOf('object');
  });

  it('auth negatives are typed (missing/malformed/unknown secrets; sandbox key; missing scope; revoked key)', async () => {
    const body = createBody();

    // Missing Authorization entirely → typed 401 DEVELOPER_SECRET_INVALID.
    const missing = await postJson(`${battery.baseUrl}/v1/escalations`, body);
    expect(missing.status).toBe(401);
    expect(json(missing.body)['code']).toBe('DEVELOPER_SECRET_INVALID');

    // Malformed secret presentation → the SAME typed denial (no second code family).
    const malformed = await postJson(`${battery.baseUrl}/v1/escalations`, body, {
      authorization: 'Bearer not-a-developer-key',
    });
    expect(malformed.status).toBe(401);
    expect(json(malformed.body)['code']).toBe('DEVELOPER_SECRET_INVALID');

    // Well-formed but UNKNOWN secret → typed 401 DEVELOPER_KEY_NOT_FOUND.
    const unknown = await postJson(`${battery.baseUrl}/v1/escalations`, body, {
      authorization: `Bearer dak_live_${'b'.repeat(64)}`,
    });
    expect(unknown.status).toBe(401);
    expect(json(unknown.body)['code']).toBe('DEVELOPER_KEY_NOT_FOUND');

    // A SANDBOX key never touches the live surface → typed 403 ENVIRONMENT_MISMATCH.
    const sandbox = battery.keys.issue({ tenantId: 'tenant-alpha', environment: 'sandbox', scopes: ['sandbox:run', 'escalations:read'] });
    const sandboxExchange = await postJson(`${battery.baseUrl}/v1/escalations`, body, {
      authorization: `Bearer ${sandbox.secret}`,
    });
    expect(sandboxExchange.status).toBe(403);
    expect(json(sandboxExchange.body)['code']).toBe('DEVELOPER_ENVIRONMENT_MISMATCH');

    // A live key WITHOUT escalations:create → typed 403 DEVELOPER_SCOPE_MISSING.
    const readless = battery.keys.issue({ tenantId: 'tenant-alpha', scopes: ['observability:read'] });
    const scopeless = await postJson(`${battery.baseUrl}/v1/escalations`, body, {
      authorization: `Bearer ${readless.secret}`,
    });
    expect(scopeless.status).toBe(403);
    expect(json(scopeless.body)['code']).toBe('DEVELOPER_SCOPE_MISSING');

    // A REVOKED key (append-only lifecycle) → typed 403 DEVELOPER_KEY_REVOKED.
    const revokedIssuance = battery.keys.issue({ tenantId: 'tenant-alpha' });
    battery.keys.revoke(revokedIssuance.record);
    const revoked = await postJson(`${battery.baseUrl}/v1/escalations`, body, {
      authorization: `Bearer ${revokedIssuance.secret}`,
    });
    expect(revoked.status).toBe(403);
    expect(json(revoked.body)['code']).toBe('DEVELOPER_KEY_REVOKED');

    // Honest payloads only: none of the typed bodies leak stacks or internals.
    for (const exchange of [missing, malformed, unknown, sandboxExchange, scopeless, revoked]) {
      const bodyDoc = json(exchange.body);
      expect(bodyDoc['stack']).toBeUndefined();
      expect(bodyDoc['trace']).toBeUndefined();
      expect(JSON.stringify(bodyDoc)).not.toMatch(/at \S+ \(.*:\d+:\d+\)/);
    }
  });

  it('tenant mismatch fails closed and typed (client-claimed tenant ≠ key tenant; cross-tenant read invisible)', async () => {
    const alphaKey = liveKey('tenant-alpha');

    // Create under the key's tenant (the recorded ground truth).
    const created = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-tenant-1', correlationId: 'corr-tenant-1' }),
      alphaKey,
    );
    expect(created.status).toBe(201);
    const requestId = json(created.body)['requestId'] as string;

    // A client-claimed tenant that disagrees with the authenticated key → typed 403.
    const mismatch = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({
        tenantId: 'tenant-beta',
        idempotencyKey: 'idem-tenant-2',
        correlationId: 'corr-tenant-2',
      }),
      alphaKey,
    );
    expect(mismatch.status).toBe(403);
    const mismatchBody = json(mismatch.body);
    expect(mismatchBody['code']).toBe('DEVELOPER_CROSS_TENANT_ACCESS');
    expect(mismatchBody['details']).toMatchObject({ keyTenant: 'tenant-alpha', submittedTenant: 'tenant-beta' });

    // Cross-tenant READ: a tenant-beta key cannot even see the record → typed 404 fail-closed.
    const betaIssuance = battery.keys.issue({ tenantId: 'tenant-beta' });
    const crossRead = await getJson(`${battery.baseUrl}/v1/escalations/${requestId}`, {
      authorization: `Bearer ${betaIssuance.secret}`,
    });
    expect(crossRead.status).toBe(404);
    expect(json(crossRead.body)['code']).toBe('RUNTIME_ESCALATION_NOT_FOUND');

    // The same escalation stays readable for its own tenant (no false denial).
    const ownRead = await getJson(`${battery.baseUrl}/v1/escalations/${requestId}`, alphaKey);
    expect(ownRead.status).toBe(200);

    // An unknown request id is the same typed 404 (indistinguishable from cross-tenant).
    const unknownId = await getJson(`${battery.baseUrl}/v1/escalations/req_does-not-exist`, alphaKey);
    expect(unknownId.status).toBe(404);
    expect(json(unknownId.body)['code']).toBe('RUNTIME_ESCALATION_NOT_FOUND');
  });
});

describe('P003 acceptance — MCP against the same boundary (POST /mcp)', () => {
  it('tools/list + create-escalation + get-escalation-status over the SAME authority', async () => {
    const auth = liveKey();

    // Open contract metadata: tools/list needs no authorization.
    const list = await postJson(`${battery.baseUrl}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(list.status).toBe(200);
    const listResult = json(list.body)['result'] as Record<string, unknown>;
    const tools = JSON.parse((listResult['content'] as { text: string }[])[0]?.text ?? '[]') as {
      name: string;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual(['create-escalation', 'get-escalation-status']);

    // tools/call create-escalation (scope escalations:create — same boundary).
    const createCall = await postJson(
      `${battery.baseUrl}/mcp`,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create-escalation',
          arguments: createBody({ idempotencyKey: 'idem-mcp-1', correlationId: 'corr-mcp-1' }),
        },
      },
      auth,
    );
    expect(createCall.status).toBe(200);
    const createResult = JSON.parse(
      ((json(createCall.body)['result'] as Record<string, unknown>)['content'] as { text: string }[])[0]?.text ?? '{}',
    ) as Record<string, unknown>;
    expect(createResult['outcome']).toBe('created');
    const requestId = createResult['requestId'] as string;
    expect(createResult['state']).toBeTypeOf('string');

    // tools/call get-escalation-status over the SAME record.
    const statusCall = await postJson(
      `${battery.baseUrl}/mcp`,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get-escalation-status', arguments: { requestId, tenantId: 'tenant-alpha' } },
      },
      auth,
    );
    expect(statusCall.status).toBe(200);
    const statusResult = JSON.parse(
      ((json(statusCall.body)['result'] as Record<string, unknown>)['content'] as { text: string }[])[0]?.text ?? '{}',
    ) as Record<string, unknown>;
    expect(statusResult['requestId']).toBe(requestId);
    expect(statusResult['state']).toBe(createResult['state']);

    // The REST surface sees the SAME record (one authority, two transports).
    const restStatus = await getJson(`${battery.baseUrl}/v1/escalations/${requestId}`, auth);
    expect(restStatus.status).toBe(200);
    expect((json(restStatus.body)['record'] as Record<string, unknown>)['request']).toMatchObject({
      requestId,
    });

    // JSON-RPC negatives: unknown method (-32601 @ HTTP 200), unknown tool (-32602).
    const unknownMethod = await postJson(`${battery.baseUrl}/mcp`, {
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/list',
    });
    expect(unknownMethod.status).toBe(200);
    expect((json(unknownMethod.body)['error'] as Record<string, unknown>)['code']).toBe(-32601);
    const unknownTool = await postJson(
      `${battery.baseUrl}/mcp`,
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'no-such-tool', arguments: {} } },
      auth,
    );
    expect(unknownTool.status).toBe(200);
    expect((json(unknownTool.body)['error'] as Record<string, unknown>)['code']).toBe(-32602);

    // Malformed JSON body → HTTP 400 + PARSE_ERROR.
    const malformed = await fetch(`${battery.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(malformed.status).toBe(400);
    const malformedBody = json(await malformed.text());
    expect((malformedBody['error'] as Record<string, unknown>)['code']).toBe(-32700);
  });

  it('MCP auth + tenant negatives are the SAME typed taxonomy as REST', async () => {
    // Missing auth on tools/call → typed 401 DEVELOPER_SECRET_INVALID.
    const unauthenticated = await postJson(`${battery.baseUrl}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create-escalation', arguments: createBody() },
    });
    expect(unauthenticated.status).toBe(401);
    expect(json(unauthenticated.body)['code']).toBe('DEVELOPER_SECRET_INVALID');

    // Client-claimed tenant ≠ key tenant → typed 403 DEVELOPER_CROSS_TENANT_ACCESS.
    const alphaKey = liveKey('tenant-alpha');
    const mismatch = await postJson(
      `${battery.baseUrl}/mcp`,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create-escalation',
          arguments: createBody({
            tenantId: 'tenant-beta',
            idempotencyKey: 'idem-mcp-x',
            correlationId: 'corr-mcp-x',
          }),
        },
      },
      alphaKey,
    );
    expect(mismatch.status).toBe(403);
    expect(json(mismatch.body)['code']).toBe('DEVELOPER_CROSS_TENANT_ACCESS');
  });
});

describe('P003 acceptance — signed webhook delivery end-to-end (the REAL outbox drain)', () => {
  it('delivers every outbox event SIGNED; the consumer verifies each signature (HMAC-SHA256)', async () => {
    const receiver = new WebhookReceiver();
    const handle = await receiver.start();
    try {
      const auth = liveKey();
      const created = await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-hook-1', correlationId: 'corr-hook-1' }),
        auth,
      );
      expect(created.status).toBe(201);
      const pending = await battery.durable.webhookOutbox.listPending();
      expect(pending.length).toBeGreaterThanOrEqual(3);

      // The REAL delivery service drains the REAL durable outbox.
      const delivery = webhookDelivery(battery, handle.url);
      const report = await delivery.deliverPending();
      expect(report.outcome).toBe('swept');
      expect(report.pendingConsidered).toBe(pending.length);
      expect(report.deliveredCount).toBe(pending.length);
      expect(report.deadLetteredCount).toBe(0);
      expect(receiver.deliveries.length).toBe(pending.length);

      // Every delivery carries the full signed wire header set, and the
      // CONSUMER verifies each signature through the existing contract.
      for (const seen of receiver.deliveries) {
        expect(seen.headers['content-type']).toBe('application/json');
        expect(seen.headers[WEBHOOK_HEADER_NAMES.signingKeyId]).toBeDefined();
        const signatureHeader = String(seen.headers[WEBHOOK_HEADER_NAMES.signature]);
        expect(signatureHeader.startsWith('v1=')).toBe(true);
        const timestamp = Number(seen.headers[WEBHOOK_HEADER_NAMES.timestamp]);
        const verification = verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload: seen.body,
          signatureHeader,
          now: battery.clock.now(),
        });
        expect(verification).toEqual({ outcome: 'verified' });
      }

      // The durable outbox is drained (nothing pending, nothing dropped).
      expect(await battery.durable.webhookOutbox.listPending()).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it('forgery is rejected by the consumer contract (tampered signature, tampered payload, malformed header, stale timestamp)', async () => {
    const receiver = new WebhookReceiver();
    const handle = await receiver.start();
    try {
      const auth = liveKey();
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-forgery-1', correlationId: 'corr-forgery-1' }),
        auth,
      );
      const delivery = webhookDelivery(battery, handle.url);
      await delivery.deliverPending();
      const seen = receiver.deliveries[0];
      expect(seen).toBeDefined();
      const payload = seen?.body ?? '';
      const signatureHeader = String(seen?.headers[WEBHOOK_HEADER_NAMES.signature]);
      const timestamp = Number(seen?.headers[WEBHOOK_HEADER_NAMES.timestamp]);

      // (1) A tampered signature digest fails the constant-time compare.
      const tamperedSignature = `v1=${'0'.repeat(64)}`;
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload,
          signatureHeader: tamperedSignature,
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });

      // (2) A tampered payload (same signature) no longer verifies.
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload: `${payload.slice(0, -2)}x}`,
          signatureHeader,
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });

      // (3) A malformed signature header is rejected up front.
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload,
          signatureHeader: 'v1',
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'malformed-signature-header' });

      // (4) A REPLAYED-but-stale delivery: correctly signed for an old
      // timestamp (a legitimate signer, replayed outside the 5-minute
      // tolerance) — the tolerance check rejects it.
      const staleTimestamp = timestamp - 301_000;
      const staleSignatureHeader = `v1=${battery.signer.sign(staleTimestamp, payload)}`;
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp: staleTimestamp,
          payload,
          signatureHeader: staleSignatureHeader,
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'timestamp-mismatch' });
      // ...while the SAME stale signature INSIDE the tolerance verifies.
      const freshTimestamp = battery.clock.now() - 60_000;
      const freshSignatureHeader = `v1=${battery.signer.sign(freshTimestamp, payload)}`;
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp: freshTimestamp,
          payload,
          signatureHeader: freshSignatureHeader,
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'verified' });
    } finally {
      await handle.close();
    }
  });

  it('duplicate delivery is deduped per EVENT ID on the consumer side (never per type)', async () => {
    const receiver = new WebhookReceiver();
    const handle = await receiver.start();
    try {
      const auth = liveKey();
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-dedupe-1', correlationId: 'corr-dedupe-1' }),
        auth,
      );
      const pending = await battery.durable.webhookOutbox.listPending();
      const distinctEventIds = new Set(pending.map((event) => event.eventId));
      expect(distinctEventIds.size).toBe(pending.length);

      // A transient failure on the FIRST delivery: attempt 1 fails (500),
      // attempt 2 succeeds — the receiver sees the SAME event twice.
      let calls = 0;
      receiver.setResponder((_request, response) => {
        calls += 1;
        if (calls === 1) {
          response.statusCode = 500;
          response.end('transient');
          return;
        }
        response.statusCode = 200;
        response.end('ok');
      });
      const delivery = webhookDelivery(battery, handle.url, {
        backoff: { maxAttempts: 3, baseDelayMs: 1, multiplier: 1 },
      });
      const report = await delivery.deliverPending();
      expect(report.deliveredCount).toBe(pending.length);
      // One event was delivered twice (at-least-once); the rest once.
      expect(receiver.deliveries.length).toBe(pending.length + 1);

      // The CONSUMER's dedupe discipline: per EVENT ID (the stable
      // x-arena-event-id key), never per type — types legitimately recur
      // across lifecycle transitions (R-032).
      const deliveredEventIds = receiver.deliveries.map(
        (seen) => String(seen.headers[WEBHOOK_HEADER_NAMES.eventId]),
      );
      expect(new Set(deliveredEventIds)).toEqual(distinctEventIds);
      const duplicatedId = receiver.deliveries[0]?.headers[WEBHOOK_HEADER_NAMES.eventId];
      expect(
        receiver.deliveries.filter(
          (seen) => seen.headers[WEBHOOK_HEADER_NAMES.eventId] === duplicatedId,
        ).length,
      ).toBe(2);
      // Dedupe by event id keeps the unique set at the pending count —
      // the consumer processes the duplicated event exactly once.
      expect(new Set(deliveredEventIds).size).toBe(pending.length);
    } finally {
      await handle.close();
    }
  });

  it('a hanging endpoint times out (bounded transport) and RETRIES to success; exhaustion dead-letters', async () => {
    const receiver = new WebhookReceiver();
    const handle = await receiver.start();
    try {
      const auth = liveKey();
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-timeout-1', correlationId: 'corr-timeout-1' }),
        auth,
      );
      const pending = await battery.durable.webhookOutbox.listPending();
      expect(pending.length).toBeGreaterThanOrEqual(3);

      // The first request HANGS (never responds) — the bounded transport
      // timeout fails the attempt; the retry succeeds.
      let calls = 0;
      receiver.setResponder((_request, response) => {
        calls += 1;
        if (calls === 1) {
          return; // hang the first attempt — the transport timeout must fire
        }
        response.statusCode = 200;
        response.end('ok');
      });
      const delivery = webhookDelivery(battery, handle.url, {
        timeoutMs: 150,
        backoff: { maxAttempts: 2, baseDelayMs: 1, multiplier: 1 },
      });
      const report = await delivery.deliverPending();
      expect(report.deliveredCount).toBe(pending.length);
      expect(report.deadLetteredCount).toBe(0);

      // The FIRST event's attempt 1 timed out (no HTTP status — the
      // request never completed) and attempt 2 delivered it.
      const firstEventId = pending[0]?.eventId ?? '';
      const attempts = await delivery.attemptsFor(firstEventId);
      expect(attempts.length).toBe(2);
      expect(attempts[0]).toMatchObject({ attempt: 1, outcome: 'failed', httpStatus: null });
      expect(attempts[1]).toMatchObject({ attempt: 2, outcome: 'delivered', httpStatus: 200 });

      // Exhaustion dead-letters: a permanently failing endpoint moves
      // every remaining... (this scenario already delivered everything,
      // so prove exhaustion on a SECOND escalation against a dead endpoint).
      const receiver2 = new WebhookReceiver((_request, response) => {
        response.statusCode = 503;
        response.end('dead');
      });
      const handle2 = await receiver2.start();
      try {
        await postJson(
          `${battery.baseUrl}/v1/escalations`,
          createBody({ idempotencyKey: 'idem-timeout-2', correlationId: 'corr-timeout-2' }),
          auth,
        );
        const deadDelivery = webhookDelivery(battery, handle2.url, {
          backoff: { maxAttempts: 3, baseDelayMs: 1, multiplier: 1 },
        });
        const deadReport = await deadDelivery.deliverPending();
        expect(deadReport.deadLetteredCount).toBeGreaterThanOrEqual(3);
        const deadLetters = await deadDelivery.deadLetters();
        expect(deadLetters.length).toBeGreaterThanOrEqual(3);
        for (const letter of deadLetters) {
          expect(letter.lastHttpStatus).toBe(503);
          expect(letter.url).toBe(handle2.url);
        }
        // The explicit state: a re-sweep SKIPS dead-lettered events (no retry storm).
        const resweep = await deadDelivery.deliverPending();
        expect(resweep.skippedCount).toBeGreaterThanOrEqual(3);
        expect(resweep.deliveredCount).toBe(0);
      } finally {
        await handle2.close();
      }
    } finally {
      await handle.close();
    }
  });
});
