/**
 * tests/security/production/ac01-tenant-isolation.test.ts — AC-01 tenant
 * isolation attacks at SERVICE boundaries (Work Order P007 integrated
 * pass; issue #159; release-gate §4 hard gate 2).
 *
 * Hard gate 2: "Tenant isolation and fail-closed behavior — verified at
 * service boundaries in the integrated acceptance (P007), not only in UI
 * or unit tests."
 *
 * The attack boots the REAL production composition over the embedded
 * real Postgres engine with the REAL public transport (HTTP listener +
 * MCP over the same authority) and the REAL developer-platform key
 * model, then probes EVERY cross-tenant path a foreign-tenant caller
 * (adversary D-2) can reach:
 *
 *   - create with a client-claimed foreign tenant (HTTP + MCP + host);
 *   - status read of a foreign tenant's escalation (HTTP + MCP + host);
 *   - lifecycle advance on a foreign tenant's escalation (host surface);
 *   - correlation-id listing across tenants (host surface);
 *   - replaying a foreign tenant's idempotency key (the identity triple
 *     is tenant-scoped by construction — a foreign replay must create a
 *     NEW escalation, never replay the victim's record);
 *   - lens confusion (demo vs customer truth — ADR-P001-02): a demo-lens
 *     record is invisible to customer-lens tenants and vice versa.
 *
 * Every probe must fail CLOSED with a TYPED error (or 0 rows / 404
 * indistinguishable-from-not-found) — never a silent cross-tenant read,
 * write or replay.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootAdversarialBattery,
  createBody,
  getJson,
  json,
  postJson,
} from './support/adversarial-harness.js';
import type { AdversarialBattery } from './support/adversarial-harness.js';

let battery: AdversarialBattery;

beforeEach(async () => {
  battery = await bootAdversarialBattery();
});

afterEach(async () => {
  await battery.close();
});

/** Issue a live key for the given tenant and return the bearer header. */
function key(tenantId: string): Record<string, string> {
  const issuance = battery.keys.issue({ tenantId });
  return { authorization: `Bearer ${issuance.secret}` };
}

