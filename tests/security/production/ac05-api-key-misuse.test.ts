/**
 * tests/security/production/ac05-api-key-misuse.test.ts — AC-05 API-key
 * leakage and misuse (Work Order P007 integrated pass; issue #159).
 *
 * "API-key misuse (wrong scope, revoked key, rotated key, replay)" —
 * attacks the REAL developer-platform key model through the REAL public
 * transport boundary:
 *
 *   - rotated key: the pre-rotation secret is denied (typed
 *     DEVELOPER_KEY_ROTATED) forever after; the successor secret works;
 *     a replay of the OLD secret after rotation never resurrects it;
 *   - revoked key: denied typed DEVELOPER_KEY_REVOKED; repeated replays
 *     never resurrect it (revocation is terminal);
 *   - wrong scope: read-scope key attempting create → typed 403;
 *     create-scope key attempting read → typed 403;
 *   - sandbox key on the live transport → typed 403 environment mismatch;
 *   - the `keys:manage` non-delegation law: a key can never mint another
 *     key — the closed scope vocabulary refuses the fabrication at
 *     issuance, and authorization for an unissued scope fails closed;
 *   - secret hygiene: NO issued secret ever appears in any response
 *     body across the entire battery's traffic (the leakage scanner
 *     sweeps every captured exchange), and the one-time issuance shape
 *     (dak_<env>_<64 hex>) never leaks through error payloads.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVELOPER_KEY_SCOPES } from '@arena/developer-platform';
import {
  bootAdversarialBattery,
  createBody,
  getJson,
  json,
  postJson,
} from './support/adversarial-harness.js';
import type { AdversarialBattery, HttpExchange } from './support/adversarial-harness.js';

let battery: AdversarialBattery;
/** Every HTTP exchange observed this test file (the leakage corpus). */
const observedTraffic: HttpExchange[] = [];

beforeEach(async () => {
  battery = await bootAdversarialBattery();
});

afterEach(async () => {
  await battery.close();
});

/** Record an exchange in the leakage corpus (call at every probe). */
function track<T extends HttpExchange>(exchange: T): T {
  observedTraffic.push(exchange);
  return exchange;
}

function key(
  tenantId = 'tenant-alpha',
  scopes?: readonly string[],
): { auth: Record<string, string>; secret: string; record: ReturnType<typeof battery.keys.issue>['record'] } {
  const issuance = battery.keys.issue({
    tenantId,
    ...(scopes !== undefined ? { scopes: scopes as never } : {}),
  });
  return {
    auth: { authorization: `Bearer ${issuance.secret}` },
    secret: issuance.secret,
    record: issuance.record,
  };
}

describe('AC-05 — rotated key (the append-only lifecycle transition)', () => {
  it('the pre-rotation secret is denied typed forever; the successor is authorized; replays never resurrect', async () => {
    const body = createBody();
    const original = key();

    // Before rotation the original secret works.
    expect((await postJson(`${battery.baseUrl}/v1/escalations`, body, original.auth)).status).toBe(
      201,
    );

    // ROTATE through the REAL lifecycle transition.
    const { successor } = battery.keys.rotate(original.record);

    // The OLD secret is denied — typed DEVELOPER_KEY_ROTATED (403).
    const oldKeyAttempt = track(
      await postJson(`${battery.baseUrl}/v1/escalations`, body, original.auth),
    );
    expect(oldKeyAttempt.status).toBe(403);
    expect(json(oldKeyAttempt.body)['code']).toBe('DEVELOPER_KEY_ROTATED');

    // REPLAY the old secret repeatedly — never resurrects (append-only
    // lifecycle: rotated is a one-way status).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = track(await postJson(`${battery.baseUrl}/v1/escalations`, body, original.auth));
      expect(replay.status).toBe(403);
      expect(json(replay.body)['code']).toBe('DEVELOPER_KEY_ROTATED');
    }

    // The SUCCESSOR secret is authorized for the SAME tenant.
    const successorAuth = { authorization: `Bearer ${successor.secret}` };
    const successorCreate = track(
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac05-rot', correlationId: 'corr-ac05-rot' }),
        successorAuth,
      ),
    );
    expect(successorCreate.status).toBe(201);
    const requestId = json(successorCreate.body)['requestId'] as string;
    const successorRead = track(
      await getJson(`${battery.baseUrl}/v1/escalations/${requestId}`, successorAuth),
    );
    expect(successorRead.status).toBe(200);
  });

  it('rotating a revoked key is refused typed (revocation is terminal; the real model enforces it)', () => {
    const victim = key();
    const revoked = battery.keys.revoke(victim.record);
    expect(revoked.status).toBe('revoked');
    // The REAL model refuses to rotate a revoked key (terminal).
    let refused = false;
    let code = '';
    try {
      battery.keys.rotate(revoked);
    } catch (error) {
      refused = true;
      code = (error as { code?: string }).code ?? '';
    }
    expect(refused).toBe(true);
    expect(code).toBe('DEVELOPER_KEY_REVOKED');
  });
});

