import { describe, expect, it } from 'vitest';

/**
 * Expert workbench runtime tests (Work Order B009) — the house style:
 * plain node environment, REAL composed boundaries (the B004 local auth
 * stack, the B002 fakes, the B005 read-model service + read-API
 * boundary), injected session probes (no next/headers request scope
 * needed).
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
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  ExpertReadError,
  createReadApiPort,
  expertSessionFacts,
  getDemoExpertContext,
  getExpertWorkRepository,
  resetExpertWorkRepository,
  resolveExpertSession,
} from './runtime.js';
import type { SessionProbe } from './runtime.js';

const T = '2026-10-01T08:00:00.000Z';

function buildWorkspace(tenantId: string, roleIds: readonly string[]): WorkspaceContext {
  return createWorkspaceContext({
    identityId: 'expert-1',
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
        identityId: 'expert-1',
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
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'expert-1' } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'expert-1',
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-member'],
          label: 'expert-one',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({ method: 'test-login', claims: { who: 'expert-1' } });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId,
    workspaceContext: buildWorkspace(tenantId, roleIds),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'expert-1' } }),
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

describe('resolveExpertSession (fail closed; tenant from session; reads through B005)', () => {
  it('is unauthenticated when no session cookie is present (never an anonymous workbench)', async () => {
    const outcome = await resolveExpertSession({
      probe: { cookieValue: () => Promise.resolve(null), validate: () => Promise.reject(new Error('unreachable')) },
    });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status === 'unauthenticated') {
      expect(outcome.code).toBe('AUTH_SESSION_NOT_FOUND');
    }
  });

  it('is unauthenticated on a typed AUTH_* validation failure, with the code surfaced', async () => {
    const outcome = await resolveExpertSession({
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

  it('propagates non-auth failures (never silently renders a denied state for a broken boundary)', async () => {
    await expect(
      resolveExpertSession({
        probe: {
          cookieValue: () => Promise.reject(new Error('boundary exploded')),
          validate: () => Promise.reject(new Error('unreachable')),
        },
      }),
    ).rejects.toThrow('boundary exploded');
  });

  it('resolves facts from the VALIDATED session workspace context', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['expert', 'owner']);
    const outcome = await resolveExpertSession({
      probe: fixture.probe,
      repository: fixture.repository,
    });
    expect(outcome.status).toBe('authenticated');
    if (outcome.status !== 'authenticated') return;
    expect(outcome.facts.tenantId).toBe('tenant-alpha');
    expect(outcome.facts.workspaceId).toBe('tenant-alpha-ws');
    expect(outcome.facts.principalId).toBe('expert-1');
    expect(outcome.facts.principalLabel).toBe('expert-one');
    expect(outcome.facts.grantedRoleIds).toEqual(['expert', 'owner']);
  });

  it('exposes the B002 repository port for the WRITE path (same composition as the reads)', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['expert']);
    const outcome = await resolveExpertSession({
      probe: fixture.probe,
      repository: fixture.repository,
    });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    expect(outcome.repository).toBe(fixture.repository);
  });

  it('reads tenant-scoped canonical records THROUGH the B005 boundary', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['expert']);
    await fixture.repository.insert({
      recordId: 'case-1',
      tenantId: 'tenant-alpha',
      kind: 'capability-case',
      version: 1,
      data: { title: 'Payments reliability', tasks: [] },
    });
    await fixture.repository.insert({
      recordId: 'case-other-tenant',
      tenantId: 'tenant-beta',
      kind: 'capability-case',
      version: 1,
      data: { title: 'Foreign case' },
    });
    const outcome = await resolveExpertSession({
      probe: fixture.probe,
      repository: fixture.repository,
    });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const page = await outcome.port.scroll('capability-case');
    expect(page.records.map((record) => record.recordId)).toEqual(['case-1']);
    const read = await outcome.port.read('case-1');
    expect(read.data).toMatchObject({ title: 'Payments reliability' });
    const inventory = await outcome.port.inventory();
    expect(inventory.kinds.map((entry) => entry.kind)).toContain('capability-case');
  });

  it('fails closed on a missing record with a TYPED code (no partial data)', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['expert']);
    const outcome = await resolveExpertSession({
      probe: fixture.probe,
      repository: fixture.repository,
    });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    let code = '';
    try {
      await outcome.port.read('does-not-exist');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpertReadError);
      code = (error as ExpertReadError).code;
    }
    expect(code).toBe('READ_MODEL_RECORD_NOT_FOUND');
  });

  it('fails closed on a cross-tenant read with the TENANT_SCOPE code (existence never hidden)', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['expert']);
    await fixture.repository.insert({
      recordId: 'case-other-tenant',
      tenantId: 'tenant-beta',
      kind: 'capability-case',
      version: 1,
      data: { title: 'Foreign case' },
    });
    const outcome = await resolveExpertSession({
      probe: fixture.probe,
      repository: fixture.repository,
    });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    let code = '';
    try {
      await outcome.port.read('case-other-tenant');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpertReadError);
      code = (error as ExpertReadError).code;
    }
    expect(code).toBe('READ_MODEL_TENANT_SCOPE_VIOLATION');
  });
});

describe('expertSessionFacts (permission policy carried, never interpreted)', () => {
  it('projects the workspace context and never mutates it', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['expert']);
    const session = await fixture.probe.validate(fixture.cookieValue);
    const before = JSON.stringify(session.workspaceContext);
    const facts = expertSessionFacts(session);
    expect(facts.grantedRoleIds).toEqual(['expert']);
    expect(JSON.stringify(session.workspaceContext)).toBe(before);
  });

  it('fails closed when the session and workspace tenants disagree', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['expert']);
    const session = await fixture.probe.validate(fixture.cookieValue);
    const forged = { ...session, tenantId: 'tenant-beta' } as typeof session;
    expect(() => expertSessionFacts(forged)).toThrow(/does not match workspace tenant/);
  });
});

describe('createReadApiPort (the B005 envelope adapter)', () => {
  it('surfaces the sealed cookie value as the boundary session token', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['expert']);
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
    const port = createReadApiPort({ api, sessionToken: fixture.cookieValue });
    await port.inventory();
    expect(seen).toEqual([fixture.cookieValue]);
  });
});

describe('getExpertWorkRepository (local session-posture control plane)', () => {
  it('returns ONE in-memory fake per process (the canonical write path survives requests)', () => {
    resetExpertWorkRepository();
    const first = getExpertWorkRepository();
    expect(getExpertWorkRepository()).toBe(first);
    resetExpertWorkRepository();
    expect(getExpertWorkRepository()).not.toBe(first);
  });
});

describe('getDemoExpertContext (B006 demo posture)', () => {
  it('serves the reserved demo tenant with the demo visitor + demo lens grants', async () => {
    const context = await getDemoExpertContext();
    expect(context.facts.tenantId).toBe('arena-demo');
    expect(context.facts.workspaceId).toBe('demo-workspace');
    expect(context.facts.principalId).toBe('demo-visitor');
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
    const context = await getDemoExpertContext();
    const page = await context.port.scroll('capability-case');
    expect(page.records.map((record) => record.recordId)).toEqual([
      'demo.capability-case.payments-reliability',
    ]);
    const read = await context.port.read('demo.expert-qualification.structural-review');
    expect(read.kind).toBe('expert-qualification');
  });

  it('exposes the demo store\u2019s B002 repository as the demo WRITE path', async () => {
    const context = await getDemoExpertContext();
    const before = await context.repository.count({ tenantId: 'arena-demo' });
    await context.repository.insert({
      recordId: 'expert-evidence.demo-write-probe.0001',
      tenantId: 'arena-demo',
      kind: 'expert-evidence',
      version: 1,
      data: { probe: true },
    });
    expect(await context.repository.count({ tenantId: 'arena-demo' })).toBe(before + 1);
    // The appended record is readable back through the SAME canonical read path.
    const read = await context.port.read('expert-evidence.demo-write-probe.0001');
    expect(read.kind).toBe('expert-evidence');
    // Cleanup so determinism tests are unaffected.
    await context.repository.delete('expert-evidence.demo-write-probe.0001');
  });
});