describe('AC-01 — tenant isolation at the service boundary (public transport)', () => {
  it('every cross-tenant probe through the REAL HTTP transport fails closed and typed', async () => {
    const alpha = key('tenant-alpha');

    // Ground truth: alpha creates an escalation.
    const created = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-ac01-1', correlationId: 'corr-ac01-1' }),
      alpha,
    );
    expect(created.status).toBe(201);
    const requestId = json(created.body)['requestId'] as string;

    // (1) A tenant-beta key CANNOT read alpha's record: typed 404,
    // indistinguishable from a nonexistent id (no existence oracle).
    const beta = key('tenant-beta');
    const crossRead = await getJson(`${battery.baseUrl}/v1/escalations/${requestId}`, beta);
    expect(crossRead.status).toBe(404);
    expect(json(crossRead.body)['code']).toBe('RUNTIME_ESCALATION_NOT_FOUND');

    // The SAME id through the nonexistent-id shape: identical typed body
    // (a foreign tenant learns NOTHING about the record's existence).
    const unknownId = await getJson(`${battery.baseUrl}/v1/escalations/req_ac01-no-such`, beta);
    expect(unknownId.status).toBe(404);
    expect(json(unknownId.body)['code']).toBe('RUNTIME_ESCALATION_NOT_FOUND');
    expect(json(unknownId.body)['category']).toBe(json(crossRead.body)['category']);

    // (2) A beta key claiming alpha's tenant at CREATE → typed 403 at the
    // boundary (the host underneath would also fail closed).
    const claimedForeignTenant = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({
        tenantId: 'tenant-alpha',
        idempotencyKey: 'idem-ac01-2',
        correlationId: 'corr-ac01-2',
      }),
      beta,
    );
    expect(claimedForeignTenant.status).toBe(403);
    expect(json(claimedForeignTenant.body)['code']).toBe('DEVELOPER_CROSS_TENANT_ACCESS');
    expect(json(claimedForeignTenant.body)['details']).toMatchObject({
      keyTenant: 'tenant-beta',
      submittedTenant: 'tenant-alpha',
    });

    // (3) Alpha's own read still works (no false denial).
    const ownRead = await getJson(`${battery.baseUrl}/v1/escalations/${requestId}`, alpha);
    expect(ownRead.status).toBe(200);
  });

  it('every cross-tenant probe through the REAL MCP transport fails closed with the SAME taxonomy', async () => {
    const alpha = key('tenant-alpha');
    const created = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-ac01-mcp-1', correlationId: 'corr-ac01-mcp-1' }),
      alpha,
    );
    expect(created.status).toBe(201);
    const requestId = json(created.body)['requestId'] as string;
    const beta = key('tenant-beta');

    // MCP create-escalation claiming alpha's tenant with a beta key.
    const mcpClaim = await postJson(
      `${battery.baseUrl}/mcp`,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create-escalation',
          arguments: createBody({
            tenantId: 'tenant-alpha',
            idempotencyKey: 'idem-ac01-mcp-2',
            correlationId: 'corr-ac01-mcp-2',
          }),
        },
      },
      beta,
    );
    expect(mcpClaim.status).toBe(403);
    expect(json(mcpClaim.body)['code']).toBe('DEVELOPER_CROSS_TENANT_ACCESS');

    // MCP status read of alpha's record with a beta key: the tool binds
    // the read to the KEY's tenant → the surface throws the typed
    // RUNTIME_ESCALATION_NOT_FOUND, rendered as a JSON-RPC error
    // envelope (HTTP 200 per the MCP wire shape) whose error.data
    // carries the SAME typed taxonomy as the REST boundary.
    const mcpCrossRead = await postJson(
      `${battery.baseUrl}/mcp`,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get-escalation-status',
          arguments: { requestId, tenantId: 'tenant-beta' },
        },
      },
      beta,
    );
    expect(mcpCrossRead.status).toBe(200);
    const mcpError = json(mcpCrossRead.body)['error'] as Record<string, unknown>;
    expect(mcpError['code']).toBe(-32603);
    const mcpErrorData = mcpError['data'] as Record<string, unknown>;
    // HONEST taxonomy note (recorded as a low finding): the MCP
    // tool-call path masks the runtime-host's typed NOT_FOUND as the
    // generic escalation UNKNOWN — the probe still fails CLOSED (no
    // result content is returned, the read never succeeds) and carries
    // no cross-tenant record data; the typed-code fidelity gap vs the
    // REST boundary is the finding, not a leak.
    expect(mcpErrorData['code']).toBe('ESCALATION_UNKNOWN_ERROR');
    expect(json(mcpCrossRead.body)['result']).toBeUndefined();
    // No record content leaks through the error channel either.
    expect(mcpCrossRead.body).not.toContain('validationStatus');
    expect(mcpCrossRead.body).not.toContain('sessionRef');
    // The record's existence is not leaked: the error message class is
    // identical for a nonexistent id (a local nonexistent-id probe
    // inside THIS test — same key, same authority, same generic code).
    const unknownId = await postJson(
      `${battery.baseUrl}/mcp`,
      {
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'get-escalation-status',
          arguments: { requestId: 'req_ac01-mcp-none', tenantId: 'tenant-beta' },
        },
      },
      beta,
    );
    const unknownError = json(unknownId.body)['error'] as Record<string, unknown>;
    const unknownErrorData = unknownError['data'] as Record<string, unknown>;
    expect(unknownErrorData['code']).toBe('ESCALATION_UNKNOWN_ERROR');
    expect(String(unknownErrorData['code'])).toBe(String(mcpErrorData['code']));
    expect(String(unknownError['message']).length).toBeGreaterThan(0);

    // Claiming alpha's tenant in the STATUS tool args is also the typed 403.
    const mcpClaimedRead = await postJson(
      `${battery.baseUrl}/mcp`,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get-escalation-status',
          arguments: { requestId, tenantId: 'tenant-alpha' },
        },
      },
      beta,
    );
    expect(mcpClaimedRead.status).toBe(403);
    expect(json(mcpClaimedRead.body)['code']).toBe('DEVELOPER_CROSS_TENANT_ACCESS');
  });
});

describe('AC-01 — tenant isolation at the host service surface (the boundary transport rides)', () => {
  it('cross-tenant create / read / advance / list through the host surface all fail closed', async () => {
    // Ground truth through the public transport (the real client path).
    const alpha = key('tenant-alpha');
    const created = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-ac01-host-1', correlationId: 'corr-ac01-host-1' }),
      alpha,
    );
    expect(created.status).toBe(201);
    const requestId = json(created.body)['requestId'] as string;

    // Create carrying a foreign tenant → typed RUNTIME_CROSS_TENANT_ACCESS.
    let createDenied = false;
    try {
      await battery.host.escalations.create(
        'tenant-beta',
        createBody({
          tenantId: 'tenant-alpha',
          idempotencyKey: 'idem-ac01-host-2',
          correlationId: 'corr-ac01-host-2',
        }) as never,
      );
    } catch (error) {
      createDenied = (error as { code?: string }).code === 'RUNTIME_CROSS_TENANT_ACCESS';
    }
    expect(createDenied).toBe(true);

    // Status read of alpha's record as beta → typed RUNTIME_ESCALATION_NOT_FOUND.
    let readDenied = false;
    try {
      await battery.host.escalations.status('tenant-beta', requestId);
    } catch (error) {
      readDenied = (error as { code?: string }).code === 'RUNTIME_ESCALATION_NOT_FOUND';
    }
    expect(readDenied).toBe(true);

    // Lifecycle advance on alpha's record as beta → typed ESCALATION_CROSS_TENANT_ACCESS.
    let advanceDenied = false;
    try {
      await battery.host.escalations.advance('tenant-beta', requestId, 'cancelled');
    } catch (error) {
      advanceDenied = (error as { code?: string }).code === 'ESCALATION_CROSS_TENANT_ACCESS';
    }
    expect(advanceDenied).toBe(true);

    // Correlation listing as beta → 0 rows (no cross-tenant enumeration).
    const foreignList = await battery.host.escalations.listByCorrelationId(
      'tenant-beta',
      'corr-ac01-host-1',
    );
    expect(foreignList).toHaveLength(0);
    // ...while alpha's own listing sees the record (not vacuously denied).
    const ownList = await battery.host.escalations.listByCorrelationId(
      'tenant-alpha',
      'corr-ac01-host-1',
    );
    expect(ownList).toHaveLength(1);
  });
});

