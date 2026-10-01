import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Workbench view tests (Work Order B009) — the house style: the async
 * compositions are exercised through the REAL boundaries (see
 * workbench.test.ts / evidence.test.ts); these tests assert the
 * PRESENTATIONAL truths of the case work lens and the task execute/review
 * surface: distinct state semantics, observation/action/tool/result/
 * model-output distinction, evaluation vs verification never collapsed,
 * the append-only evidence form, honest not-found states, demo labelling,
 * determinism.
 */

import { CaseWorkView, TaskWorkView } from './expert-view.js';
import { buildCaseWorkView, buildTaskWorkView } from './workbench.js';
import { getDemoExpertContext } from './runtime.js';
import { resetDemoRuntime } from '../demo/runtime.js';
import { submitExpertEvidence } from './evidence.js';
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
import { DEMO_LABELLING, DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import type { ExpertSessionFacts } from './runtime.js';
import type { ExpertReadPort } from './runtime.js';

const T = '2026-10-01T08:00:00.000Z';
const TENANT = 'tenant-alpha';

async function buildSession(): Promise<{
  readonly facts: ExpertSessionFacts;
  readonly port: ExpertReadPort;
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
  const repository = new FakeControlPlaneRepository({ clock });
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
      trajectory: [
        { step: 1, type: 'observation', summary: 'Timeouts cluster around one retry path.' },
        { step: 2, type: 'action', summary: 'Search for retry call sites.' },
        { step: 5, type: 'model-output', summary: 'Proposed jittered backoff.' },
      ],
      evaluation: { suiteId: 'suite-x', verdict: 'pass', evaluatedAt: T },
      verification: {
        verifierKind: 'independent-verification',
        verdict: 'pass',
        checks: ['clean re-run'],
        verifiedAt: T,
      },
    },
  });
  const outcome = await (
    await import('./runtime.js')
  ).resolveExpertSession({
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
    repository,
  });
  if (outcome.status !== 'authenticated') throw new Error('expected authentication');
  return { facts: outcome.facts, port: outcome.port, repository };
}

describe('CaseWorkView (session posture — the case work lens)', () => {
  it('renders the case header, lifecycle chip and task rows with task links', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(<CaseWorkView view={view} />);
    expect(html).toContain('data-arena-expert-surface="case-work"');
    expect(html).toContain('data-arena-route="expert-case"');
    expect(html).toContain('Payments reliability');
    expect(html).toContain('data-arena-state-value="active"');
    expect(html).toContain('data-arena-casetask="task-review"');
    expect(html).toContain('href="/expert/tasks/task-review?case=case-payments"');
    expect(html).toContain('canonical read:');
  });

  it('renders the trajectory with DISTINCT step kinds and the replay note', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(<CaseWorkView view={view} />);
    expect(html).toContain('data-arena-trajectory="true"');
    expect(html).toContain('data-arena-step-kind="observation"');
    expect(html).toContain('data-arena-step-kind="action"');
    expect(html).toContain('data-arena-step-kind="model-output"');
    expect(html).toContain('data-arena-truth="simulation"'); // the replay umbrella
    expect(html).toContain('observational replay');
  });

  it('renders evaluation and verification as DISTINCT sections (never collapsed)', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(<CaseWorkView view={view} />);
    expect(html).toContain('data-arena-evaluation="true"');
    expect(html).toContain('data-arena-evaluation-verdict="pass"');
    expect(html).toContain('data-arena-truth="evaluation"');
    expect(html).toContain('data-arena-verification="true"');
    expect(html).toContain('data-arena-verification-verdict="pass"');
    expect(html).toContain('data-arena-truth="verified"');
  });

  it('renders the honest run-state unknown when the record carries none', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(<CaseWorkView view={view} />);
    expect(html).toContain('data-arena-run-absent="true"');
    expect(html).toContain('never guessed');
  });

  it('renders the honest not-found state (fail closed)', async () => {
    const session = await buildSession();
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'no-such-case',
    });
    const html = renderToStaticMarkup(<CaseWorkView view={view} />);
    expect(html).toContain('data-arena-expert-surface="case-not-found"');
    expect(html).toContain('READ_MODEL_RECORD_NOT_FOUND');
    expect(html).not.toContain('data-arena-casetask=');
  });

  it('renders appended evidence per task under the case evidence section', async () => {
    const session = await buildSession();
    await submitExpertEvidence(
      { repository: session.repository, port: session.port, facts: session.facts },
      {
        caseRecordId: 'case-payments',
        taskId: 'task-review',
        verdict: 'endorsement',
        summary: 'Reviewable change.',
        basis: 'Trajectory replay.',
      },
    );
    const view = await buildCaseWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(<CaseWorkView view={view} />);
    expect(html).toContain('data-arena-evidence-ledger="true"');
    expect(html).toContain('data-arena-evidence="expert-evidence.case-payments.task-review.0001"');
    expect(html).toContain('data-arena-truth="expert-judgment"');
  });
});

