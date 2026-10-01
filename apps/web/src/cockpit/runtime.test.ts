import { describe, expect, it } from 'vitest';

/**
 * Cockpit runtime tests (Work Order B007) — the house style: plain node
 * environment, REAL composed boundaries (the B004 local auth stack, the
 * B002 fakes, the B005 read-model service + read-API boundary), injected
 * session probes (no next/headers request scope needed).
 */

import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import {
  FakeControlPlaneRepository,
  ManualClock,
} from '../../../../packages/persistence/src/index.js';
import { ReadModelService } from '../../../../services/read-model/src/index.js';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import type { WorkspaceContext } from '../../../../packages/role-context/src/index.js';
import { AuthError, AUTH_ERROR_CODES } from '../../../../packages/auth/src/index.js';
import {
  createReadApiPort,
  getDemoCockpitContext,
  resolveSessionCockpit,
  sessionFacts,
} from './runtime.js';
import type { CockpitReadPort, SessionProbe } from './runtime.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';

const T = '2026-10-01T08:00:00.000Z';

function buildWorkspace(tenantId: string, roleIds: readonly string[]): WorkspaceContext {
  return createWorkspaceContext({
    identityId: 'worker-1',
    tenantId,
    workspaceId: `${tenantId}-ws`,
    permissionPolicy: createPermissionPolicy({
      policyId: `${tenantId}-policy`,
      tenantId,
      descriptor: { kind: 'test-policy' },
      issuedAt: T,
    }),
    grantedRoles: roleIds.map((roleId, index) =>
      grantRole({
        grantId: `grant-${roleId}-${String(index)}`,
        identityId: 'worker-1',
        tenantId,
        roleId,
        policyId: `${tenantId}-policy`,
        grantedBy: 'test',
        grantedAt: T,
        validFrom: T,
      }),
    ),
  });
}

interface SessionFixture {
  readonly probe: SessionProbe;
  readonly cookieValue: string;
  readonly repository: FakeControlPlaneRepository;
  readonly readModel: ReadModelService;
}

async function buildSessionFixture(
  tenantId: string,
  roleIds: readonly string[],
): Promise<SessionFixture> {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'test-session-secret-0123456789abcdefghijklmnop',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'worker-1',
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-member'],
          label: 'worker-one',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({ method: 'test-login', claims: { who: 'worker-1' } });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId,
    workspaceContext: buildWorkspace(tenantId, roleIds),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
  });
  const cookieValue = issuance.cookie.value;
  const repository = new FakeControlPlaneRepository({ clock });
  const readModel = new ReadModelService({ repository, clock });
  return {
    probe: {
      cookieValue: () => Promise.resolve(cookieValue),
      validate: (token: string) => auth.service.validateSession(token),
    },
    cookieValue,
    repository,
    readModel,
  };
}

describe('resolveSessionCockpit (fail closed; tenant from session; reads through B005)', () => {
  it('is unauthenticated when no session cookie is present (never an anonymous cockpit)', async () => {
    const outcome = await resolveSessionCockpit({
      probe: { cookieValue: () => Promise.resolve(null), validate: () => Promise.reject(new Error('unreachable')) },
    });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status === 'unauthenticated') {
      expect(outcome.code).toBe('AUTH_SESSION_NOT_FOUND');
    }
  });

  it('is unauthenticated on a typed AUTH_* validation failure, with the code surfaced', async () => {
    const outcome = await resolveSessionCockpit({
      probe: {
        cookieValue: () => Promise.resolve('sealed-value'),
        validate: () =>
          Promise.reject(new AuthError(AUTH_ERROR_CODES.SESSION_EXPIRED, { message: 'expired' })),
      },
    });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status === 'unauthenticated') {
      expect(outcome.code).toBe('AUTH_SESSION_EXPIRED');
    }
  });

  it('propagates non-auth failures (never silently renders the landing for a broken boundary)', async () => {
    await expect(
      resolveSessionCockpit({
        probe: {
          cookieValue: () => Promise.reject(new Error('boundary exploded')),
          validate: () => Promise.reject(new Error('unreachable')),
        },
      }),
    ).rejects.toThrow('boundary exploded');
  });

  it('resolves facts from the VALIDATED session workspace context', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['owner', 'operator']);
    const outcome = await resolveSessionCockpit({
      probe: fixture.probe,
      readModel: fixture.readModel,
    });
    expect(outcome.status).toBe('authenticated');
    if (outcome.status !== 'authenticated') return;
    expect(outcome.facts.tenantId).toBe('tenant-alpha');
    expect(outcome.facts.workspaceId).toBe('tenant-alpha-ws');
    expect(outcome.facts.principalLabel).toBe('worker-one');
    expect(outcome.facts.grantedRoleIds).toEqual(['operator', 'owner']);
  });

  it('reads tenant-scoped canonical records THROUGH the B005 boundary', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['owner']);
    await fixture.repository.insert({
      recordId: 'case-1',
      tenantId: 'tenant-alpha',
      kind: 'capability-case',
      version: 1,
      data: { title: 'Payments reliability', stateKind: 'pending' },
    });
    await fixture.repository.insert({
      recordId: 'case-other-tenant',
      tenantId: 'tenant-beta',
      kind: 'capability-case',
      version: 1,
      data: { title: 'Foreign case' },
    });
    const outcome = await resolveSessionCockpit({
      probe: fixture.probe,
      readModel: fixture.readModel,
    });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const page = await outcome.port.scroll('capability-case');
    expect(page.records.map((record) => record.recordId)).toEqual(['case-1']);
    const read = await outcome.port.read('case-1');
    expect(read.data).toMatchObject({ title: 'Payments reliability' });
    // Cross-tenant read fails closed through the boundary's typed error envelope.
    await expect(outcome.port.read('case-other-tenant')).rejects.toThrow(/cockpit read failed/);
    const inventory = await outcome.port.inventory();
    expect(inventory.kinds.map((entry) => entry.kind)).toContain('capability-case');
  });

  it('fails closed on a missing record (error envelope -> typed throw, no partial data)', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['owner']);
    const outcome = await resolveSessionCockpit({
      probe: fixture.probe,
      readModel: fixture.readModel,
    });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    await expect(outcome.port.read('does-not-exist')).rejects.toThrow(/cockpit read failed/);
  });
});

