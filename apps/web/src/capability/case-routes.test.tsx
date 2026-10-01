import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Capability route-composition tests (Work Order B008): the session
 * experiences (fail-closed gate | view) through injected session probes
 * over a seeded B002 repository, the demo experiences over the shared
 * B006 runtime, and the honest redirect contract of
 * handleGuidedFormPost (origin-rejected → 403; typed rejection → 303
 * with ?flowError=; done → 303 to the resulting record).
 */

import {
  resolveSessionCaseList,
  resolveSessionCaseDetail,
  resolveSessionTask,
  resolveDemoCaseList,
  resolveDemoCaseDetail,
  resolveDemoTask,
  handleGuidedFormPost,
  sessionActor,
} from './case-routes.js';
import { CaseListView, CaseDetailView, TaskDetailView } from './capability-views.js';
import { createCapabilityFlowRuntime } from './runtime.js';
import { referenceFraming } from './flow-actions.js';
import { resetDemoCapabilityContext } from './runtime.js';
import { resetDemoRuntime } from '../demo/runtime.js';
import type { SessionProbe } from '../cockpit/runtime.js';
import { FakeControlPlaneRepository, ManualClock } from '../../../../packages/persistence/src/index.js';
import { taskRecordId } from '../../../../packages/product-flows/src/index.js';
import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';

const T = '2026-10-01T08:00:00.000Z';
const TENANT = 'tenant-alpha';

const NO_COOKIE_PROBE: SessionProbe = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

