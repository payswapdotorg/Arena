import { describe, expect, it } from 'vitest';

/**
 * Capability runtime tests (Work Order B008) — the B007 house style:
 * plain node environment, REAL composed boundaries (the B004 local auth
 * stack, the B002 fakes, the B005 read-model + read-API boundary, the
 * product-flows runtime over the same repository), injected session
 * probes (no next/headers request scope needed).
 */

import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import { FakeControlPlaneRepository, ManualClock } from '../../../../packages/persistence/src/index.js';
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
  getDemoCapabilityContext,
  getLocalControlPlane,
  resetDemoCapabilityContext,
  resetLocalControlPlane,
  resolveSessionCapability,
} from './runtime.js';
import type { SessionProbe } from '../cockpit/runtime.js';

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

async function buildSessionFixture(
  tenantId: string,
  roleIds: readonly string[],
): Promise<{
  readonly probe: SessionProbe;
  readonly repository: FakeControlPlaneRepository;
  readonly readModel: ReadModelService;
}> {
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
  const repository = new FakeControlPlaneRepository({ clock });
  const readModel = new ReadModelService({ repository, clock });
  return {
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
    repository,
    readModel,
  };
}

describe('resolveSessionCapability (fail closed; B005 reads; flows over the same repository)', () => {
  it('is unauthenticated when no session cookie is present (never an anonymous surface)', async () => {
    const outcome = await resolveSessionCapability({
      probe: { cookieValue: () => Promise.resolve(null), validate: () => Promise.reject(new Error('unreachable')) },
    });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status === 'unauthenticated') {
      expect(outcome.code).toBe('AUTH_SESSION_NOT_FOUND');
    }
  });

  it('is unauthenticated on a typed AUTH_* validation failure (fail closed)', async () => {
    const outcome = await resolveSessionCapability({
      probe: {
        cookieValue: () => Promise.resolve('tampered-cookie'),
        validate: () =>
          Promise.reject(new AuthError(AUTH_ERROR_CODES.SESSION_EXPIRED, { message: 'expired' })),
      },
    });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status === 'unauthenticated') {
      expect(outcome.code).toBe(AUTH_ERROR_CODES.SESSION_EXPIRED);
    }
  });

  it('authenticates: facts from the session, reads through the B005 boundary, flow over the same repository', async () => {
    const fixture = await buildSessionFixture('tenant-alpha', ['owner', 'expert']);
    const outcome = await resolveSessionCapability({
      probe: fixture.probe,
      readModel: fixture.readModel,
      repository: fixture.repository,
    });
    expect(outcome.status).toBe('authenticated');
    if (outcome.status !== 'authenticated') return;
    expect(outcome.facts.tenantId).toBe('tenant-alpha');
    expect(outcome.facts.principalLabel).toBe('worker-one');
    expect([...outcome.facts.grantedRoleIds].sort()).toEqual(['expert', 'owner']);
    // Writes through the flow runtime land in the SAME repository the read
    // port reads through — one store, no parallel write path.
    const T0 = '2026-10-01T09:00:00.000Z';
    const start = await outcome.flow.startCase({
      identity: { tenant: 'tenant-alpha', caseId: 'case-flow-visible' },
      version: '1.0.0',
      source: { type: 'user', tenant: 'tenant-alpha', principalId: 'worker-1' },
      problemStatement: 'The agent cannot net credit notes against partially paid invoices.',
      targetCapability: {
        kind: 'capability',
        id: 'invoice-reconciliation',
        version: '1.2.0',
        digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      domain: { kind: 'domain', id: 'accounts-payable', version: '1.0.0', digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      context: 'Monthly close workload.',
      observedFailure: {
        summary: 'Agent marked a partially paid invoice fully settled.',
        observedAt: T0,
        reproduction: 'Run the close with one credit note open.',
      },
      evidence: [
        { digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', description: 'Trajectory export.' },
      ],
      unknowns: ['Whether the ERP nets on export'],
      desiredOutcome: 'Netting applied and explained in the summary.',
      expertRequirements: {
        competencies: [
          { kind: 'expert-competency', id: 'ap-reconciliation', version: '1.0.0', digest: '1212121212121212121212121212121212121212121212121212121212121212' },
        ],
        qualifications: ['certified-accountant'],
      },
      environmentRequirements: {
        environments: [
          { namespace: 'tenant-alpha', name: 'erp-close-sandbox', version: '1.4.0', digest: '3434343434343434343434343434343434343434343434343434343434343434' },
        ],
        constraints: ['No live ERP writes'],
      },
      taskRequirements: {
        objectives: ['Reconcile credit notes'],
        constraints: ['Use only the ERP export snapshot'],
        allowedTools: [
          { namespace: 'tenant-alpha', name: 'erp-export-reader', version: '1.0.0', digest: '5656565656565656565656565656565656565656565656565656565656565656' },
        ],
        forbiddenShortcuts: ['Assume full settlement'],
        successConditions: ['Netted total matches ERP balance'],
        evidenceCriteria: ['Annotated trajectory'],
        difficulty: 'standard',
      },
      evaluationRequirements: {
        evaluators: [
          { kind: 'evaluator', id: 'reconciliation-accuracy', version: '1.0.0', digest: '7878787878787878787878787878787878787878787878787878787878787878' },
        ],
        criteria: ['Netting accuracy >= 99%'],
      },
      verificationRequirements: {
        verifiers: [
          { kind: 'verifier', id: 'erp-balance-check', version: '1.0.0', digest: '9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a' },
        ],
        evidenceStandards: ['Balance proof from the sandbox'],
      },
      provenance: { recordDigest: 'bc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1d' },
      priority: 'high',
      risk: 'moderate',
      createdAt: T0,
    });
    expect(start.caseRecord.status).toBe('draft');
    const page = await outcome.port.scroll('capability-case');
    expect(page.records.map((record) => record.recordId)).toContain('case.tenant-alpha.case-flow-visible');
  });

  it('the local posture is a stable per-process singleton repository (no second store)', () => {
    resetLocalControlPlane();
    const one = getLocalControlPlane();
    const two = getLocalControlPlane();
    expect(one).toBe(two);
  });
});

describe('getDemoCapabilityContext (B006 posture; canonical reads; demo labelling)', () => {
  it('composes demo facts + reads + flow over the demo store repository', async () => {
    resetDemoCapabilityContext();
    const context = await getDemoCapabilityContext();
    expect(context.facts.tenantId).toBe('arena-demo');
    expect(context.facts.principalLabel).toBe('demo-visitor');
    expect(context.facts.grantedRoleIds.length).toBe(8);
    // The demo corpus case record reads through the canonical path.
    const page = await context.port.scroll('capability-case');
    expect(page.records.map((record) => record.recordId)).toContain(
      'demo.capability-case.payments-reliability',
    );
    expect(typeof context.corpusHash).toBe('string');
  });
});
