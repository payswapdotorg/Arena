import { describe, expect, it } from 'vitest';

/**
 * Expert evidence submission tests (Work Order B009) — the WRITE path:
 * appends through the B002 ControlPlaneRepository port, append-only (the
 * case record and every task/run state is untouched), provenance-shaped,
 * idempotent under replay, and read back THROUGH the canonical read path.
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
import type { ExpertReadPort, ExpertSessionFacts } from './runtime.js';
import {
  EXPERT_EVIDENCE_ERROR_CODES,
  EXPERT_EVIDENCE_KIND,
  EXPERT_EVIDENCE_MAX_LEDGER,
  EXPERT_EVIDENCE_VERDICTS,
  expertEvidenceRecordId,
  readExpertEvidenceLedger,
  submitExpertEvidence,
} from './evidence.js';
import { ExpertEvidenceError } from './evidence.js';
import type { ExpertEvidenceVerdict } from './evidence.js';
import type { SessionProbe } from './runtime.js';

const T = '2026-10-01T08:00:00.000Z';
const TENANT = 'tenant-alpha';

async function buildProbe(): Promise<{
  readonly probe: SessionProbe;
  readonly repository: FakeControlPlaneRepository;
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
      grantedRoles: [
        grantRole({
          grantId: 'grant-expert',
          identityId: 'expert-1',
          tenantId: TENANT,
          roleId: 'expert',
          policyId: 'policy',
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ],
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'expert-1' } }),
  });
  return {
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
    repository: new FakeControlPlaneRepository({ clock }),
  };
}

async function buildSession(): Promise<{
  readonly repository: FakeControlPlaneRepository;
  readonly deps: {
    readonly repository: FakeControlPlaneRepository;
    readonly port: ExpertReadPort;
    readonly facts: ExpertSessionFacts;
  };
  readonly port: ExpertReadPort;
}> {
  const { probe, repository } = await buildProbe();
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
      ],
    },
  });
  const outcome = await resolveExpertSession({ probe, repository });
  if (outcome.status !== 'authenticated') throw new Error('expected authentication');
  return {
    repository,
    port: outcome.port,
    deps: { repository, port: outcome.port, facts: outcome.facts },
  };
}

describe('submitExpertEvidence (append through the B002 port)', () => {
  it('appends a provenance-shaped expert-judgment record and reads it back through the canonical read path', async () => {
    const session = await buildSession();
    const result = await submitExpertEvidence(
      session.deps,
      {
        caseRecordId: 'case-payments',
        taskId: 'task-review',
        verdict: 'endorsement',
        summary: 'The change is minimal and the regression tests cover the jitter bounds.',
        basis: 'I reviewed the trajectory replay and the recorded evaluation suite result.',
      },
    );
    expect(result.created).toBe(true);
    expect(result.sequence).toBe(1);
    expect(result.record.kind).toBe(EXPERT_EVIDENCE_KIND);
    expect(result.record.tenantId).toBe(TENANT);
    expect(result.record.recordId).toBe('expert-evidence.case-payments.task-review.0001');
    const data = result.record.data as Record<string, unknown>;
    expect(data['caseRecordId']).toBe('case-payments');
    expect(data['taskId']).toBe('task-review');
    expect(data['submittedBy']).toBe('expert-1');
    const judgment = data['judgment'] as Record<string, unknown>;
    expect(judgment['stateKind']).toBe('expert-judgment');
    expect(judgment['verdict']).toBe('endorsement');
    // Read back through the B005 boundary (by-id canonical read).
    const ledger = await readExpertEvidenceLedger(session.port, 'case-payments', 'task-review');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.summary).toContain('minimal');
    expect(ledger[0]?.verdict).toBe('endorsement');
    expect(ledger[0]?.submittedBy).toBe('expert-1');
  });

  it('NEVER mutates the case record (append-only: task/run/evaluation state untouched)', async () => {
    const session = await buildSession();
    const before = await session.repository.get('case-payments');
    await submitExpertEvidence(
      session.deps,
      {
        caseRecordId: 'case-payments',
        taskId: 'task-review',
        verdict: 'objection',
        summary: 'The retry cap rationale is not recorded.',
        basis: 'Trajectory replay, step 5.',
      },
    );
    const after = await session.repository.get('case-payments');
    expect(after?.revision).toBe(before?.revision); // no update happened
    expect(JSON.stringify(after?.data)).toBe(JSON.stringify(before?.data));
    // The task state in the canonical record is still in-review.
    const tasks = (after?.data as Record<string, unknown>)['tasks'] as { taskId: string; state: string }[];
    expect(tasks.find((task) => task.taskId === 'task-review')?.state).toBe('in-review');
  });

  it('is idempotent under replay: the identical submission addresses the SAME slot', async () => {
    const session = await buildSession();
    const deps = session.deps;
    const input = {
      caseRecordId: 'case-payments',
      taskId: 'task-review',
      verdict: 'observation',
      summary: 'Retry storms coincide with cron.',
      basis: 'Trajectory replay, step 4.',
    } as const;
    const first = await submitExpertEvidence(deps, input);
    const second = await submitExpertEvidence(deps, input);
    expect(second.created).toBe(false); // the port's idempotent replay
    expect(second.record.recordId).toBe(first.record.recordId);
    expect(second.sequence).toBe(first.sequence);
    expect(await session.repository.count({ kind: EXPERT_EVIDENCE_KIND })).toBe(1);
  });

  it('sequences distinct submissions as an append-only ledger (0001, 0002, …)', async () => {
    const session = await buildSession();
    const deps = session.deps;
    await submitExpertEvidence(deps, {
      caseRecordId: 'case-payments',
      taskId: 'task-review',
      verdict: 'observation',
      summary: 'First observation.',
      basis: 'Trajectory replay.',
    });
    const second = await submitExpertEvidence(deps, {
      caseRecordId: 'case-payments',
      taskId: 'task-review',
      verdict: 'endorsement',
      summary: 'Second judgment.',
      basis: 'Evaluation suite result.',
    });
    expect(second.sequence).toBe(2);
    expect(second.record.recordId).toBe('expert-evidence.case-payments.task-review.0002');
    const ledger = await readExpertEvidenceLedger(session.port, 'case-payments', 'task-review');
    expect(ledger.map((card) => card.sequence)).toEqual([1, 2]);
    expect(ledger[0]?.createdAt).toBe(DEMO_NARRATIVE_EPOCH_MS); // repository-stamped provenance
  });

  it('fails closed on a verdict outside the closed vocabulary (never guessed into the ledger)', async () => {
    const session = await buildSession();
    await expect(
      submitExpertEvidence(
        session.deps,
        {
          caseRecordId: 'case-payments',
          taskId: 'task-review',
          verdict: 'pass' as unknown as ExpertEvidenceVerdict,
          summary: 'Looks good.',
          basis: 'Review.',
        },
      ),
    ).rejects.toThrow(ExpertEvidenceError);
    expect(await session.repository.count({ kind: EXPERT_EVIDENCE_KIND })).toBe(0);
  });

  it('fails closed when the case record does not carry the task', async () => {
    const session = await buildSession();
    let code = '';
    try {
      await submitExpertEvidence(
        session.deps,
        {
          caseRecordId: 'case-payments',
          taskId: 'task-does-not-exist',
          verdict: 'observation',
          summary: 'Nothing.',
          basis: 'Nothing.',
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ExpertEvidenceError);
      code = (error as ExpertEvidenceError).code;
    }
    expect(code).toBe(EXPERT_EVIDENCE_ERROR_CODES.TASK_NOT_FOUND);
  });

  it('accepts a task with NO named assignee (open to the expert lens — assignment identity from the record)', async () => {
    const session = await buildSession();
    const result = await submitExpertEvidence(
      session.deps,
      {
        caseRecordId: 'case-payments',
        taskId: 'task-reproduce',
        verdict: 'observation',
        summary: 'The timeout reproduces under load.',
        basis: 'Trajectory replay, steps 1-4.',
      },
    );
    expect(result.created).toBe(true);
    expect(result.record.recordId).toBe('expert-evidence.case-payments.task-reproduce.0001');
    await session.repository.delete(result.record.recordId);
  });

  it('fails closed when the task is assigned to another expert', async () => {
    const { probe, repository } = await buildProbe();
    await repository.insert({
      recordId: 'case-other',
      tenantId: TENANT,
      kind: 'capability-case',
      version: 1,
      data: {
        title: 'Other case',
        lifecycle: 'active',
        tasks: [
          { taskId: 'task-x', title: 'X', state: 'pending', assignedExpertId: 'someone-else' },
        ],
      },
    });
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    let code = '';
    try {
      await submitExpertEvidence(
        { repository, port: outcome.port, facts: outcome.facts },
        {
          caseRecordId: 'case-other',
          taskId: 'task-x',
          verdict: 'observation',
          summary: 'Nope.',
          basis: 'Nope.',
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ExpertEvidenceError);
      code = (error as ExpertEvidenceError).code;
    }
    expect(code).toBe(EXPERT_EVIDENCE_ERROR_CODES.NOT_ASSIGNED);
  });

  it('rejects empty judgments (an evidence record never carries a fabricated judgment)', async () => {
    const session = await buildSession();
    await expect(
      submitExpertEvidence(
        session.deps,
        {
          caseRecordId: 'case-payments',
          taskId: 'task-review',
          verdict: 'observation',
          summary: '   ',
          basis: 'nothing',
        },
      ),
    ).rejects.toThrow(ExpertEvidenceError);
  });

  it('fails closed at the bounded ledger depth (never an unbounded scan/append)', async () => {
    const session = await buildSession();
    for (let index = 1; index <= EXPERT_EVIDENCE_MAX_LEDGER; index += 1) {
      await session.repository.insert({
        recordId: expertEvidenceRecordId('case-payments', 'task-review', index),
        tenantId: TENANT,
        kind: EXPERT_EVIDENCE_KIND,
        version: 1,
        data: { judgment: { verdict: 'observation', summary: 'x', basis: 'x' } },
      });
    }
    let code = '';
    try {
      await submitExpertEvidence(
        session.deps,
        {
          caseRecordId: 'case-payments',
          taskId: 'task-review',
          verdict: 'observation',
          summary: 'One too many.',
          basis: 'Test bound.',
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ExpertEvidenceError);
      code = (error as ExpertEvidenceError).code;
    }
    expect(code).toBe(EXPERT_EVIDENCE_ERROR_CODES.LEDGER_OVERFLOW);
  });
});

describe('submitExpertEvidence (demo posture — the demo store\u2019s own B002 repository)', () => {
  it('appends into the demo repository under the frozen narrative clock (deterministic)', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const result = await submitExpertEvidence(
      { repository: context.repository, port: context.port, facts: context.facts },
      {
        caseRecordId: 'demo.capability-case.payments-reliability',
        taskId: 'task-review',
        verdict: 'endorsement',
        summary: 'The recorded trajectory supports the proposed change.',
        basis: 'Trajectory replay + evaluation suite record.',
      },
    );
    expect(result.created).toBe(true);
    expect(result.record.tenantId).toBe('arena-demo');
    expect(result.record.createdAt).toBe(DEMO_NARRATIVE_EPOCH_MS);
    const ledger = await readExpertEvidenceLedger(
      context.port,
      'demo.capability-case.payments-reliability',
      'task-review',
      { isDemo: true },
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.demo).toBe(true);
    // Cleanup: the demo corpus state must stay deterministic for other tests.
    await context.repository.delete(result.record.recordId);
  });

  it('does not touch the demo corpus records (append-only in the demo store too)', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const before = await context.repository.get('demo.capability-case.payments-reliability');
    await submitExpertEvidence(
      { repository: context.repository, port: context.port, facts: context.facts },
      {
        caseRecordId: 'demo.capability-case.payments-reliability',
        taskId: 'task-review',
        verdict: 'observation',
        summary: 'Deterministic observation.',
        basis: 'Replay.',
      },
    );
    const after = await context.repository.get('demo.capability-case.payments-reliability');
    expect(after?.revision).toBe(before?.revision);
    expect(JSON.stringify(after?.data)).toBe(JSON.stringify(before?.data));
    await context.repository.delete(
      expertEvidenceRecordId('demo.capability-case.payments-reliability', 'task-review', 1),
    );
  });
});

describe('readExpertEvidenceLedger (read-back THROUGH the canonical read path)', () => {
  it('renders an empty ledger honestly when nothing was appended', async () => {
    const session = await buildSession();
    const ledger = await readExpertEvidenceLedger(session.port, 'case-payments', 'task-reproduce');
    expect(ledger).toEqual([]);
  });

  it('renders a malformed verdict as unknown (carried, never guessed)', async () => {
    const session = await buildSession();
    await session.repository.insert({
      recordId: expertEvidenceRecordId('case-payments', 'task-reproduce', 1),
      tenantId: TENANT,
      kind: EXPERT_EVIDENCE_KIND,
      version: 1,
      data: {
        taskId: 'task-reproduce',
        caseRecordId: 'case-payments',
        submittedBy: 'someone',
        judgment: { stateKind: 'expert-judgment', verdict: 'pretty-good', summary: 's', basis: 'b' },
      },
    });
    const ledger = await readExpertEvidenceLedger(session.port, 'case-payments', 'task-reproduce');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.verdict).toBeUndefined(); // unknown, never coerced
  });

  it('carries the closed verdict vocabulary', () => {
    expect([...EXPERT_EVIDENCE_VERDICTS]).toEqual(['endorsement', 'objection', 'observation']);
  });
});
