import { describe, expect, it } from 'vitest';

/**
 * Case/task view tests (Work Order B008) — the B007 house style: build
 * the views through REAL compositions (product-flows runtime over a B002
 * fake repository; reads through the B005 ReadModelService read path;
 * demo mode through the shared demo runtime) and assert the
 * lens/truth/lifecycle/denial contracts on the resulting view models.
 */

import { FakeControlPlaneRepository, ManualClock } from '../../../../packages/persistence/src/index.js';
import { ReadModelService } from '../../../../services/read-model/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import { buildCaseDetailView, buildCaseListView, buildTaskDetailView } from './case-view.js';
import { createCapabilityFlowRuntime, getDemoCapabilityContext, resetDemoCapabilityContext } from './runtime.js';
import type { CapabilityReadPort } from './runtime.js';
import type { CockpitSessionFacts } from '../cockpit/runtime.js';

const T0 = '2026-10-01T09:00:00.000Z';
const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-01T11:00:00.000Z';
const T3 = '2026-10-01T12:00:00.000Z';

const SESSION_FACTS: CockpitSessionFacts = Object.freeze({
  tenantId: 'tenant-alpha',
  workspaceId: 'tenant-alpha-ws',
  principalLabel: 'worker-one',
  grantedRoleIds: Object.freeze(['owner', 'expert', 'administrator'] as const),
});

const ACTOR = Object.freeze({
  type: 'user',
  tenant: 'tenant-alpha',
  principalId: 'worker-one',
} as const);

function framing(caseId: string) {
  return {
    identity: { tenant: 'tenant-alpha', caseId },
    version: '1.0.0',
    source: { type: 'user', tenant: 'tenant-alpha', principalId: 'worker-one' },
    problemStatement: 'The payments agent storms refund retries under load.',
    targetCapability: {
      kind: 'capability',
      id: 'refund-retry-reliability',
      version: '1.1.0',
      digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    domain: { kind: 'domain', id: 'payments', version: '1.0.0', digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    context: 'Production workload; monthly refund batch.',
    observedFailure: {
      summary: 'Refund retries cluster into storms during the batch.',
      observedAt: T0,
      reproduction: 'Run the monthly batch with one flaky downstream.',
    },
    evidence: [
      { digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', description: 'Trajectory export of the failing batch.' },
    ],
    unknowns: ['Whether the downstream honors Retry-After'],
    desiredOutcome: 'Jittered exponential backoff with a retry cap.',
    expertRequirements: {
      competencies: [
        { kind: 'expert-competency', id: 'payments-reliability', version: '1.0.0', digest: '1212121212121212121212121212121212121212121212121212121212121212' },
      ],
      qualifications: ['payments-reliability-reviewer'],
    },
    environmentRequirements: {
      environments: [
        { namespace: 'tenant-alpha', name: 'payments-batch-sandbox', version: '1.2.0', digest: '3434343434343434343434343434343434343434343434343434343434343434' },
      ],
      constraints: ['No live payments writes'],
    },
    taskRequirements: {
      objectives: ['Eliminate refund retry storms'],
      constraints: ['Use only the sandbox export'],
      allowedTools: [
        { namespace: 'tenant-alpha', name: 'payments-export-reader', version: '1.0.0', digest: '5656565656565656565656565656565656565656565656565656565656565656' },
      ],
      forbiddenShortcuts: ['Assume the downstream is healthy'],
      successConditions: ['No timeout under the batch replay'],
      evidenceCriteria: ['Annotated trajectory'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        { kind: 'evaluator', id: 'retry-storm-accuracy', version: '1.0.0', digest: '7878787878787878787878787878787878787878787878787878787878787878' },
      ],
      criteria: ['Zero timeout storms across the replayed batch'],
    },
    verificationRequirements: {
      verifiers: [
        { kind: 'verifier', id: 'payments-balance-check', version: '1.0.0', digest: '9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a' },
      ],
      evidenceStandards: ['Balance proof exported from the sandbox'],
    },
    provenance: { recordDigest: 'bc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1d' },
    priority: 'high',
    risk: 'moderate',
    createdAt: T0,
  };
}

async function freshSessionComposition() {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const repository = new FakeControlPlaneRepository({ clock });
  const readModel = new ReadModelService({ repository, clock });
  const port: CapabilityReadPort = {
    read: (recordId: string) => readModel.readCanonical('tenant-alpha', recordId),
    scroll: (kind: 'capability-case') => readModel.scrollByKind('tenant-alpha', kind),
    inventory: () => readModel.listKinds('tenant-alpha'),
  };
  const flow = await createCapabilityFlowRuntime({ repository });
  return { port, flow };
}

describe('case list view (session mode: flow writes visible through the canonical read path)', () => {
  it('renders an honest empty state before any case exists', async () => {
    const { port } = await freshSessionComposition();
    const view = await buildCaseListView({ mode: 'session', facts: SESSION_FACTS, port });
    expect(view.empty).toBe(true);
    expect(view.cards).toHaveLength(0);
    expect(view.lens.heading).toBe('Your capability cases');
  });

  it('lists cases started through the flow runtime with truthful statuses and next steps', async () => {
    const { port, flow } = await freshSessionComposition();
    await flow.startCase(framing('case-refund-timeout'));
    const view = await buildCaseListView({ mode: 'session', facts: SESSION_FACTS, port });
    expect(view.empty).toBe(false);
    const card = view.cards.find((entry) => entry.recordId === 'case.tenant-alpha.case-refund-timeout');
    expect(card).toBeDefined();
    expect(card?.shape).toBe('canonical');
    expect(card?.status).toBe('draft');
    expect(card?.nextStep?.stepId).toBe('frame-gap');
    // Non-terminal status renders as PENDING — never a badgeable result kind.
    const statusFact = card?.facts.find((entry) => entry.label === 'Status');
    expect(statusFact?.stateKind).toBe('pending');
    expect(statusFact?.treatment).toBe('pending');
  });

  it('switches the lens per requested role (lens, not authorization)', async () => {
    const { port } = await freshSessionComposition();
    const expert = await buildCaseListView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      requestedRoleId: 'expert',
    });
    expect(expert.lens.heading).toBe('Assigned cases');
    expect(expert.roleSwitch.activeRoleId).toBe('expert');
    const denied = await buildCaseListView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      requestedRoleId: 'marketplace-participant',
    });
    expect(denied.roleSwitch.denied).toBe(true);
    expect(denied.roleSwitch.deniedRequested).toBe('marketplace-participant');
    expect(denied.roleSwitch.activeRoleId).toBe('owner');
    expect(denied.lens.heading).toBe('Your capability cases');
  });
});

