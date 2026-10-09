/**
 * Developer-portal interactive write tests (P005/S-03, the R-028
 * disposition): the CSRF + idempotency posture over the REAL
 * developer-platform service — fail-closed auth (401), the read-only
 * demo tenant (403), the origin check (403), the C001-style
 * idempotency law (required key, verbatim replay, typed identity
 * conflict), the full append-only key lifecycle
 * (register → issue → run → rotate → revoke) with the shown-once
 * secret moments, and the adversarial cross-tenant denial. House
 * style: REAL composed services with injected session probes.
 */

import { describe, expect, it } from 'vitest';

import { ManualClock } from '../../../../../../packages/persistence/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../../../packages/role-context/src/index.js';
import { createLocalAuthStack } from '../../../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../../../packages/security/src/index.js';

import {
  handlePortalWrite,
  handlePortalWriteRequest,
  PORTAL_IDEMPOTENCY_HEADER,
  PortalIdempotencyMemo,
} from '../_lib/portal-writes.js';
import { composePortalRuntime } from '../_lib/portal-runtime.js';
import type { PortalWriteDeps } from '../_lib/portal-writes.js';

import { POST as registerClientAppsPost } from './client-apps/route.js';
import { POST as issueKeyPost } from './keys/route.js';
import { POST as rotateKeyPost } from './keys/rotate/route.js';
import { POST as revokeKeyPost } from './keys/revoke/route.js';
import { POST as sandboxRunsPost } from './sandbox/runs/route.js';

const T = '2026-10-01T08:00:00.000Z';
const ORIGIN = 'https://arena.test';

