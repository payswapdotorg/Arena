import { describe, expect, it } from 'vitest';

/**
 * Assigned-work discovery tests (Work Order B009): assignment rows come
 * from CANONICAL READS through the B005 boundary with truthful state
 * classification on every row; assignment identity filtering; honest
 * empty/unrecognized states; demo determinism.
 */

import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import {
  FakeControlPlaneRepository,
  ManualClock,
} from '../../../../packages/persistence/src/index.js';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import { resetDemoRuntime } from '../demo/runtime.js';
import { getDemoExpertContext, resolveExpertSession } from './runtime.js';
import { buildAssignedCasesView, buildAssignedWorkView, taskHref } from './assignment.js';
import type { SessionProbe } from './runtime.js';

const T = '2026-10-01T08:00:00.000Z';
const TENANT = 'tenant-alpha';

async function buildProbe(roleIds: readonly string[]): Promise<{
  probe: SessionProbe;
  repository: FakeControlPlaneRepository;
}> {
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
          tenantScope: TENANT,
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
    tenantId: TENANT,
    workspaceContext: createWorkspaceContext({
      identityId: 'expert-1',
      tenantId: TENANT,
      workspaceId: 'tenant-alpha-ws',
      permissionPolicy: createPermissionPolicy({
        policyId: 'policy',
        tenantId: TENANT,
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: roleIds.map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: 'expert-1',
          tenantId: TENANT,
          roleId,
          policyId: 'policy',
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ),
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'expert-1' } }),
  });
  const repository = new FakeControlPlaneRepository({ clock });
  return {
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
    repository,
  };
}

async function seedCaseRepository(repository: FakeControlPlaneRepository): Promise<void> {
  await repository.insert({
    recordId: 'case-payments',
    tenantId: TENANT,
    kind: 'capability-case',
    version: 1,
    data: {
      caseId: 'case-payments-reliability',
      title: 'Payments reliability',
      lifecycle: 'active',
      tasks: [
        { taskId: 'task-reproduce', title: 'Reproduce the timeout', state: 'completed' },
        {
          taskId: 'task-review',
          title: 'Human review of the change',
          state: 'in-review',
          assignedExpertId: 'expert-1',
        },
        {
          taskId: 'task-other-review',
          title: 'Review for another expert',
          state: 'pending',
          assignedExpertId: 'someone-else',
        },
        { taskId: 'task-audit', title: 'Audit trail check', state: 'awaiting-signature' },
        { title: 'malformed entry without an id', state: 'pending' },
      ],
    },
  });
  await repository.insert({
    recordId: 'qual-structural',
    tenantId: TENANT,
    kind: 'expert-qualification',
    version: 1,
    data: {
      qualificationId: 'qual-structural-review',
      domain: 'structural-engineering',
      scope: ['load-model review'],
      judgment: {
        kind: 'expert-judgment',
        stateKind: 'expert-judgment',
        summary: 'Fit for review triage; final sign-off remains a human expert.',
        basis: 'suite + expert review',
      },
      qualifiedAt: T,
    },
  });
}