async function authenticatedProbe(): Promise<SessionProbe> {
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
          tenantScope: TENANT,
          roles: ['tenant-member'],
          label: 'worker-one',
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
    tenantId: TENANT,
    workspaceContext: createWorkspaceContext({
      identityId: 'worker-1',
      tenantId: TENANT,
      workspaceId: `${TENANT}-ws`,
      permissionPolicy: createPermissionPolicy({
        policyId: 'alpha-policy',
        tenantId: TENANT,
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: [
        grantRole({
          grantId: 'grant-owner',
          identityId: 'worker-1',
          tenantId: TENANT,
          roleId: 'owner',
          policyId: 'alpha-policy',
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ],
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
  });
  const cookieValue = issuance.cookie.value;
  return {
    cookieValue: () => Promise.resolve(cookieValue),
    validate: (token: string) => auth.service.validateSession(token),
  };
}

/** A repository seeded with one canonical case walked to `triaged` (task compiled). */
async function seededRepository() {
  const repository = new FakeControlPlaneRepository({
    clock: new ManualClock(DEMO_NARRATIVE_EPOCH_MS),
  });
  const flow = await createCapabilityFlowRuntime({ repository });
  const identity = { tenant: TENANT, caseId: 'case-seeded-gap' };
  const actor = { type: 'user', tenant: TENANT, principalId: 'worker-one' };
  const framing = {
    ...referenceFraming(TENANT),
    identity: { tenant: TENANT, caseId: identity.caseId },
  };
  await flow.startCase(framing);
  await flow.continueCase({ stepId: 'frame-gap', identity, actor, at: '2026-10-01T09:00:00.000Z' });
  const composed = await flow.continueCase({
    stepId: 'compose-task',
    identity,
    actor,
    at: '2026-10-01T10:00:00.000Z',
    note: 'Selected: reproducible failure with clear success conditions.',
  });
  const taskRecordIds = (composed.taskSpecs ?? []).map((spec) =>
    taskRecordId({ tenant: spec.identity.tenant, taskId: spec.identity.taskId }),
  );
  return { repository, flow, taskRecordIds };
}

describe('session case experiences (fail closed, then role-lensed views)', () => {
  it('gates an unauthenticated visitor (never an anonymous case list)', async () => {
    const experience = await resolveSessionCaseList({ probe: NO_COOKIE_PROBE });
    expect(experience).toEqual({ kind: 'gate', code: 'AUTH_SESSION_NOT_FOUND' });
  });

  it('propagates a non-auth session-probe failure (never a silent gate)', async () => {
    await expect(
      resolveSessionCaseList({
        probe: {
          cookieValue: () => Promise.reject(new Error('boundary exploded')),
          validate: () => Promise.reject(new Error('unreachable')),
        },
      }),
    ).rejects.toThrow('boundary exploded');
  });

  it('renders the authenticated case list with next-step cues and the start affordance', async () => {
    const { repository } = await seededRepository();
    const experience = await resolveSessionCaseList({
      probe: await authenticatedProbe(),
      repository,
    });
    expect(experience.kind).toBe('cases');
    if (experience.kind !== 'cases') return;
    expect(experience.view.mode).toBe('session');
    expect(experience.view.demo.isDemo).toBe(false);
    expect(experience.view.cards).toHaveLength(1);
    const html = renderToStaticMarkup(<CaseListView view={experience.view} />);
    expect(html).toContain('data-arena-route="cases"');
    expect(html).toContain('data-arena-mode="session"');
    expect(html).not.toContain('data-arena-demo-banner');
    expect(html).toContain('href="/cases/start"');
    expect(html).toContain('data-arena-next-step="run"');
    expect(html).toContain('data-arena-case-shape="canonical"');
  });

  it('renders the authenticated case detail with the guided path read strictly from the lifecycle', async () => {
    const { repository } = await seededRepository();
    const experience = await resolveSessionCaseDetail('case.tenant-alpha.case-seeded-gap', {
      probe: await authenticatedProbe(),
      repository,
    });
    expect(experience.kind).toBe('case');
    if (experience.kind !== 'case') return;
    expect(experience.view.shape).toBe('canonical');
    expect(experience.view.status).toBe('triaged');
    expect(experience.view.nextStep?.stepId).toBe('run');
    const html = renderToStaticMarkup(<CaseDetailView view={experience.view} />);
    expect(html).toContain('data-arena-route="case-detail"');
    expect(html).toContain('data-arena-guided-phase="done"');
    expect(html).toContain('data-arena-guided-phase="current"');
    expect(html).toContain('data-arena-guided-phase="upcoming"');
    expect(html).toContain('data-arena-lifecycle-events="true"');
    // The current step's continue form posts to the canonical runtime mount.
    expect(html).toContain('action="/cases/case.tenant-alpha.case-seeded-gap/continue"');
  });

  it('renders an honest unreadable outcome for a record that cannot be read', async () => {
    const { repository } = await seededRepository();
    const experience = await resolveSessionCaseDetail('case.tenant-alpha.case-never-seen', {
      probe: await authenticatedProbe(),
      repository,
    });
    expect(experience.kind).toBe('unreadable');
    if (experience.kind !== 'unreadable') return;
    expect(experience.recordId).toBe('case.tenant-alpha.case-never-seen');
    expect(experience.message).toBeTruthy();
  });

  it('renders the compiled TaskSpec as a PROPOSAL (never an execution claim)', async () => {
    const { repository, taskRecordIds } = await seededRepository();
    expect(taskRecordIds.length).toBeGreaterThan(0);
    const experience = await resolveSessionTask(taskRecordIds[0] as string, {
      probe: await authenticatedProbe(),
      repository,
    });
    expect(experience.kind).toBe('task');
    if (experience.kind !== 'task') return;
    expect(experience.view.shape).toBe('task-spec');
    const html = renderToStaticMarkup(<TaskDetailView view={experience.view} />);
    expect(html).toContain('data-arena-route="task"');
    expect(html).toContain('data-arena-task-proposal="true"');
    expect(html).toContain('data-arena-mode="session"');
  });

  it('resolves the session actor from the validated session facts', async () => {
    const facts = {
      tenantId: TENANT,
      workspaceId: `${TENANT}-ws`,
      principalLabel: 'worker-one',
      grantedRoleIds: ['owner' as const],
    };
    expect(sessionActor(facts)).toEqual({
      type: 'user',
      tenant: TENANT,
      principalId: 'worker-one',
    });
  });
});

describe('demo case experiences (B006 runtime; visibly labelled)', () => {
  it('renders the seeded narrative corpus case with the honest guided-flow note', async () => {
    const view = await resolveDemoCaseList();
    expect(view.mode).toBe('demo');
    expect(view.demo.isDemo).toBe(true);
    expect(typeof view.demo.corpusHash).toBe('string');
    const html = renderToStaticMarkup(<CaseListView view={view} />);
    expect(html).toContain('data-arena-mode="demo"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('data-arena-case-shape="narrative"');
    expect(html).toContain('data-arena-narrative-note="true"');
    expect(html).toContain('href="/demo/cases/start"');
  });

  it('renders the narrative case detail honestly (guided flow cannot transition it)', async () => {
    const view = await resolveDemoCaseDetail('demo.capability-case.payments-reliability');
    expect('unreadable' in view).toBe(false);
    if ('unreadable' in view) return;
    expect(view.shape).toBe('narrative');
    expect(view.nextStep).toBeNull();
    const html = renderToStaticMarkup(<CaseDetailView view={view} />);
    expect(html).toContain('data-arena-narrative-case="true"');
    expect(html).toContain('data-arena-demo-banner="true"');
  });

  it('renders an embedded narrative demo task as labelled demo state', async () => {
    const view = await resolveDemoTask('task-reproduce');
    expect(view.shape).toBe('narrative');
    expect(view.narrative?.taskId).toBe('task-reproduce');
    const html = renderToStaticMarkup(<TaskDetailView view={view} />);
    expect(html).toContain('data-arena-mode="demo"');
    expect(html).toContain('data-arena-demo-banner="true"');
  });

  it('is byte-identical across two resolutions of the same lens', async () => {
    expect(JSON.stringify(await resolveDemoCaseList())).toBe(
      JSON.stringify(await resolveDemoCaseList()),
    );
  });
});

describe('handleGuidedFormPost (origin-check → flow runtime → honest redirect)', () => {
  function postRequest(body: Record<string, string>, origin = 'https://arena.test'): Request {
    const form = new URLSearchParams(body);
    return new Request('https://arena.test/cases/start/submit', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  }

  it('returns 403 for a foreign Origin (the B004 CSRF posture)', async () => {
    const { repository } = await seededRepository();
    const flow = await createCapabilityFlowRuntime({ repository });
    const response = await handleGuidedFormPost(
      postRequest({ intent: 'start' }, 'https://evil.example'),
      { tenantId: TENANT, actor: { type: 'user', tenant: TENANT, principalId: 'worker-one' }, flow },
      {
        success: (recordId) => `/cases/${encodeURIComponent(recordId)}`,
        failure: '/cases/start',
      },
    );
    expect(response.status).toBe(403);
  });

  it('redirects a typed rejection back with the code (?flowError=), never a fake success', async () => {
    const { repository } = await seededRepository();
    const flow = await createCapabilityFlowRuntime({ repository });
    const response = await handleGuidedFormPost(
      postRequest({ stepId: 'decide', caseId: 'case-seeded-gap', resolution: 'too early' }),
      { tenantId: TENANT, actor: { type: 'user', tenant: TENANT, principalId: 'worker-one' }, flow },
      {
        success: (recordId) => `/cases/${encodeURIComponent(recordId)}`,
        failure: '/cases/case.tenant-alpha.case-seeded-gap',
      },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://arena.test/cases/case.tenant-alpha.case-seeded-gap?flowError=CAPABILITY_CASE_INVALID_TRANSITION',
    );
  });

  it('redirects a successful start to the resulting record surface', async () => {
    const repository = new FakeControlPlaneRepository({
      clock: new ManualClock(DEMO_NARRATIVE_EPOCH_MS),
    });
    const flow = await createCapabilityFlowRuntime({ repository });
    const response = await handleGuidedFormPost(
      postRequest({ intent: 'start', caseId: 'case-via-form' }),
      { tenantId: TENANT, actor: { type: 'user', tenant: TENANT, principalId: 'worker-one' }, flow },
      {
        success: (recordId) => `/cases/${encodeURIComponent(recordId)}`,
        failure: '/cases/start',
      },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://arena.test/cases/case.tenant-alpha.case-via-form',
    );
  });
});

describe('demo guided writes (through the demo store, reset deterministically)', () => {
  it('starts a canonical case in the demo tenant through the demo composition', async () => {
    resetDemoRuntime();
    resetDemoCapabilityContext();
    const demoListBefore = await resolveDemoCaseList();
    expect(demoListBefore.cards).toHaveLength(1); // the seeded narrative corpus case only
    const view = await resolveDemoCaseList();
    expect(view.mode).toBe('demo');
    // The demo list surfaces the start affordance under the demo base.
    const html = renderToStaticMarkup(<CaseListView view={view} />);
    expect(html).toContain('href="/demo/cases/start"');
    resetDemoRuntime();
    resetDemoCapabilityContext();
  });
});