describe('createReadApiPort (the B005 envelope adapter)', () => {
  it('surfaces the sealed cookie value as the boundary session token', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['owner']);
    await fixture.repository.insert({
      recordId: 'body-1',
      tenantId: 'tenant-alpha',
      kind: 'agent-body',
      version: 1,
      data: { displayName: 'Body One' },
    });
    const { createReadApiService } = await import('../../../../services/api-read/src/index.js');
    const seen: string[] = [];
    const api = createReadApiService({
      auth: {
        validateSession: async (token: string) => {
          seen.push(token);
          return { tenantId: 'tenant-alpha' };
        },
      },
      readModel: fixture.readModel,
    });
    const port: CockpitReadPort = createReadApiPort({ api, sessionToken: fixture.cookieValue });
    await port.inventory();
    expect(seen).toEqual([fixture.cookieValue]);
  });
});

describe('sessionFacts (permission policy carried, never interpreted)', () => {
  it('projects the workspace context and never mutates it', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['owner', 'expert']);
    const session = await fixture.probe.validate(fixture.cookieValue);
    const before = JSON.stringify(session.workspaceContext);
    const facts = sessionFacts(session);
    expect(facts.grantedRoleIds).toEqual(['expert', 'owner']);
    expect(JSON.stringify(session.workspaceContext)).toBe(before);
  });

  it('fails closed when the session and workspace tenants disagree', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['owner']);
    const session = await fixture.probe.validate(fixture.cookieValue);
    const forged = { ...session, tenantId: 'tenant-beta' } as typeof session;
    expect(() => sessionFacts(forged)).toThrow(/does not match workspace tenant/);
  });
});

describe('getDemoCockpitContext (B006 demo posture)', () => {
  it('serves the reserved demo tenant with deterministic demo lens grants', async () => {
    const context = await getDemoCockpitContext();
    expect(context.facts.tenantId).toBe('arena-demo');
    expect(context.facts.workspaceId).toBe('demo-workspace');
    expect(context.facts.principalLabel).toBe('demo-visitor');
    expect([...context.facts.grantedRoleIds].sort()).toEqual([
      'administrator',
      'agent-builder',
      'evaluator',
      'expert',
      'marketplace-participant',
      'operator',
      'owner',
      'researcher',
    ]);
    expect(typeof context.corpusHash).toBe('string');
  });

  it('reads the demo corpus through the canonical read path', async () => {
    const context = await getDemoCockpitContext();
    const page = await context.port.scroll('capability-case');
    expect(page.records.map((record) => record.recordId)).toEqual([
      'demo.capability-case.payments-reliability',
    ]);
    const inventory = await context.port.inventory();
    const kinds = inventory.kinds.map((entry) => `${entry.kind}:${String(entry.count)}`);
    expect(kinds).toContain('agent-body:2');
    expect(kinds).toContain('certification:1');
    expect(kinds).toContain('expert-qualification:1');
  });

  it('is deterministic across repeated context resolutions', async () => {
    const first = await getDemoCockpitContext();
    const second = await getDemoCockpitContext();
    expect(first.corpusHash).toBe(second.corpusHash);
    expect(JSON.stringify(first.facts)).toBe(JSON.stringify(second.facts));
  });
});