describe('buildAssignedWorkView (session posture — canonical reads, truthful rows)', () => {
  it('lists assignment rows from the canonical case reads with truthful state classification', async () => {
    const { probe, repository } = await buildProbe(['expert']);
    await seedCaseRepository(repository);
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildAssignedWorkView({ mode: 'session', facts: outcome.facts, port: outcome.port });

    expect(view.assignments.map((row) => row.taskId)).toEqual([
      'task-reproduce',
      'task-review',
      'task-audit',
    ]);
    const review = view.assignments.find((row) => row.taskId === 'task-review');
    if (review === undefined) throw new Error('expected task-review row');
    expect(review.taskState.value).toBe('in-review');
    expect(review.taskStateClass).toBe('awaiting-expert');
    expect(review.taskState.recognized).toBe(true);
    expect(review.lifecycle.value).toBe('active');
    expect(review.lifecycle.recognized).toBe(true);
    expect(review.caseTitle).toBe('Payments reliability');
    expect(review.assignedExpertId).toBe('expert-1');
    expect(review.href).toBe(taskHref('session', 'task-review', 'case-payments'));
    expect(review.truth.kind).toBe('unknown'); // honest: record carries no stateKind
    expect(review.demo).toBe(false);
  });

  it('EXCLUDES tasks the record assigns to another expert (assignment identity from the record)', async () => {
    const { probe, repository } = await buildProbe(['expert']);
    await seedCaseRepository(repository);
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildAssignedWorkView({ mode: 'session', facts: outcome.facts, port: outcome.port });
    expect(view.assignments.some((row) => row.taskId === 'task-other-review')).toBe(false);
    expect(view.assignments.some((row) => row.taskId === 'task-review')).toBe(true);
  });

  it('groups open vs done work and keeps unknown task states visible-but-unknown', async () => {
    const { probe, repository } = await buildProbe(['expert']);
    await seedCaseRepository(repository);
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildAssignedWorkView({ mode: 'session', facts: outcome.facts, port: outcome.port });
    expect(view.openAssignments.map((row) => row.taskId)).toEqual(['task-review']);
    expect(view.doneAssignments.map((row) => row.taskId)).toEqual(['task-reproduce']);
    expect(view.unknownAssignments.map((row) => row.taskId)).toEqual(['task-audit']);
    const audit = view.unknownAssignments.find((row) => row.taskId === 'task-audit');
    if (audit === undefined) throw new Error('expected task-audit row');
    expect(audit.taskStateClass).toBe('unknown');
    expect(audit.taskState.recognized).toBe(false);
    expect(audit.taskState.value).toBe('awaiting-signature'); // verbatim, never guessed
    expect(view.unrecognizedTaskEntries).toBe(1); // the malformed entry, counted not guessed
  });

  it('renders the qualification panel from canonical reads (qualification as judgment data)', async () => {
    const { probe, repository } = await buildProbe(['expert']);
    await seedCaseRepository(repository);
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildAssignedWorkView({ mode: 'session', facts: outcome.facts, port: outcome.port });
    expect(view.qualifications).toHaveLength(1);
    const qualification = view.qualifications[0];
    if (qualification === undefined) throw new Error('expected qualification');
    expect(qualification.domain).toBe('structural-engineering');
    expect(qualification.scope).toEqual(['load-model review']);
    expect(qualification.truth.kind).toBe('expert-judgment'); // via the carried stateKind
    expect(view.qualificationNote).toContain('never an authorization');
  });

  it('renders honest empty states when the workspace carries no cases or qualifications', async () => {
    const { probe, repository } = await buildProbe(['expert']);
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildAssignedWorkView({ mode: 'session', facts: outcome.facts, port: outcome.port });
    expect(view.assignments).toEqual([]);
    expect(view.emptyKinds).toEqual(['expert-qualification', 'capability-case']);
    expect(view.inventory.kinds).toEqual([]);
  });

  it('never fabricates rows for records in OTHER tenants (tenant from the session)', async () => {
    const { probe, repository } = await buildProbe(['expert']);
    await repository.insert({
      recordId: 'case-foreign',
      tenantId: 'tenant-beta',
      kind: 'capability-case',
      version: 1,
      data: { title: 'Foreign case', tasks: [{ taskId: 't', title: 'T', state: 'pending' }] },
    });
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildAssignedWorkView({ mode: 'session', facts: outcome.facts, port: outcome.port });
    expect(view.assignments).toEqual([]);
  });
});

describe('buildAssignedCasesView (case-level rollup, /cases expert lens)', () => {
  it('rolls up per-case task counts with honest unknown counting', async () => {
    const { probe, repository } = await buildProbe(['expert']);
    await seedCaseRepository(repository);
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildAssignedCasesView({ mode: 'session', facts: outcome.facts, port: outcome.port });
    expect(view.cases).toHaveLength(1);
    const row = view.cases[0];
    if (row === undefined) throw new Error('expected case row');
    expect(row.caseTitle).toBe('Payments reliability');
    expect(row.lifecycle.value).toBe('active');
    expect(row.taskTotal).toBe(4); // the malformed entry is counted, not a task
    expect(row.taskOpen).toBe(2); // task-review + task-audit
    expect(row.taskUnknown).toBe(1); // task-audit carries an unrecognized state
    expect(view.unrecognizedTaskEntries).toBe(1);
  });
});

describe('buildAssignedWorkView (demo posture — B006 corpus, deterministic)', () => {
  it('surfaces the demo case\u2019s tasks with the corpus\u2019s own truth labels', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const view = await buildAssignedWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      corpusHash: context.corpusHash,
    });
    expect(view.mode).toBe('demo');
    expect(view.demo.isDemo).toBe(true);
    expect(view.demo.corpusHash).toBe(context.corpusHash);
    expect(view.assignments.map((row) => row.taskId)).toEqual([
      'task-reproduce',
      'task-patch',
      'task-review',
    ]);
    const review = view.assignments.find((row) => row.taskId === 'task-review');
    if (review === undefined) throw new Error('expected task-review row');
    expect(review.taskState.value).toBe('in-review');
    expect(review.taskStateClass).toBe('awaiting-expert');
    expect(review.truth.kind).toBe('simulation-replay'); // the corpus's own label for the demo case
    expect(review.demo).toBe(true);
    expect(review.href).toBe(taskHref('demo', 'task-review', 'demo.capability-case.payments-reliability'));
    expect(view.qualifications).toHaveLength(1);
    expect(view.qualifications[0]?.truth.kind).toBe('expert-judgment');
  });

  it('is byte-identical across two builds (determinism)', async () => {
    const context = await getDemoExpertContext();
    const first = await buildAssignedWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      corpusHash: context.corpusHash,
    });
    const second = await buildAssignedWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      corpusHash: context.corpusHash,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