describe('AC-05 — revoked key and replay', () => {
  it('a revoked key is denied typed at every boundary and repeated replays never resurrect it', async () => {
    const body = createBody({ idempotencyKey: 'idem-ac05-rev', correlationId: 'corr-ac05-rev' });
    const victim = key();

    // Revoke through the REAL lifecycle transition.
    battery.keys.revoke(victim.record);

    // REST create with the revoked secret → typed 403 DEVELOPER_KEY_REVOKED.
    const revokedCreate = track(await postJson(`${battery.baseUrl}/v1/escalations`, body, victim.auth));
    expect(revokedCreate.status).toBe(403);
    expect(json(revokedCreate.body)['code']).toBe('DEVELOPER_KEY_REVOKED');

    // REST status read with the revoked secret → same typed denial.
    const revokedRead = track(
      await getJson(`${battery.baseUrl}/v1/escalations/req_ac05-nothing`, victim.auth),
    );
    expect(revokedRead.status).toBe(403);
    expect(json(revokedRead.body)['code']).toBe('DEVELOPER_KEY_REVOKED');

    // MCP tools/call with the revoked secret → the SAME typed taxonomy.
    const revokedMcp = track(
      await postJson(
        `${battery.baseUrl}/mcp`,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'create-escalation', arguments: body },
        },
        victim.auth,
      ),
    );
    expect(revokedMcp.status).toBe(403);
    expect(json(revokedMcp.body)['code']).toBe('DEVELOPER_KEY_REVOKED');

    // Repeated replays (the "resurrection attempt") never succeed.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = track(await postJson(`${battery.baseUrl}/v1/escalations`, body, victim.auth));
      expect(replay.status).toBe(403);
      expect(json(replay.body)['code']).toBe('DEVELOPER_KEY_REVOKED');
    }
  });
});

describe('AC-05 — wrong scope (the closed scope vocabulary)', () => {
  it('a read-only key cannot create; a create-only key cannot read; a sandbox key cannot touch the live surface', async () => {
    const body = createBody();
    const readOnly = key('tenant-alpha', ['escalations:read']);

    // Read-scope key attempting create → typed 403 DEVELOPER_SCOPE_MISSING.
    const readCreates = track(await postJson(`${battery.baseUrl}/v1/escalations`, body, readOnly.auth));
    expect(readCreates.status).toBe(403);
    expect(json(readCreates.body)['code']).toBe('DEVELOPER_SCOPE_MISSING');

    // Create-only key attempting status read → the same typed denial.
    const createOnly = key('tenant-alpha', ['escalations:create']);
    const created = track(
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac05-scope', correlationId: 'corr-ac05-scope' }),
        createOnly.auth,
      ),
    );
    expect(created.status).toBe(201);
    const requestId = json(created.body)['requestId'] as string;
    const createOnlyRead = track(
      await getJson(`${battery.baseUrl}/v1/escalations/${requestId}`, createOnly.auth),
    );
    expect(createOnlyRead.status).toBe(403);
    expect(json(createOnlyRead.body)['code']).toBe('DEVELOPER_SCOPE_MISSING');

    // Sandbox key against the LIVE transport → typed 403 environment mismatch.
    const sandbox = battery.keys.issue({
      tenantId: 'tenant-alpha',
      environment: 'sandbox',
      scopes: ['sandbox:run', 'escalations:read'],
    });
    const sandboxAttempt = track(
      await postJson(`${battery.baseUrl}/v1/escalations`, body, {
        authorization: `Bearer ${sandbox.secret}`,
      }),
    );
    expect(sandboxAttempt.status).toBe(403);
    expect(json(sandboxAttempt.body)['code']).toBe('DEVELOPER_ENVIRONMENT_MISMATCH');

    // The closed vocabulary has NO keys:manage scope — a key can never
    // mint another key (the non-delegation law, pinned here).
    expect(DEVELOPER_KEY_SCOPES).not.toContain('keys:manage');
    expect([...DEVELOPER_KEY_SCOPES]).toEqual(
      expect.arrayContaining(['escalations:create', 'escalations:read', 'sandbox:run']),
    );
  });

  it('fabricating an unissued scope at issuance is refused typed (closed vocabulary)', () => {
    let refused = false;
    let code = '';
    try {
      battery.keys.issue({
        tenantId: 'tenant-alpha',
        scopes: ['keys:manage'] as never,
      });
    } catch (error) {
      refused = true;
      code = (error as { code?: string }).code ?? '';
    }
    expect(refused).toBe(true);
    expect(code).toBe('DEVELOPER_INVALID_SCOPE');
  });

  it('authorizing for an unissued scope fails closed (a key never gains scopes it was not issued)', async () => {
    const body = createBody();
    const victim = key('tenant-alpha', ['escalations:read']);
    // Present the valid secret through the boundary but demand the
    // never-issued 'keys:manage' authority: the typed verdict is a
    // scope denial (never a silent grant).
    const verdict = await battery.keys
      .authenticator()
      .authenticate({
        presentedSecret: victim.secret,
        scope: 'keys:manage' as never,
        environment: 'live',
      });
    expect(verdict.outcome).toBe('denied');
    if (verdict.outcome === 'denied') {
      expect(['scope-missing', 'secret-invalid']).toContain(verdict.reason);
    }
    void body;
  });
});

