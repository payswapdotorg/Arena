import { describe, expect, it } from 'vitest';

/**
 * Workbench surface tests (Work Order B009): the case work lens and the
 * task execute/review view models — canonical reads with truthful
 * task/run/trajectory states, observation vs action vs tool vs result vs
 * model-output kept distinct, evaluation vs verification never collapsed,
 * honest not-found states, evidence ledger integration, demo determinism.
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
import { buildCaseWorkView, buildTaskWorkView } from './workbench.js';
import { submitExpertEvidence } from './evidence.js';
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

async function seedRichCase(repository: FakeControlPlaneRepository): Promise<void> {
  await repository.insert({
    recordId: 'case-payments',
    tenantId: TENANT,
    kind: 'capability-case',
    version: 3,
    data: {
      caseId: 'case-payments-reliability',
      title: 'Payments reliability',
      summary: 'A flaky refund timeout case.',
      lifecycle: 'active',
      tasks: [
        { taskId: 'task-reproduce', title: 'Reproduce the timeout', state: 'completed' },
        {
          taskId: 'task-review',
          title: 'Human review of the change',
          state: 'in-review',
          assignedExpertId: 'expert-1',
        },
        { taskId: 'task-audit', title: 'Audit trail check', state: 'awaiting-signature' },
        { title: 'malformed entry without an id', state: 'pending' },
      ],
      assignedBody: { bodyId: 'body-software-engineer', bodyVersion: '1.1.0' },
      run: { state: 'cleaned' },
      trajectory: [
        { step: 1, type: 'observation', summary: 'Timeouts cluster around one retry path.' },
        { step: 2, type: 'action', summary: 'Search for retry/backoff call sites.' },
        { step: 3, type: 'tool', tool: 'repo-navigator', summary: 'Located the retry helper.' },
        { step: 4, type: 'result', summary: 'Fixed 1s interval, no jitter.' },
        { step: 5, type: 'model-output', summary: 'Proposed jittered exponential backoff.' },
        { step: 6, type: 'weird-kind', summary: 'An unrecognized step kind.' },
      ],
      evaluation: {
        suiteId: 'suite-software-engineer-evaluation',
        verdict: 'pass',
        summary: 'Suite green.',
        evaluatedAt: T,
      },
      verification: {
        verifierKind: 'independent-verification',
        verdict: 'pass',
        checks: ['tests re-run in a clean environment'],
        verifiedAt: T,
      },
      epoch: {
        epochId: 'epoch-1',
        suggestion: {
          suggestionId: 'suggestion-jittered-backoff',
          kind: 'skill-draft',
          text: 'Prefer jittered exponential backoff.',
          status: 'suggested (not admitted)',
        },
      },
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
        stateKind: 'expert-judgment',
        summary: 'Fit for review triage.',
        basis: 'suite + expert review',
      },
    },
  });
}

/** The composed session posture over the seeded case repository. */
async function buildSession(): Promise<{
  readonly facts: ExpertSessionFacts;
  readonly port: ExpertReadPort;
}> {
  const { probe, repository } = await buildProbe();
  await seedRichCase(repository);
  const outcome = await resolveExpertSession({ probe, repository });
  if (outcome.status !== 'authenticated') throw new Error('expected authentication');
  return { facts: outcome.facts, port: outcome.port };
}