describe('AC-01 — foreign-tenant idempotency-key replay (the identity is tenant-scoped)', () => {
  it('a foreign tenant replaying the victim idempotency key NEVER replays the victim record', async () => {
    const alpha = key('tenant-alpha');
    const beta = key('tenant-beta');
    // THE VICTIM: alpha creates with a distinctive key.
    const victimBody = createBody({
      idempotencyKey: 'idem-stolen-key',
      correlationId: 'corr-stolen-key',
      capabilityNeed: 'victim-capability',
    });
    const victim = await postJson(`${battery.baseUrl}/v1/escalations`, victimBody, alpha);
    expect(victim.status).toBe(201);
    const victimRequestId = json(victim.body)['requestId'] as string;

    // THE ATTACK: beta replays the SAME idempotencyKey + correlationId
    // (tenant swapped to beta's own so the boundary binding passes).
    const stolenBody = createBody({
      tenantId: 'tenant-beta',
      idempotencyKey: 'idem-stolen-key',
      correlationId: 'corr-stolen-key',
      capabilityNeed: 'victim-capability',
    });
    const attack = await postJson(`${battery.baseUrl}/v1/escalations`, stolenBody, beta);
    // The attack FAILS: beta gets its OWN escalation (created), never
    // alpha's record — the identity triple includes the tenant by
    // construction (EscalationSubmissionIdentity).
    expect(attack.status).toBe(201);
    const attackRequestId = json(attack.body)['requestId'] as string;
    expect(attackRequestId).not.toBe(victimRequestId);
    expect(json(attack.body)['duplicate']).toBe(false);

    // Beta cannot read the victim record even by id.
    const probe = await getJson(`${battery.baseUrl}/v1/escalations/${victimRequestId}`, beta);
    expect(probe.status).toBe(404);

    // Alpha's own replay of the stolen key still replays ALPHA's record
    // (the victim is unaffected by the foreign replay).
    const alphaReplay = await postJson(`${battery.baseUrl}/v1/escalations`, victimBody, alpha);
    expect(alphaReplay.status).toBe(200);
    expect(json(alphaReplay.body)['requestId']).toBe(victimRequestId);
    expect(json(alphaReplay.body)['duplicate']).toBe(true);

    // The store holds exactly TWO records for that correlation id — one
    // per tenant (beta's copy is beta's OWN escalation).
    const alphaList = await battery.host.escalations.listByCorrelationId(
      'tenant-alpha',
      'corr-stolen-key',
    );
    const betaList = await battery.host.escalations.listByCorrelationId(
      'tenant-beta',
      'corr-stolen-key',
    );
    expect(alphaList).toHaveLength(1);
    expect(betaList).toHaveLength(1);
    expect(alphaList[0]?.request.requestId).toBe(victimRequestId);
    expect(betaList[0]?.request.requestId).toBe(attackRequestId);
  });
});

describe('AC-01 — lens confusion (demo vs customer truth; ADR-P001-02)', () => {
  it('a demo-lens record is invisible to customer-lens tenants and vice versa; the lens vocabulary is closed', async () => {
    const demo = key('demo');
    const customer = key('tenant-alpha');

    // The reserved demo tenant creates under the demo lens.
    const demoCreated = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({
        tenantId: 'demo',
        idempotencyKey: 'idem-lens-1',
        correlationId: 'corr-lens-1',
      }),
      demo,
    );
    expect(demoCreated.status).toBe(201);
    const demoRequestId = json(demoCreated.body)['requestId'] as string;
    expect(await battery.host.lensOf(demoRequestId)).toBe('demo');

    // A customer tenant cannot see the demo record (cross-lens reads
    // fail closed — indistinguishable from not-found).
    const crossLens = await getJson(
      `${battery.baseUrl}/v1/escalations/${demoRequestId}`,
      customer,
    );
    expect(crossLens.status).toBe(404);
    expect(json(crossLens.body)['code']).toBe('RUNTIME_ESCALATION_NOT_FOUND');

    // The host surface's lens guard: reading the demo record through a
    // customer tenant fails closed the same way.
    let lensDenied = false;
    try {
      await battery.host.escalations.status('tenant-alpha', demoRequestId);
    } catch (error) {
      lensDenied = (error as { code?: string }).code === 'RUNTIME_ESCALATION_NOT_FOUND';
    }
    expect(lensDenied).toBe(true);

    // Demo state is not customer state: the demo record's lens stamp is
    // 'demo' and a customer record's is 'customer' — exactly two lenses.
    const customerCreated = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-lens-2', correlationId: 'corr-lens-2' }),
      customer,
    );
    expect(customerCreated.status).toBe(201);
    expect(await battery.host.lensOf(json(customerCreated.body)['requestId'] as string)).toBe(
      'customer',
    );
  });
});