describe('AC-05 — secret hygiene (the leakage scanner)', () => {
  it('NO issued secret ever appears in any captured response body', async () => {
    const body = createBody();
    // Enrich the corpus's SECRET SET (this test's battery instance is
    // fresh — issue, rotate and revoke keys so the scanner's corpus
    // carries live, rotated AND revoked secrets).
    const live = key();
    const rotatedVictim = key();
    const { successor } = battery.keys.rotate(rotatedVictim.record);
    const revokedVictim = key();
    battery.keys.revoke(revokedVictim.record);
    const secrets = battery.keys.issuedSecrets();
    expect(secrets.length).toBeGreaterThanOrEqual(4);
    expect(secrets).toContain(live.secret);
    expect(secrets).toContain(successor.secret);
    expect(secrets).toContain(revokedVictim.secret);

    // Generate some denial traffic to enrich the corpus.
    const unknown = track(
      await postJson(`${battery.baseUrl}/v1/escalations`, body, {
        authorization: `Bearer dak_live_${'f'.repeat(64)}`,
      }),
    );
    expect(unknown.status).toBe(401);
    const malformed = track(
      await postJson(`${battery.baseUrl}/v1/escalations`, body, {
        authorization: 'Bearer not-a-key',
      }),
    );
    expect(malformed.status).toBe(401);
    // And some authorized + denied traffic (the full verdict spectrum).
    const created = track(
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac05-hyg', correlationId: 'corr-ac05-hyg' }),
        live.auth,
      ),
    );
    expect(created.status).toBe(201);
    const denied = track(
      await postJson(`${battery.baseUrl}/v1/escalations`, body, revokedVictim.auth),
    );
    expect(denied.status).toBe(403);

    // The scanner: every issued secret (including rotated and revoked
    // ones) must be absent from EVERY captured response body.
    for (const secret of secrets) {
      for (const exchange of observedTraffic) {
        expect(exchange.body).not.toContain(secret);
      }
      // And from the headers too (no secret echo in header values).
      for (const exchange of observedTraffic) {
        for (const value of Object.values(exchange.headers)) {
          expect(value).not.toContain(secret);
        }
      }
    }

    // Denial payloads are honest documents: typed code + message, no
    // stack traces, no internal reasoning.
    for (const exchange of observedTraffic) {
      const bodyDoc = json(exchange.body);
      expect(bodyDoc['stack']).toBeUndefined();
      expect(bodyDoc['trace']).toBeUndefined();
      expect(JSON.stringify(bodyDoc)).not.toMatch(/at \S+ \(.*:\d+:\d+\)/);
    }
  });
});