describe('buildCaseWorkView (session posture — the case work lens)', () => {
  it('renders the case with truthful lifecycle + task rows and canonical versioning', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.caseTitle).toBe('Payments reliability');
    expect(view.lifecycle.value).toBe('active');
    expect(view.lifecycle.recognized).toBe(true);
    expect(view.sourceVersion).toBe(3);
    expect(view.tasks.map((task) => task.taskId)).toEqual([
      'task-reproduce',
      'task-review',
      'task-audit',
    ]);
    expect(view.unrecognizedTaskEntries).toBe(1);
    const review = view.tasks.find((task) => task.taskId === 'task-review');
    if (review === undefined) throw new Error('expected task-review');
    expect(review.stateClass).toBe('awaiting-expert');
    expect(review.href).toBe('/expert/tasks/task-review?case=case-payments');
  });

  it('renders the assigned body reference (body, never model)', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.assignedBody.carried).toBe(true);
    expect(view.assignedBody.bodyId).toBe('body-software-engineer');
    expect(view.assignedBody.bodyVersion).toBe('1.1.0');
  });

  it('classifies the run state + trajectory steps honestly (unknown kinds stay unknown)', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.run.carriedState).toBe(true);
    expect(view.run.state.value).toBe('cleaned');
    expect(view.run.state.recognized).toBe(true); // the A010 vocabulary
    expect(view.trajectory).toHaveLength(6);
    expect(view.trajectory.map((step) => step.kind.value)).toEqual([
      'observation',
      'action',
      'tool',
      'result',
      'model-output',
      'weird-kind',
    ]);
    const weird = view.trajectory[5];
    if (weird === undefined) throw new Error('expected step 6');
    expect(weird.kind.recognized).toBe(false); // unknown, never guessed
    const modelOutput = view.trajectory[4];
    if (modelOutput === undefined) throw new Error('expected step 5');
    expect(modelOutput.truthAsserting).toBe(true); // model-output asserts its own kind
    expect(view.trajectory[2]?.tool).toBe('repo-navigator');
  });

  it('keeps evaluation and verification as DISTINCT carried blocks', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.evaluation.carried).toBe(true);
    expect(view.evaluation.verdict).toBe('pass');
    expect(view.verification.carried).toBe(true);
    expect(view.verification.verdict).toBe('pass');
    expect(view.verification.verifierKind).toBe('independent-verification');
    expect(view.suggestion.carried).toBe(true);
    expect(view.suggestion.status).toBe('suggested (not admitted)');
  });

  it('renders the honest not-found state when the case record does not exist', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'no-such-case',
    });
    expect(view.status).toBe('not-found');
  });

  it('surfaces the evidence appended for the case\u2019s tasks', async () => {
    const { probe, repository } = await buildProbe();
    await seedRichCase(repository);
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    await submitExpertEvidence(
      { repository, port: outcome.port, facts: outcome.facts },
      {
        caseRecordId: 'case-payments',
        taskId: 'task-review',
        verdict: 'endorsement',
        summary: 'The change is reviewable.',
        basis: 'Trajectory replay.',
      },
    );
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: outcome.facts,
      port: outcome.port,
      caseRecordId: 'case-payments',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.evidenceTotal).toBe(1);
    expect(view.evidence['task-review']).toHaveLength(1);
    expect(view.evidence['task-review']?.[0]?.verdict).toBe('endorsement');
  });
});

