import { describe, expect, it } from 'vitest';

/**
 * Body Studio runtime tests (Work Order B010) — the house style: plain
 * node environment, REAL composed boundaries (the B004 local auth stack,
 * the B002 fakes, the B005 read-model service + read-API boundary),
 * injected session probes (no next/headers request scope needed), and the
 * REAL B006 demo runtime for the demo composition.
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
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  getDemoBodyStudioContext,
  resetDemoBodyStudioContext,
  resolveSessionBodyStudio,
} from './runtime.js';
import type { SessionProbe } from './runtime.js';

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

async function buildSessionFixture(tenantId: string, roleIds: readonly string[]) {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'test-session-secret-0123456789abcdefghijklmnop',
    credentials: [
      {
        credential: createAuthMethodDescriptor({
          method: 'test-login',
          claims: { who: 'worker-1' },
        }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'worker-1',
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-owner'],
          label: 'worker-1',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({
    method: 'test-login',
    claims: { who: 'worker-1' },
  });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId,
    workspaceContext: buildWorkspace(tenantId, roleIds),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
  });
  const repository = new FakeControlPlaneRepository({ clock });
  const readModel = new ReadModelService({ repository, clock });
  // Seed one canonical agent-body record (the B005 write path).
  await repository.insert({
    recordId: `body-${tenantId}-1`,
    tenantId,
    kind: 'agent-body',
    version: 1,
    data: {
      bodyId: 'body-x',
      displayName: 'Body X',
      lineage: { initialVersion: '1.0.0', currentVersion: '1.0.0' },
      manifestSummary: { skills: 1, knowledge: 1, tools: 1 },
      toolNames: ['tool-1'],
      substratePossessions: [
        { possessionId: 'p1', substrate: 'substrate-x', grantedTo: 'body-x@1.0.0', scope: 'composition-scoped' },
      ],
    },
  });
  const probe: SessionProbe = {
    cookieValue: async () => issuance.cookie.value,
    validate: (token: string) => auth.service.validateSession(token),
  };
  return { probe, readModel, tenantId };
}

describe('session body studio composition (fail closed through B004)', () => {
  it('resolves an authenticated session into facts + a canonical read port (positive)', async () => {
    const fixture = await buildSessionFixture('tenant-a', ['agent-builder', 'researcher']);
    const outcome = await resolveSessionBodyStudio({
      probe: fixture.probe,
      readModel: fixture.readModel,
    });
    expect(outcome.status).toBe('authenticated');
    if (outcome.status !== 'authenticated') return;
    expect(outcome.facts.tenantId).toBe('tenant-a');
    expect(outcome.facts.grantedRoleIds).toContain('agent-builder');
    const page = await outcome.port.scroll('agent-body');
    expect(page.records.map((record) => record.recordId)).toEqual(['body-tenant-a-1']);
    const read = await outcome.port.read('body-tenant-a-1');
    expect(read.kind).toBe('agent-body');
  });

  it('fails CLOSED on a bad cookie — typed AUTH_* outcome, never an anonymous studio (negative)', async () => {
    const fixture = await buildSessionFixture('tenant-b', ['owner']);
    const outcome = await resolveSessionBodyStudio({
      probe: {
        cookieValue: async () => 'not-a-sealed-session-cookie',
        validate: fixture.probe.validate,
      },
      readModel: fixture.readModel,
    });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status !== 'unauthenticated') return;
    expect(outcome.code.startsWith('AUTH_')).toBe(true);
  });

  it('fails CLOSED with no cookie at all (negative)', async () => {
    const outcome = await resolveSessionBodyStudio({
      probe: { cookieValue: async () => null, validate: async () => { throw new Error('never called'); } },
    });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status !== 'unauthenticated') return;
    expect(outcome.code).toBe('AUTH_SESSION_NOT_FOUND');
  });
});

describe('demo body studio composition (B006 runtime, reserved tenant)', () => {
  it('composes over the reserved demo tenant with the deterministic corpus hash (positive)', async () => {
    resetDemoBodyStudioContext();
    const context = await getDemoBodyStudioContext();
    expect(context.facts.tenantId).toBe('arena-demo');
    expect(context.facts.principalLabel).toBe('demo-visitor');
    expect(context.facts.grantedRoleIds.length).toBe(8);
    expect(typeof context.corpusHash).toBe('string');
    const page = await context.port.scroll('agent-body');
    expect(page.records.map((record) => record.recordId)).toEqual([
      'demo.agent-body.software-engineer',
      'demo.agent-body.structural-engineer',
    ]);
  });

  it('is deterministic across recompositions (positive)', async () => {
    resetDemoBodyStudioContext();
    const first = await getDemoBodyStudioContext();
    const hashOne = first.corpusHash;
    resetDemoBodyStudioContext();
    const second = await getDemoBodyStudioContext();
    expect(second.corpusHash).toBe(hashOne);
  });
});