describe('case detail view (session mode: guided workflow over the canonical lifecycle)', () => {
  it('renders the guided path done/current/upcoming strictly from the lifecycle', async () => {
    const { port, flow } = await freshSessionComposition();
    await flow.startCase(framing('case-guided'));
    const recordId = 'case.tenant-alpha.case-guided';
    const draft = await buildCaseDetailView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      recordId,
    });
    expect(draft.shape).toBe('canonical');
    expect(draft.status).toBe('draft');
    expect(draft.guided.find((row) => row.step.stepId === 'start-case')?.phase).toBe('done');
    expect(draft.guided.find((row) => row.step.stepId === 'frame-gap')?.phase).toBe('current');
    expect(draft.guided.find((row) => row.step.stepId === 'decide')?.phase).toBe('upcoming');
    expect(draft.nextStep?.stepId).toBe('frame-gap');

    await flow.continueCase({ stepId: 'frame-gap', identity: { tenant: 'tenant-alpha', caseId: 'case-guided' }, actor: ACTOR, at: T1 });
    await flow.continueCase({
      stepId: 'compose-task',
      identity: { tenant: 'tenant-alpha', caseId: 'case-guided' },
      actor: ACTOR,
      at: T2,
      note: 'Reproducible and blocking; selected for capability development.',
    });
    const triaged = await buildCaseDetailView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      recordId,
    });
    expect(triaged.status).toBe('triaged');
    expect(triaged.guided.find((row) => row.step.stepId === 'compose-task')?.phase).toBe('done');
    expect(triaged.nextStep?.stepId).toBe('run');
    // compose-task stored a canonical TaskSpec proposal (covered by the task view suite).
  });

  it('renders an honest dead-end with follow-up guidance at a terminal case', async () => {
    const { port, flow } = await freshSessionComposition();
    await flow.startCase(framing('case-terminal'));
    const identity = { tenant: 'tenant-alpha', caseId: 'case-terminal' };
    await flow.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: T1 });
    await flow.continueCase({ stepId: 'compose-task', identity, actor: ACTOR, at: T2, note: 'selected' });
    await flow.continueCase({ stepId: 'run', identity, actor: ACTOR, at: T3 });
    await flow.continueCase({ stepId: 'decide', identity, actor: ACTOR, at: T3, resolution: 'Backoff cap eliminates storms.' });
    const view = await buildCaseDetailView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      recordId: 'case.tenant-alpha.case-terminal',
    });
    expect(view.terminal).toBe(true);
    expect(view.nextStep).toBeNull();
    // Terminal status is a digest-verified protocol fact (record integrity).
    const statusFact = view.facts.find((entry) => entry.label === 'Status');
    expect(statusFact?.stateKind).toBe('verified-fact');
    expect(view.history.length).toBeGreaterThanOrEqual(5);
  });

  it('lenses the same canonical case per role (same object, different question)', async () => {
    const { port, flow } = await freshSessionComposition();
    await flow.startCase(framing('case-lens'));
    const recordId = 'case.tenant-alpha.case-lens';
    const owner = await buildCaseDetailView({ mode: 'session', facts: SESSION_FACTS, port, recordId });
    expect(owner.lens.lensName).toBe('Outcome lens');
    const expert = await buildCaseDetailView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      recordId,
      requestedRoleId: 'expert',
    });
    expect(expert.lens.lensName).toBe('Work lens');
    expect(expert.title).toBe(owner.title);
  });
});