describe('buildTaskWorkView (session posture — task execute/review)', () => {
  it('renders the review posture for an in-review task assigned to the expert', async () => {
    const session = await buildSession();
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-review',
      caseRecordId: 'case-payments',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.posture).toBe('review');
    expect(view.taskState.value).toBe('in-review');
    expect(view.taskStateClass).toBe('awaiting-expert');
    expect(view.caseTitle).toBe('Payments reliability');
    expect(view.caseHref).toBe('/expert/cases/case-payments');
    expect(view.run.state.value).toBe('cleaned');
    expect(view.trajectory).toHaveLength(6);
    expect(view.qualifications).toHaveLength(1);
  });

  it('renders the execute posture for open work (pending/in-progress/blocked)', async () => {
    const { probe, repository } = await buildProbe();
    await repository.insert({
      recordId: 'case-open',
      tenantId: TENANT,
      kind: 'capability-case',
      version: 1,
      data: {
        title: 'Open work case',
        lifecycle: 'active',
        tasks: [{ taskId: 'task-open', title: 'Open task', state: 'pending' }],
      },
    });
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: outcome.facts,
      port: outcome.port,
      taskId: 'task-open',
      caseRecordId: 'case-open',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.posture).toBe('execute');
  });

  it('renders the closed posture for completed tasks (history stays visible)', async () => {
    const session = await buildSession();
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-reproduce',
      caseRecordId: 'case-payments',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.posture).toBe('closed');
    expect(view.taskState.value).toBe('completed');
  });

  it('fails closed honestly: case not found, task not found, not-assigned', async () => {
    const session = await buildSession();
    const missingCase = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-review',
      caseRecordId: 'no-such-case',
    });
    expect(missingCase.status).toBe('case-not-found');
    const missingTask = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-missing',
      caseRecordId: 'case-payments',
    });
    expect(missingTask.status).toBe('task-not-found');

    const { probe, repository } = await buildProbe();
    await repository.insert({
      recordId: 'case-other-assignee',
      tenantId: TENANT,
      kind: 'capability-case',
      version: 1,
      data: {
        title: 'Other assignee case',
        lifecycle: 'active',
        tasks: [
          { taskId: 'task-x', title: 'X', state: 'pending', assignedExpertId: 'someone-else' },
        ],
      },
    });
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const notAssigned = await buildTaskWorkView({
      mode: 'session',
      facts: outcome.facts,
      port: outcome.port,
      taskId: 'task-x',
      caseRecordId: 'case-other-assignee',
    });
    expect(notAssigned.status).toBe('not-assigned');
    if (notAssigned.status === 'not-assigned') {
      expect(notAssigned.assignedExpertId).toBe('someone-else');
    }
  });

  it('carries the task\u2019s evidence ledger (the judgment already appended)', async () => {
    const { probe, repository } = await buildProbe();
    await seedRichCase(repository);
    const outcome = await resolveExpertSession({ probe, repository });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    await submitExpertEvidence(
      { repository, port: outcome.port, facts: outcome.facts },
      {
        caseRecordId: 'case-payments',
        taskId: 'task-review',
        verdict: 'objection',
        summary: 'The retry cap rationale is not recorded.',
        basis: 'Trajectory replay, step 5.',
      },
    );
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: outcome.facts,
      port: outcome.port,
      taskId: 'task-review',
      caseRecordId: 'case-payments',
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.evidence).toHaveLength(1);
    expect(view.evidence[0]?.verdict).toBe('objection');
    expect(view.evidence[0]?.recordId).toBe('expert-evidence.case-payments.task-review.0001');
  });
});

describe('workbench surfaces (demo posture — the B006 corpus, deterministic)', () => {
  it('renders the demo case work lens from the corpus with its own truth labels', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const view = await buildCaseWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      caseRecordId: 'demo.capability-case.payments-reliability',
      corpusHash: context.corpusHash,
    });
    if (view.status !== 'found') throw new Error('expected found');
    expect(view.mode).toBe('demo');
    expect(view.truth.kind).toBe('simulation-replay'); // the corpus's own label
    expect(view.tasks.map((task) => task.taskId)).toEqual([
      'task-reproduce',
      'task-patch',
      'task-review',
    ]);
    expect(view.trajectory.map((step) => step.kind.value)).toEqual([
      'observation',
      'action',
      'tool',
      'result',
      'model-output',
    ]);
    // The demo corpus carries no run state — unknown, never guessed.
    expect(view.run.carriedState).toBe(false);
    expect(view.run.state.recognized).toBe(false);
    expect(view.evaluation.verdict).toBe('pass');
    expect(view.verification.verdict).toBe('pass');
    expect(view.suggestion.status).toBe('suggested (not admitted)');
    expect(view.hrefBase).toBe('/demo/expert');
  });

  it('renders the demo task review posture deterministically', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const first = await buildTaskWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      taskId: 'task-review',
      caseRecordId: 'demo.capability-case.payments-reliability',
      corpusHash: context.corpusHash,
    });
    const second = await buildTaskWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      taskId: 'task-review',
      caseRecordId: 'demo.capability-case.payments-reliability',
      corpusHash: context.corpusHash,
    });
    expect(first.status).toBe('found');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (first.status === 'found') {
      expect(first.posture).toBe('review');
      expect(first.taskState.value).toBe('in-review');
      expect(first.caseHref).toBe('/demo/expert/cases/demo.capability-case.payments-reliability');
    }
  });
});