/** A REAL authenticated session for one tenant over the local auth stack. */
async function buildSession(tenantId: string, who: string) {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'p005-portal-writes-session-secret-0123456',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: `principal-p005-${who}`,
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-owner'],
          label: `p005-${who}`,
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({ method: 'test-login', claims: { who } });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId,
    workspaceContext: createWorkspaceContext({
      identityId: `principal-p005-${who}`,
      tenantId,
      workspaceId: `${tenantId}-ws`,
      permissionPolicy: createPermissionPolicy({
        policyId: `${tenantId}-policy`,
        tenantId,
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: ['owner'].map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: `principal-p005-${who}`,
          tenantId,
          roleId,
          policyId: `${tenantId}-policy`,
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ),
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
  });
  return {
    cookieValue: issuance.cookie.value,
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
  };
}

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

function postRequest(
  path: string,
  body: Record<string, unknown>,
  options: { readonly origin?: string; readonly idempotencyKey?: string } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      origin: options.origin ?? ORIGIN,
      'content-type': 'application/json',
      ...(options.idempotencyKey !== undefined
        ? { [PORTAL_IDEMPOTENCY_HEADER]: options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Fresh deps: a REAL runtime + a fresh memo (test isolation). */
function freshDeps(): PortalWriteDeps {
  return { runtime: composePortalRuntime(), memo: new PortalIdempotencyMemo() };
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('the write routes are thin POST mounts over the shared composition', () => {
  it('every portal write route exports an async POST handler', () => {
    for (const route of [
      registerClientAppsPost,
      issueKeyPost,
      rotateKeyPost,
      revokeKeyPost,
      sandboxRunsPost,
    ]) {
      expect(route.constructor.name).toBe('AsyncFunction');
    }
  });
});

describe('fail-closed auth: an unauthenticated POST never writes', () => {
  it('answers a typed 401 for a cookie-less visitor', async () => {
    const response = await handlePortalWriteRequest(
      postRequest('/developers/api/keys', { keyId: 'k1' }, { idempotencyKey: 'idem-1' }),
      'issue-key',
      { session: { probe: NO_COOKIE_PROBE } },
    );
    expect(response.status).toBe(401);
    const body = await jsonOf(response);
    const error = body['error'] as { code: string; message: string };
    expect(error.code).toBe('AUTH_SESSION_NOT_FOUND');
    expect(error.message).toContain('never run anonymously');
  });
});

describe('the demo portal is read-only (demo state is never customer state)', () => {
  it('answers a typed 403 for the reserved demo tenant', async () => {
    const demo = await buildSession('arena-demo', 'demo-operator');
    const response = await handlePortalWriteRequest(
      postRequest('/developers/api/keys', { keyId: 'k1' }, { idempotencyKey: 'idem-1' }),
      'issue-key',
      { session: { probe: demo.probe }, ...freshDeps() },
    );
    expect(response.status).toBe(403);
    const body = await jsonOf(response);
    const error = body['error'] as { code: string; message: string };
    expect(error.code).toBe('PORTAL_DEMO_READ_ONLY');
    expect(error.message).toContain('read-only');
  });
});

describe('the CSRF origin check (the B004 posture on portal writes)', () => {
  it('rejects a foreign Origin before any state is touched', async () => {
    const response = await handlePortalWrite(
      postRequest('/developers/api/keys', { keyId: 'k1' }, { origin: 'https://evil.example' }),
      'issue-key',
      { tenantId: 'acme', principalLabel: 'acme operator' },
      freshDeps(),
    );
    expect(response.status).toBe(403);
    const body = await jsonOf(response);
    const error = body['error'] as { code: string };
    expect(error.code).toBe('BOUNDARY_ORIGIN_REJECTED');
  });

  it('rejects an absent Origin header (strict posture)', async () => {
    const request = new Request(`${ORIGIN}/developers/api/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyId: 'k1' }),
    });
    const response = await handlePortalWrite(request, 'issue-key', {
      tenantId: 'acme',
      principalLabel: 'acme operator',
    });
    expect(response.status).toBe(403);
    const body = await jsonOf(response);
    expect((body['error'] as { code: string }).code).toBe('BOUNDARY_ORIGIN_REJECTED');
  });
});

describe('the idempotency law (C001 semantics at the portal boundary)', () => {
  it('requires the idempotency key header', async () => {
    const response = await handlePortalWrite(
      postRequest('/developers/api/client-apps', { displayName: 'App', environment: 'sandbox' }),
      'register-client-app',
      { tenantId: 'acme', principalLabel: 'acme operator' },
      freshDeps(),
    );
    expect(response.status).toBe(400);
    const body = await jsonOf(response);
    expect((body['error'] as { code: string }).code).toBe('PORTAL_IDEMPOTENCY_KEY_REQUIRED');
  });

  it('replays the recorded outcome verbatim with the replay marker', async () => {
    const deps = freshDeps();
    const facts = { tenantId: 'acme', principalLabel: 'acme operator' };
    const request = () =>
      postRequest(
        '/developers/api/client-apps',
        { displayName: 'Acme console', environment: 'sandbox' },
        { idempotencyKey: 'idem-register-1' },
      );
    const first = await handlePortalWrite(request(), 'register-client-app', facts, deps);
    expect(first.status).toBe(201);
    const firstBody = await jsonOf(first);
    const replay = await handlePortalWrite(request(), 'register-client-app', facts, deps);
    expect(replay.status).toBe(201);
    const replayBody = await jsonOf(replay);
    expect(replayBody['replayed']).toBe(true);
    const firstApp = firstBody['clientApp'] as Record<string, unknown>;
    const replayApp = replayBody['clientApp'] as Record<string, unknown>;
    expect(replayApp['clientAppId']).toBe(firstApp['clientAppId']);
  });

  it('rejects the same key paired with a different body (typed conflict)', async () => {
    const deps = freshDeps();
    const facts = { tenantId: 'acme', principalLabel: 'acme operator' };
    const first = await handlePortalWrite(
      postRequest(
        '/developers/api/client-apps',
        { displayName: 'Acme console', environment: 'sandbox' },
        { idempotencyKey: 'idem-conflict' },
      ),
      'register-client-app',
      facts,
      deps,
    );
    expect(first.status).toBe(201);
    const conflict = await handlePortalWrite(
      postRequest(
        '/developers/api/client-apps',
        { displayName: 'A DIFFERENT app', environment: 'sandbox' },
        { idempotencyKey: 'idem-conflict' },
      ),
      'register-client-app',
      facts,
      deps,
    );
    expect(conflict.status).toBe(409);
    const body = await jsonOf(conflict);
    expect((body['error'] as { code: string }).code).toBe('PORTAL_IDENTITY_CONFLICT');
  });

  it('scopes memo keys per tenant (the same key across tenants is no conflict)', async () => {
    const deps = freshDeps();
    const body = { displayName: 'Shared name', environment: 'sandbox' };
    const acme = await handlePortalWrite(
      postRequest('/developers/api/client-apps', body, { idempotencyKey: 'idem-shared' }),
      'register-client-app',
      { tenantId: 'acme', principalLabel: 'acme operator' },
      deps,
    );
    const globex = await handlePortalWrite(
      postRequest('/developers/api/client-apps', body, { idempotencyKey: 'idem-shared' }),
      'register-client-app',
      { tenantId: 'globex', principalLabel: 'globex operator' },
      deps,
    );
    expect(acme.status).toBe(201);
    expect(globex.status).toBe(201);
    const acmeBody = (await jsonOf(acme))['clientApp'] as Record<string, unknown>;
    const globexBody = (await jsonOf(globex))['clientApp'] as Record<string, unknown>;
    expect(acmeBody['clientAppId']).not.toBe(globexBody['clientAppId']);
    expect(acmeBody['tenantId']).toBe('acme');
    expect(globexBody['tenantId']).toBe('globex');
  });
});

describe('the full write lifecycle over the REAL developer-platform service', () => {
  it('register → issue (secret shown once) → sandbox run → rotate → revoke', async () => {
    const acme = await buildSession('acme', 'acme-operator');
    const deps = { session: { probe: acme.probe }, ...freshDeps() };

    // 1) register a sandbox client app
    const register = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/client-apps',
        { displayName: 'Acme console app', environment: 'sandbox' },
        { idempotencyKey: 'idem-app-1' },
      ),
      'register-client-app',
      deps,
    );
    expect(register.status).toBe(201);
    const app = ((await jsonOf(register))['clientApp'] ?? {}) as Record<string, unknown>;
    expect(app['clientAppId']).toMatch(/^app-/);
    expect(app['tenantId']).toBe('acme');

    // 2) issue a sandbox key with the sandbox:run scope
    const issue = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/keys',
        {
          clientAppId: app['clientAppId'],
          environment: 'sandbox',
          scopes: ['sandbox:run'],
          label: 'console sandbox key',
        },
        { idempotencyKey: 'idem-key-1' },
      ),
      'issue-key',
      deps,
    );
    expect(issue.status).toBe(201);
    const issued = await jsonOf(issue);
    const key = (issued['key'] ?? {}) as Record<string, unknown>;
    const secret = issued['secret'];
    expect(typeof secret).toBe('string');
    expect(key['status']).toBe('active');
    expect(issued['secretNotice']).toContain('exactly once');

    // 3) run a sandbox escalation with the presented secret
    const run = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/sandbox/runs',
        { scenarioId: 'boq-quantity-takeoff', presentedSecret: secret },
        { idempotencyKey: 'idem-run-1' },
      ),
      'run-sandbox-escalation',
      deps,
    );
    expect(run.status).toBe(200);
    const runBody = await jsonOf(run);
    const runRecord = (runBody['run'] ?? {}) as Record<string, unknown>;
    expect(runRecord['scenarioId']).toBe('boq-quantity-takeoff');
    expect(runRecord['environment']).toBe('sandbox');
    expect(runBody['truth']).toContain('sandbox truth, never customer truth');

    // 4) rotate the key (append-only active → rotated; successor secret)
    const rotate = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/keys/rotate',
        { keyId: key['keyId'] },
        { idempotencyKey: 'idem-rotate-1' },
      ),
      'rotate-key',
      deps,
    );
    expect(rotate.status).toBe(200);
    const rotated = await jsonOf(rotate);
    const successor = (rotated['key'] ?? {}) as Record<string, unknown>;
    expect(successor['keyId']).not.toBe(key['keyId']);
    expect(typeof rotated['secret']).toBe('string');

    // 5) revoke the successor (terminal, append-only)
    const revoke = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/keys/revoke',
        { keyId: successor['keyId'] },
        { idempotencyKey: 'idem-revoke-1' },
      ),
      'revoke-key',
      deps,
    );
    expect(revoke.status).toBe(200);
    const revoked = (await jsonOf(revoke))['key'] as Record<string, unknown>;
    expect(revoked['status']).toBe('revoked');
  });
});

describe('adversarial write postures (typed failures, never silent ones)', () => {
  it('denies a cross-tenant key revoke with the typed tenancy error', async () => {
    const globex = await buildSession('globex', 'globex-operator');
    const acme = await buildSession('acme', 'acme-operator');
    // ONE shared runtime: both tenants' records live in the same store,
    // so the denial below is the TENANT check, not a missing record.
    const shared = freshDeps();
    const globexDeps = { session: { probe: globex.probe }, ...shared };

    // Globex registers an app and issues a key.
    const register = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/client-apps',
        { displayName: 'Globex app', environment: 'sandbox' },
        { idempotencyKey: 'idem-globex-app' },
      ),
      'register-client-app',
      globexDeps,
    );
    const app = ((await jsonOf(register))['clientApp'] ?? {}) as Record<string, unknown>;
    const issue = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/keys',
        {
          clientAppId: app['clientAppId'],
          environment: 'sandbox',
          scopes: ['escalations:read'],
          label: 'globex key',
        },
        { idempotencyKey: 'idem-globex-key' },
      ),
      'issue-key',
      globexDeps,
    );
    const globexKey = ((await jsonOf(issue))['key'] ?? {}) as Record<string, unknown>;

    // Acme tries to revoke Globex's key (the key EXISTS in the shared
    // store — the denial is the tenant boundary, never a 404 dodge).
    const attack = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/keys/revoke',
        { keyId: globexKey['keyId'] },
        { idempotencyKey: 'idem-attack' },
      ),
      'revoke-key',
      { session: { probe: acme.probe }, ...shared },
    );
    expect(attack.status).toBe(403);
    const body = await jsonOf(attack);
    const error = body['error'] as { code: string; category: string };
    expect(error.code).toBe('DEVELOPER_CROSS_TENANT_ACCESS');
    expect(error.category).toBe('tenancy');
  });

  it('rejects a scope outside the closed vocabulary (a key can never mint a key)', async () => {
    const acme = await buildSession('acme', 'scope-operator');
    const response = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/keys',
        {
          clientAppId: 'app-doesnotmatter',
          environment: 'sandbox',
          scopes: ['keys:manage'],
          label: 'illegal scope',
        },
        { idempotencyKey: 'idem-scope' },
      ),
      'issue-key',
      { session: { probe: acme.probe }, ...freshDeps() },
    );
    expect(response.status).toBe(400);
    const body = await jsonOf(response);
    expect((body['error'] as { code: string }).code).toBe('DEVELOPER_INVALID_REQUEST');
  });

  it('authorizes the presented secret BEFORE scenario validation (no scenario oracle)', async () => {
    // A garbage secret + an unknown scenario answers the AUTH failure,
    // not the scenario lookup — an unauthenticated caller learns nothing
    // about which scenarios exist.
    const acme = await buildSession('acme', 'scenario-operator');
    const response = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/sandbox/runs',
        { scenarioId: 'no-such-scenario', presentedSecret: 'not-a-real-secret' },
        { idempotencyKey: 'idem-scenario-oracle' },
      ),
      'run-sandbox-escalation',
      { session: { probe: acme.probe }, ...freshDeps() },
    );
    expect(response.status).toBe(403);
    const body = await jsonOf(response);
    expect((body['error'] as { code: string }).code).toMatch(/^DEVELOPER_/);
  });

  it('rejects an unknown sandbox scenario with the typed validation error (valid secret)', async () => {
    const acme = await buildSession('acme', 'scenario-valid');
    const deps = { session: { probe: acme.probe }, ...freshDeps() };
    const register = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/client-apps',
        { displayName: 'Scenario app', environment: 'sandbox' },
        { idempotencyKey: 'idem-scenario-app' },
      ),
      'register-client-app',
      deps,
    );
    const app = ((await jsonOf(register))['clientApp'] ?? {}) as Record<string, unknown>;
    const issue = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/keys',
        {
          clientAppId: app['clientAppId'],
          environment: 'sandbox',
          scopes: ['sandbox:run'],
          label: 'scenario key',
        },
        { idempotencyKey: 'idem-scenario-key' },
      ),
      'issue-key',
      deps,
    );
    const secret = (await jsonOf(issue))['secret'];
    const response = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/sandbox/runs',
        { scenarioId: 'no-such-scenario', presentedSecret: secret },
        { idempotencyKey: 'idem-scenario-run' },
      ),
      'run-sandbox-escalation',
      deps,
    );
    expect(response.status).toBe(400);
    const body = await jsonOf(response);
    expect((body['error'] as { code: string }).code).toBe('DEVELOPER_INVALID_REQUEST');
  });

  it('rejects a sandbox run with a TAMPERED presented secret (fail closed, typed)', async () => {
    const acme = await buildSession('acme', 'secret-operator');
    const deps = { session: { probe: acme.probe }, ...freshDeps() };
    const register = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/client-apps',
        { displayName: 'Secret app', environment: 'sandbox' },
        { idempotencyKey: 'idem-secret-app' },
      ),
      'register-client-app',
      deps,
    );
    const app = ((await jsonOf(register))['clientApp'] ?? {}) as Record<string, unknown>;
    const issue = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/keys',
        {
          clientAppId: app['clientAppId'],
          environment: 'sandbox',
          scopes: ['sandbox:run'],
          label: 'secret key',
        },
        { idempotencyKey: 'idem-secret-key' },
      ),
      'issue-key',
      deps,
    );
    const secret = (await jsonOf(issue))['secret'] as string;
    const response = await handlePortalWriteRequest(
      postRequest(
        '/developers/api/sandbox/runs',
        { scenarioId: 'boq-quantity-takeoff', presentedSecret: `${secret}tampered` },
        { idempotencyKey: 'idem-secret-run' },
      ),
      'run-sandbox-escalation',
      deps,
    );
    expect(response.status).toBe(403);
    const body = await jsonOf(response);
    const error = body['error'] as { code: string; category: string };
    expect(error.code).toMatch(/^DEVELOPER_/);
    expect(error.category).toBe('scope');
  });
});
