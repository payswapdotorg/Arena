import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Expert workbench view tests (Work Order B009) — the house style: render
 * through react-dom/server in a plain node environment. The async
 * compositions are exercised by building the view models through the real
 * boundaries (see runtime/assignment tests); these tests assert the
 * PRESENTATIONAL truths: labelling, distinct state semantics, honest
 * empty/denied states, demo badges, determinism.
 */

import { AssignedCasesView, AssignedWorkView, ExpertDeniedView } from './expert-view.js';
import { buildAssignedWorkView, buildAssignedCasesView } from './assignment.js';
import { getDemoExpertContext, resolveExpertSession } from './runtime.js';
import { resetDemoRuntime } from '../demo/runtime.js';
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
import type { AssignedWorkViewModel } from './assignment.js';

const T = '2026-10-01T08:00:00.000Z';
const TENANT = 'tenant-alpha';

async function buildSessionView(): Promise<AssignedWorkViewModel> {
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
        { taskId: 'task-review', title: 'Human review of the change', state: 'in-review' },
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
        stateKind: 'expert-judgment',
        summary: 'Fit for review triage.',
        basis: 'suite + expert review',
      },
    },
  });
  const outcome = await resolveExpertSession({
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
    repository,
  });
  if (outcome.status !== 'authenticated') throw new Error('expected authentication');
  return buildAssignedWorkView({ mode: 'session', facts: outcome.facts, port: outcome.port });
}

describe('AssignedWorkView (session posture)', () => {
  it('renders the assigned-work landing with the expert role goal', async () => {
    const html = renderToStaticMarkup(<AssignedWorkView view={await buildSessionView()} />);
    expect(html).toContain('data-arena-route="expert"');
    expect(html).toContain('data-arena-expert-surface="assigned-work"');
    expect(html).toContain('data-arena-active-role="expert"');
    expect(html).toContain('Assigned work');
  });

  it('renders every assignment row with its truthful task state + canonical read refs', async () => {
    const html = renderToStaticMarkup(<AssignedWorkView view={await buildSessionView()} />);
    expect(html).toContain('data-arena-assignment="task-review"');
    expect(html).toContain('data-arena-assignment-class="awaiting-expert"');
    expect(html).toContain('data-arena-state-chip="task"');
    expect(html).toContain('data-arena-state-value="in-review"');
    expect(html).toContain('data-arena-state-recognized="true"');
    expect(html).toContain('href="/expert/tasks/task-review?case=case-payments"');
    expect(html).toContain('canonical read:');
    expect(html).toContain('case-payments');
  });

  it('renders the qualification panel with the qualification-is-not-authorization note', async () => {
    const html = renderToStaticMarkup(<AssignedWorkView view={await buildSessionView()} />);
    expect(html).toContain('data-arena-qualification="qual-structural"');
    expect(html).toContain('data-arena-truth="expert-judgment"');
    expect(html).toContain('never an authorization');
  });

  it('renders exactly ONE primary action (UX1.0 one meaningful primary action)', async () => {
    const html = renderToStaticMarkup(<AssignedWorkView view={await buildSessionView()} />);
    expect(html.match(/data-arena-primary/g)?.length).toBe(1);
  });

  it('never renders the demo banner or demo badge in session mode', async () => {
    const html = renderToStaticMarkup(<AssignedWorkView view={await buildSessionView()} />);
    expect(html).not.toContain('data-arena-demo-banner="true"');
    expect(html).not.toContain('data-arena-state="demo"');
  });

  it('renders honest empty states when nothing is assigned', async () => {
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
    const outcome = await resolveExpertSession({
      probe: {
        cookieValue: () => Promise.resolve(issuance.cookie.value),
        validate: (token: string) => auth.service.validateSession(token),
      },
      repository: new FakeControlPlaneRepository({ clock }),
    });
    if (outcome.status !== 'authenticated') throw new Error('expected authentication');
    const view = await buildAssignedWorkView({ mode: 'session', facts: outcome.facts, port: outcome.port });
    const html = renderToStaticMarkup(<AssignedWorkView view={view} />);
    expect(html).toContain('data-arena-state="empty"');
    expect(html).toContain('No expert qualifications in this workspace yet');
    expect(html).toContain('No assigned work yet');
  });
});

describe('AssignedWorkView (demo posture — visibly labelled, deterministic)', () => {
  it('renders the demo banner + demo badges and never hides demo state', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const view = await buildAssignedWorkView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      corpusHash: context.corpusHash,
    });
    const html = renderToStaticMarkup(<AssignedWorkView view={view} />);
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain(DEMO_LABELLING.bannerTitle);
    expect(html).toContain('data-arena-state="demo"');
    expect(html).toContain('data-arena-truth="simulation"'); // the demo case's own label
    expect(html).toContain('href="/demo/expert/tasks/task-review?case=demo.capability-case.payments-reliability"');
  });

  it('is byte-identical across two loads of the same state', async () => {
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
    expect(renderToStaticMarkup(<AssignedWorkView view={first} />)).toBe(
      renderToStaticMarkup(<AssignedWorkView view={second} />),
    );
  });
});

describe('AssignedCasesView (assigned-cases list)', () => {
  it('renders the case rollup with task counts and the case work-lens link', async () => {
    resetDemoRuntime();
    const context = await getDemoExpertContext();
    const view = await buildAssignedCasesView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      corpusHash: context.corpusHash,
    });
    const html = renderToStaticMarkup(<AssignedCasesView view={view} />);
    expect(html).toContain('data-arena-expert-surface="assigned-cases"');
    expect(html).toContain('data-arena-case="demo.capability-case.payments-reliability"');
    expect(html).toContain('href="/demo/expert/cases/demo.capability-case.payments-reliability"');
    expect(html).toContain('3 tasks');
    expect(html).toContain('1 open');
  });
});

describe('ExpertDeniedView (fail closed — never an anonymous workbench)', () => {
  it('renders the denied state with the typed AUTH code and the honest authority', () => {
    const html = renderToStaticMarkup(<ExpertDeniedView code="AUTH_SESSION_NOT_FOUND" mode="session" />);
    expect(html).toContain('data-arena-expert-surface="denied"');
    expect(html).toContain('data-arena-state="denied"');
    expect(html).toContain('AUTH_SESSION_NOT_FOUND');
    expect(html).toContain('authenticated session (B004 boundary)');
    expect(html).toContain('href="/demo/expert"');
    expect(html).not.toContain('data-arena-assignments-open');
  });
});