describe('task view (canonical TaskSpec proposals read by id)', () => {
  it('renders the compose-task proposal as a suggestion/hypothesis (never a result)', async () => {
    const { port, flow } = await freshSessionComposition();
    await flow.startCase(framing('case-with-task'));
    const identity = { tenant: 'tenant-alpha', caseId: 'case-with-task' };
    await flow.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: T1 });
    const composed = await flow.continueCase({
      stepId: 'compose-task',
      identity,
      actor: ACTOR,
      at: T2,
      note: 'Selected for capability development.',
    });
    expect(composed.taskSpecs).toBeDefined();
    expect((composed.taskSpecs ?? []).length).toBeGreaterThan(0);
    const spec = (composed.taskSpecs ?? [])[0] as { identity: { taskId: string } };
    const taskRecordId = `task.tenant-alpha.${spec.identity.taskId}`;
    const view = await buildTaskDetailView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      taskId: taskRecordId,
    });
    expect(view.shape).toBe('task-spec');
    const taskFact = view.facts.find((entry) => entry.label === 'Task id');
    expect(taskFact?.stateKind).toBe('suggestion-hypothesis');
    expect(view.objectives.length).toBeGreaterThan(0);
    expect(view.summary).toContain('PROPOSAL');
  });

  it('renders an honest not-found for an unknown task id (never fabricated)', async () => {
    const { port } = await freshSessionComposition();
    const view = await buildTaskDetailView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      taskId: 'task.tenant-alpha.never-compiled',
    });
    expect(view.title).toBe('Task not found');
    expect(view.facts[0]?.stateKind).toBe('unknown');
  });
});

describe('demo mode (B006 corpus through the canonical read path + demo labelling)', () => {
  it('renders the demo corpus case as an honestly narrative-shaped record', async () => {
    resetDemoCapabilityContext();
    const context = await getDemoCapabilityContext();
    const view = await buildCaseListView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      corpusHash: context.corpusHash,
    });
    const corpus = view.cards.find((entry) => entry.recordId === 'demo.capability-case.payments-reliability');
    expect(corpus).toBeDefined();
    expect(corpus?.shape).toBe('narrative');
    expect(corpus?.demo).toBe(true);
    const detail = await buildCaseDetailView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      recordId: 'demo.capability-case.payments-reliability',
    });
    expect(detail.shape).toBe('narrative');
    expect(detail.nextStep).toBeNull();
    // The narrative record carries the corpus's own demo truth label.
    const recordFact = detail.facts.find((entry) => entry.label === 'Record');
    expect(recordFact?.stateKind).toBe('simulation-replay');
  });

  it('renders a demo narrative task embedded in the corpus case (labelled, honest state)', async () => {
    resetDemoCapabilityContext();
    const context = await getDemoCapabilityContext();
    const view = await buildTaskDetailView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      taskId: 'task-review',
    });
    expect(view.shape).toBe('narrative');
    expect(view.narrative?.state).toBe('in-review');
    expect(view.narrative?.caseRecordId).toBe('demo.capability-case.payments-reliability');
    const stateFact = view.facts.find((entry) => entry.label === 'State');
    expect(stateFact?.stateKind).toBe('pending');
  });

  it('labels demo flow-created canonical cases as demo state', async () => {
    resetDemoCapabilityContext();
    const context = await getDemoCapabilityContext();
    await context.flow.startCase({
      ...framing('case-demo-walkthrough'),
      identity: { tenant: 'arena-demo', caseId: 'case-demo-walkthrough' },
      source: { type: 'user', tenant: 'arena-demo', principalId: 'demo-visitor' },
    } as ReturnType<typeof framing>);
    const view = await buildCaseListView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      corpusHash: context.corpusHash,
    });
    const card = view.cards.find((entry) => entry.recordId === 'case.arena-demo.case-demo-walkthrough');
    expect(card).toBeDefined();
    expect(card?.shape).toBe('canonical');
    const statusFact = card?.facts.find((entry) => entry.label === 'Status');
    expect(statusFact?.stateKind).toBe('demo-state');
    expect(card?.demo).toBe(true);
  });
});