describe('TaskWorkView (session posture — task execute/review)', () => {
  it('renders the review posture with the honest instruction + qualification scope', async () => {
    const session = await buildSession();
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-review',
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(<TaskWorkView view={view} />);
    expect(html).toContain('data-arena-expert-surface="task-work"');
    expect(html).toContain('data-arena-expert-posture="review"');
    expect(html).toContain('data-arena-posture-instruction="true"');
    expect(html).toContain('it is not a verification');
    expect(html).toContain('never an authorization');
    expect(html).toContain('href="/expert/cases/case-payments"');
  });

  it('renders the append-only evidence submission form (plain POST, no client JS)', async () => {
    const session = await buildSession();
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-review',
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(<TaskWorkView view={view} />);
    expect(html).toContain('<form');
    expect(html).toContain('action="/expert/tasks/task-review/evidence"');
    expect(html).toContain('name="case"');
    expect(html).toContain('name="verdict"');
    expect(html).toContain('name="summary"');
    expect(html).toContain('name="basis"');
    expect(html).toContain('data-arena-evidence-submit="true"');
    expect(html).toContain('never changes the task state');
  });

  it('renders the honest not-assigned state (assignment identity, not authorization)', async () => {
    const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
    const repository = new FakeControlPlaneRepository({ clock });
    await repository.insert({
      recordId: 'case-foreign-assignee',
      tenantId: 'tenant-beta',
      kind: 'capability-case',
      version: 1,
      data: {
        title: 'Not yours',
        lifecycle: 'active',
        tasks: [{ taskId: 'task-x', title: 'X', state: 'pending', assignedExpertId: 'other' }],
      },
    });
    const session = await buildSession();
    // The task surface reads through the SESSION tenant — a foreign-tenant
    // case record fails closed as case-not-found; the not-assigned variant
    // needs a same-tenant record assigned to someone else.
    await session.repository.insert({
      recordId: 'case-other-assignee',
      tenantId: TENANT,
      kind: 'capability-case',
      version: 1,
      data: {
        title: 'Other assignee',
        lifecycle: 'active',
        tasks: [{ taskId: 'task-x', title: 'X', state: 'pending', assignedExpertId: 'someone-else' }],
      },
    });
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-x',
      caseRecordId: 'case-other-assignee',
    });
    const html = renderToStaticMarkup(<TaskWorkView view={view} />);
    expect(html).toContain('data-arena-expert-surface="not-assigned"');
    expect(html).toContain('someone-else');
    expect(html).toContain('not an authorization decision');
    expect(html).not.toContain('data-arena-evidence-form');
  });

  it('renders the honest post-submission outcome note (appended — nothing flipped)', async () => {
    const session = await buildSession();
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-review',
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(
      <TaskWorkView view={view} evidenceOutcome={{ kind: 'appended', detail: 'sequence 1' }} />,
    );
    expect(html).toContain('data-arena-evidence-outcome="appended"');
    expect(html).toContain('expert judgment is not verification');
  });

  it('renders the honest post-submission error outcome (fail closed)', async () => {
    const session = await buildSession();
    const view = await buildTaskWorkView({
      mode: 'session',
      facts: session.facts,
      port: session.port,
      taskId: 'task-review',
      caseRecordId: 'case-payments',
    });
    const html = renderToStaticMarkup(
      <TaskWorkView
        view={view}
        evidenceOutcome={{ kind: 'error', detail: 'EXPERT_EVIDENCE_INVALID_INPUT' }}
      />,
    );
    expect(html).toContain('data-arena-evidence-outcome="error"');
    expect(html).toContain('failed closed');
  });
});

describe('Workbench views (demo posture — visibly labelled, deterministic)', () => {
  it('renders the demo case work lens under the labelling contract', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const view = await buildCaseWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      caseRecordId: 'demo.capability-case.payments-reliability',
      corpusHash: context.corpusHash,
    });
    const html = renderToStaticMarkup(<CaseWorkView view={view} />);
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain(DEMO_LABELLING.bannerTitle);
    expect(html).toContain('data-arena-truth="simulation"');
    expect(html).toContain('data-arena-state="demo"');
    expect(html).toContain('href="/demo/expert/tasks/task-review?case=demo.capability-case.payments-reliability"');
  });

  it('renders the demo task surface with the demo evidence form action', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const view = await buildTaskWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      taskId: 'task-review',
      caseRecordId: 'demo.capability-case.payments-reliability',
      corpusHash: context.corpusHash,
    });
    const html = renderToStaticMarkup(<TaskWorkView view={view} />);
    expect(html).toContain('action="/demo/expert/tasks/task-review/evidence"');
    expect(html).toContain('data-arena-expert-posture="review"');
    expect(html).toContain('data-arena-demo-banner="true"');
  });

  it('is byte-identical across two loads of the same state', async () => {
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
    expect(renderToStaticMarkup(<TaskWorkView view={first} />)).toBe(
      renderToStaticMarkup(<TaskWorkView view={second} />),
    );
  });
});
