/**
 * B017 M1 — the lifecycle walk (the product backbone).
 *
 * One Capability Case followed through the canonical A005 state machine
 * via the B008 guided flow over the demo store's repository port (the
 * SAME runtime the /demo route handlers drive), asserting:
 *
 *   1. state-machine legality at EVERY hop (draft -> submitted ->
 *      triaged -> active -> resolved; evidence steps hold `active`);
 *   2. the append-only lifecycle event log grows monotonically and is
 *      never rewritten (sequence numbers strictly increase; prior
 *      entries byte-stable);
 *   3. the Task hop (compose-task stores TaskSpec proposals traced back
 *      to the case version + lifecycle state that motivated them) and
 *      the Environment hop (the task's pinned initial environment + the
 *      case's environment requirements);
 *   4. after EVERY hop, the same canonical case projects through all
 *      four reference roles with identity/tenancy preserved and ONLY
 *      the projection changing (B003 same-object/different-lens);
 *   5. illegal transitions are typed rejections at every state
 *      (fail-closed state machine — CAPABILITY_CASE_INVALID_TRANSITION);
 *   6. the seeded narrative case then walks the read-path story —
 *      Task -> Trajectory -> Evaluation -> Verification ->
 *      Certification -> Release — across the REAL surfaces
 *      (capability, evaluation, bodies) with truth labels intact.
 *
 * Deterministic: fixed corpus, injected fixed `at` timestamps (the
 * product-flows runtime reads no clock), no network, no wall-clock
 * dependence in any assertion.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { caseRecordId, taskRecordId } from '../../packages/product-flows/src/index.js';
import { CAPABILITY_CASE_ERROR_CODES } from '../../packages/capability-case/src/errors.js';
import { isTerminalCaseStatus } from '../../packages/capability-case/src/lifecycle.js';
import { projectCapabilityCase } from '../../packages/role-context/src/projections/capability-case-lenses.js';
import type { RoleProjection } from '../../packages/role-context/src/projections/projection.js';
import { GUIDED_FLOW_STEPS } from '../../packages/product-flows/src/definitions.js';
import { referenceFraming } from '../../apps/web/src/capability/flow-actions.js';
import {
  buildCaseDetailView,
  buildTaskDetailView,
} from '../../apps/web/src/capability/case-view.js';
import {
  CaseDetailView,
  TaskDetailView,
} from '../../apps/web/src/capability/capability-views.js';
import { resolveDemoCaseDetail, resolveDemoTask } from '../../apps/web/src/capability/case-routes.js';
import {
  resolveDemoEvaluationHome,
  resolveDemoCertificationExperience,
} from '../../apps/web/src/evaluation/evaluation-route.js';
import { EVALUATION_DEMO_IDS } from '../../apps/web/src/evaluation/fixtures.js';
import {
  resolveDemoBodyDetailExperience,
  resolveDemoBodiesStudioView,
} from '../../apps/web/src/bodies/bodies-route.js';
import { DEMO_NARRATIVE } from '../../packages/demo/src/narrative.js';
import { buildDemoLandingView } from '../../apps/web/src/demo/narrative-view.js';
import { DemoLandingView } from '../../apps/web/src/demo/demo-landing-view.js';
import { toCapabilityCaseView } from './driver/case-lens-source.js';
import { bootDemoApp, FOUR_REFERENCE_ROLES, resetDemoApp } from './driver/demo-boot.js';

const DEMO_CASE_ID = 'case-e2e-walk';
const IDENTITY = { tenant: 'arena-demo', caseId: DEMO_CASE_ID } as const;
const WALK_RECORD_ID = caseRecordId(IDENTITY);
/** Fixed, monotonic narrative timestamps (the runtime reads no clock). */
const AT = {
  frame: '2026-10-01T09:05:00.000Z',
  compose: '2026-10-01T09:10:00.000Z',
  run: '2026-10-01T09:15:00.000Z',
  observe: '2026-10-01T09:20:00.000Z',
  evaluate: '2026-10-01T09:25:00.000Z',
  decide: '2026-10-01T09:30:00.000Z',
} as const;

const ACTOR = Object.freeze({
  type: 'user',
  tenant: 'arena-demo',
  principalId: 'demo-visitor',
});

const NARRATIVE_RECORD_ID = 'demo.capability-case.payments-reliability';

interface HopCapture {
  readonly stepId: string;
  readonly status: string;
  readonly sequence: number;
  readonly history: readonly { readonly sequence: number; readonly kind: string }[];
  readonly projections: readonly {
    readonly roleId: string;
    readonly canonical: RoleProjection['canonical'];
    readonly payload: unknown;
  }[];
}

/** Canonical CapabilityCase -> the B003 projection input (honest mapping). */
function canonicalCaseToView(
  caseRecord: {
    readonly identity: { readonly tenant: string; readonly caseId: string };
    readonly version: string;
    readonly status: string;
    readonly observedFailure: { readonly summary: string };
    readonly desiredOutcome: string;
    readonly evidence: readonly { readonly digest: string }[];
    readonly unknowns: readonly string[];
    readonly lifecycle: readonly { readonly sequence: number; readonly kind: string }[];
  },
  recordId: string,
) {
  return {
    kind: 'capability-case' as const,
    tenant: caseRecord.identity.tenant,
    objectId: recordId,
    version: caseRecord.version,
    status: caseRecord.status,
    targetCapability: 'the-target-capability',
    observedFailure: caseRecord.observedFailure.summary,
    desiredOutcome: caseRecord.desiredOutcome,
    uncertainty: caseRecord.unknowns.length > 2 ? ('high' as const) : ('medium' as const),
    evidence: caseRecord.evidence.map((ref, index) => ({
      evidenceId: `ev-${String(index + 1)}`,
      stateKind: 'evidence' as const,
    })),
    missingCapabilities: [] as readonly string[],
    openTaskCount: 0,
    resolvedTaskCount: 0,
    jobHealth: 'healthy' as const,
  };
}

/**
 * The same-object/different-lens assertion: all four role projections
 * of ONE canonical case share the canonical identity and differ in
 * payload (and lens question).
 */
function assertFourRoleProjectionInvariants(hop: HopCapture): void {
  const { stepId, projections } = hop;
  expect(projections, `step ${stepId}: four reference projections`).toHaveLength(4);
  const first = projections[0];
  if (first === undefined) {
    throw new Error(`step ${stepId}: no projections captured (unreachable after length assert)`);
  }
  for (const projection of projections.slice(1)) {
    expect(
      projection.canonical,
      `step ${stepId}: role ${projection.roleId} preserves the canonical object identity`,
    ).toEqual(first.canonical);
  }
  expect(
    new Set(projections.map((p) => JSON.stringify(p.canonical))).size,
    `step ${stepId}: identity is shared (same-object rule)`,
  ).toBe(1);
  expect(
    new Set(projections.map((p) => JSON.stringify(p.payload))).size,
    `step ${stepId}: only the projection changes`,
  ).toBe(4);
  for (const projection of projections) {
    expect(projection.canonical.tenant, `step ${stepId}: tenancy preserved`).toBe('arena-demo');
  }
}

function capture(stepId: string, caseRecord: Parameters<typeof canonicalCaseToView>[0]): HopCapture {
  const view = canonicalCaseToView(caseRecord, WALK_RECORD_ID);
  const projections = FOUR_REFERENCE_ROLES.map((roleId) => {
    const projection = projectCapabilityCase(view, roleId);
    return { roleId, canonical: projection.canonical, payload: projection.payload };
  });
  const lifecycle = caseRecord.lifecycle;
  return {
    stepId,
    status: caseRecord.status,
    sequence: lifecycle[lifecycle.length - 1]?.sequence ?? 0,
    history: lifecycle.map((event) => ({ sequence: event.sequence, kind: event.kind })),
    projections,
  };
}

describe('B017 M1 — lifecycle walk (state-machine legality at every hop)', () => {
  it('boots the demo app seeded to the frozen corpus (labelled demo state)', async () => {
    const boot = await bootDemoApp();
    expect(boot.tenantId).toBe('arena-demo');
    expect(boot.facts.tenantId).toBe('arena-demo');
    expect(boot.corpusHashSummary).toHaveLength(8);
    expect(boot.facts.grantedRoleIds).toContain('owner');
    expect(boot.facts.grantedRoleIds).toContain('expert');
    expect(boot.facts.grantedRoleIds).toContain('agent-builder');
    expect(boot.facts.grantedRoleIds).toContain('researcher');
    await resetDemoApp();
  });

  it('walks the full guided flow with legality, append-only history and 4-role projection equality at every hop', async () => {
    const boot = await bootDemoApp();
    const flow = boot.flow;
    const hops: HopCapture[] = [];

    // --- hop 1: start-case (new -> draft) --------------------------------
    const started = await flow.startCase({
      ...referenceFraming('arena-demo'),
      identity: IDENTITY,
      source: { type: 'user', tenant: 'arena-demo', principalId: 'demo-visitor' },
    });
    expect(started.caseRecord.status, 'start-case lands in draft').toBe('draft');
    expect(started.event.kind).toBe('case-created');
    hops.push(capture('start-case', started.caseRecord));

    // --- hop 2: frame-gap (draft -> submitted) ---------------------------
    const framed = await flow.continueCase({
      stepId: 'frame-gap',
      identity: IDENTITY,
      actor: ACTOR,
      at: AT.frame,
    });
    expect(framed.caseRecord.status, 'frame-gap lands in submitted').toBe('submitted');
    expect(framed.event.kind).toBe('case-submitted');
    hops.push(capture('frame-gap', framed.caseRecord));

    // --- hop 3: compose-task (submitted -> triaged; the Task hop) --------
    const composed = await flow.continueCase({
      stepId: 'compose-task',
      identity: IDENTITY,
      actor: ACTOR,
      at: AT.compose,
      note: 'E2E triage rationale: reproducible failure with observable success conditions.',
    });
    expect(composed.caseRecord.status, 'compose-task lands in triaged').toBe('triaged');
    expect(composed.event.kind).toBe('case-triaged');
    // THE TASK HOP: TaskSpec proposals are stored and trace back to the
    // case version that motivated them (content-addressed derivation).
    expect(composed.taskSpecs, 'compose-task stores TaskSpec proposals').toBeDefined();
    const taskSpec = composed.taskSpecs?.[0];
    expect(taskSpec?.derivedFrom.caseRef.caseId).toBe(DEMO_CASE_ID);
    expect(taskSpec?.derivedFrom.caseRef.version).toBe(framed.caseRecord.version);
    // THE ENVIRONMENT HOP: the task pins its initial environment and the
    // case carries its environment requirements.
    expect(taskSpec?.initialState.environment.namespace).toBe('arena-demo');
    expect(
      composed.caseRecord.environmentRequirements.environments.length,
    ).toBeGreaterThan(0);
    hops.push(capture('compose-task', composed.caseRecord));

    // --- hop 4: run (triaged -> active) -----------------------------------
    const activated = await flow.continueCase({
      stepId: 'run',
      identity: IDENTITY,
      actor: ACTOR,
      at: AT.run,
    });
    expect(activated.caseRecord.status, 'run lands in active').toBe('active');
    expect(activated.event.kind).toBe('case-activated');
    hops.push(capture('run', activated.caseRecord));

    // --- hop 5: observe (active -> active; evidence appends) -------------
    const observed = await flow.continueCase({
      stepId: 'observe',
      identity: IDENTITY,
      actor: ACTOR,
      at: AT.observe,
      evidence: [
        {
          digest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          description: 'E2E observation: reproduced the failure under load.',
        },
      ],
    });
    expect(observed.caseRecord.status, 'observe holds active').toBe('active');
    expect(observed.event.kind).toBe('evidence-attached');
    expect(
      observed.caseRecord.evidence.length,
      'observe appends evidence (append-only growth)',
    ).toBe(started.caseRecord.evidence.length + 1);
    hops.push(capture('observe', observed.caseRecord));

    // --- hop 6: evaluate (active -> active; evaluation evidence) ----------
    const evaluated = await flow.continueCase({
      stepId: 'evaluate',
      identity: IDENTITY,
      actor: ACTOR,
      at: AT.evaluate,
      evidence: [
        {
          digest: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          description: 'E2E evaluation evidence: suite green on the fixed composition.',
        },
      ],
    });
    expect(evaluated.caseRecord.status, 'evaluate holds active').toBe('active');
    expect(evaluated.event.kind).toBe('evidence-attached');
    hops.push(capture('evaluate', evaluated.caseRecord));

    // --- hop 7: decide (active -> resolved; terminal) ---------------------
    const decided = await flow.continueCase({
      stepId: 'decide',
      identity: IDENTITY,
      actor: ACTOR,
      at: AT.decide,
      resolution: 'E2E resolution: the capability gap is closed for the observed failure.',
    });
    expect(decided.caseRecord.status, 'decide lands in resolved').toBe('resolved');
    expect(decided.event.kind).toBe('case-resolved');
    expect(isTerminalCaseStatus(decided.caseRecord.status), 'resolved is terminal').toBe(true);
    hops.push(capture('decide', decided.caseRecord));

    // ---- every hop: state legality against the frozen guided contract ----
    const stepByHop = new Map(GUIDED_FLOW_STEPS.map((step) => [step.stepId, step]));
    for (const hop of hops) {
      const step = stepByHop.get(hop.stepId);
      expect(step, `hop ${hop.stepId} is a frozen guided step`).toBeDefined();
      expect(hop.status, `hop ${hop.stepId} lands in its declared validTo`).toBe(step?.validTo);
    }

    // ---- every hop: append-only, monotone lifecycle history --------------
    for (let index = 1; index < hops.length; index += 1) {
      const previous = hops[index - 1] as HopCapture;
      const current = hops[index] as HopCapture;
      expect(current.history.length, `history grows monotonically at ${current.stepId}`).toBe(
        previous.history.length + 1,
      );
      expect(current.sequence, `event sequence strictly increases at ${current.stepId}`).toBeGreaterThan(
        previous.sequence,
      );
      expect(
        JSON.stringify(current.history.slice(0, previous.history.length)),
        `history prefix is byte-stable at ${current.stepId} (append-only)`,
      ).toBe(JSON.stringify(previous.history));
    }

    // ---- every hop: the four-role projection invariants ------------------
    for (const hop of hops) {
      assertFourRoleProjectionInvariants(hop);
    }

    await resetDemoApp();
  });

  it('rejects illegal transitions at every state with the canonical typed error (fail-closed)', async () => {
    const boot = await bootDemoApp();
    const flow = boot.flow;
    const framing = {
      ...referenceFraming('arena-demo'),
      identity: IDENTITY,
      source: { type: 'user', tenant: 'arena-demo', principalId: 'demo-visitor' },
    };
    await flow.startCase(framing);

    // From `draft`: every step whose validFrom is not `draft` is a typed
    // CAPABILITY_CASE_INVALID_TRANSITION rejection.
    for (const step of GUIDED_FLOW_STEPS) {
      if (step.stepId === 'start-case' || step.validFrom === 'draft') continue;
      await expect(
        flow.continueCase({ stepId: step.stepId, identity: IDENTITY, actor: ACTOR, at: AT.frame }),
        `step ${step.stepId} from draft is rejected`,
      ).rejects.toMatchObject({ code: CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION });
    }

    // Walk to submitted; `decide` (active-only) is still illegal.
    await flow.continueCase({ stepId: 'frame-gap', identity: IDENTITY, actor: ACTOR, at: AT.frame });
    await expect(
      flow.continueCase({
        stepId: 'decide',
        identity: IDENTITY,
        actor: ACTOR,
        at: AT.decide,
        resolution: 'too early',
      }),
    ).rejects.toMatchObject({ code: CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION });

    // Walk to triaged; `frame-gap` (draft-only) is now illegal.
    await flow.continueCase({
      stepId: 'compose-task',
      identity: IDENTITY,
      actor: ACTOR,
      at: AT.compose,
      note: 'triaged for capability development',
    });
    await expect(
      flow.continueCase({ stepId: 'frame-gap', identity: IDENTITY, actor: ACTOR, at: AT.frame }),
    ).rejects.toMatchObject({ code: CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION });

    // Cross-tenant actor is a typed rejection (tenant-scoped transitions).
    await expect(
      flow.continueCase({
        stepId: 'run',
        identity: IDENTITY,
        actor: { type: 'user', tenant: 'tenant-other', principalId: 'intruder' },
        at: AT.run,
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_FLOW_MALFORMED_INPUT' });

    // Terminal cases never transition again.
    await flow.continueCase({ stepId: 'run', identity: IDENTITY, actor: ACTOR, at: AT.run });
    await flow.continueCase({
      stepId: 'decide',
      identity: IDENTITY,
      actor: ACTOR,
      at: AT.decide,
      resolution: 'done',
    });
    for (const step of GUIDED_FLOW_STEPS) {
      if (step.stepId === 'start-case') continue;
      await expect(
        flow.continueCase({ stepId: step.stepId, identity: IDENTITY, actor: ACTOR, at: AT.decide }),
        `terminal case rejects ${step.stepId}`,
      ).rejects.toMatchObject({ code: CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION });
    }
    await resetDemoApp();
  });

  it('renders the walked case + task through the REAL views (read path after write)', async () => {
    const boot = await bootDemoApp();
    const flow = boot.flow;
    const framing = {
      ...referenceFraming('arena-demo'),
      identity: IDENTITY,
      source: { type: 'user', tenant: 'arena-demo', principalId: 'demo-visitor' },
    };
    await flow.startCase(framing);
    const composed = await flow
      .continueCase({ stepId: 'frame-gap', identity: IDENTITY, actor: ACTOR, at: AT.frame })
      .then(() =>
        flow.continueCase({
          stepId: 'compose-task',
          identity: IDENTITY,
          actor: ACTOR,
          at: AT.compose,
          note: 'triaged for the e2e render walk',
        }),
      );
    const taskSpec = composed.taskSpecs?.[0];
    expect(taskSpec).toBeDefined();

    // Case detail through the canonical read path (the /demo/cases/:id view).
    const caseDetail = await buildCaseDetailView({
      mode: 'demo',
      facts: boot.facts,
      port: boot.port,
      recordId: WALK_RECORD_ID,
      corpusHash: boot.corpusHash,
    });
    expect(caseDetail.shape).toBe('canonical');
    expect(caseDetail.status).toBe('triaged');
    expect(caseDetail.demo.isDemo).toBe(true);
    const caseHtml = renderToStaticMarkup(createElement(CaseDetailView, { view: caseDetail }));
    expect(caseHtml).toContain('data-arena-demo-banner="true"');
    expect(caseHtml).toContain('data-arena-case-shape="canonical"');

    // Task detail (the Task hop, read back through the REAL task view).
    const walkTaskRecordId = taskRecordId({
      tenant: taskSpec?.identity.tenant ?? 'arena-demo',
      taskId: taskSpec?.identity.taskId ?? 'task-unknown',
    });
    const taskDetail = await buildTaskDetailView({
      mode: 'demo',
      facts: boot.facts,
      port: boot.port,
      taskId: walkTaskRecordId,
      corpusHash: boot.corpusHash,
    });
    expect(taskDetail.shape).toBe('task-spec');
    expect(taskDetail.demo.isDemo).toBe(true);
    const taskHtml = renderToStaticMarkup(createElement(TaskDetailView, { view: taskDetail }));
    expect(taskHtml).toContain('data-arena-mode="demo"');
    // The task is a PROPOSAL — truthfully labelled, never a claimed result.
    expect(taskHtml).toContain('proposal');

    await resetDemoApp();
  });
});

describe('B017 M1 — the read-path story walk (Task -> Trajectory -> Evaluation -> Verification -> Certification -> Release)', () => {
  it('the frozen narrative script walks the story with the correct truth labels', async () => {
    const steps = DEMO_NARRATIVE.steps;
    const byId = new Map(steps.map((step) => [step.stepId, step]));
    // The story backbone, in narrative order, each hop truth-labelled.
    const expected: ReadonlyArray<[string, string]> = [
      ['task-run', 'simulation-replay'],
      ['model-output', 'model-output'],
      ['evaluation', 'evaluation-result'],
      ['verification', 'evidence'],
      ['certification', 'certification'],
    ];
    for (const [stepId, truth] of expected) {
      const step = byId.get(stepId);
      expect(step, `narrative step ${stepId} exists`).toBeDefined();
      expect(step?.truth, `narrative step ${stepId} carries its truth label`).toBe(truth);
    }
    // The narrative steps are canonically ordered.
    const orders = steps.map((step) => step.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);

    // The demo landing renders the story (B006 surface, owner variant).
    const runtimeModule = await import('../../apps/web/src/demo/runtime.js');
    const runtime = await runtimeModule.getDemoRuntime();
    const landing = await buildDemoLandingView({
      variantId: 'owner',
      read: (recordId) => runtime.reads.read(recordId),
      inventory: () => runtime.reads.inventory(),
      corpusHash: runtime.corpusHash,
    });
    const html = renderToStaticMarkup(createElement(DemoLandingView, { view: landing }));
    expect(html).toContain('data-arena-route="demo"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('A task run, replayed');
    expect(html).toContain('Evaluation: did the body meet its suite?');
    expect(html).toContain('Certification: a distinct milestone');
    await resetDemoApp();
  });

  it('reads the seeded narrative case through the canonical read path and projects it through all four roles', async () => {
    const boot = await bootDemoApp();
    const read = await boot.port.read(NARRATIVE_RECORD_ID);
    expect(read.tenantId).toBe('arena-demo');
    expect(read.kind).toBe('capability-case');
    const view = toCapabilityCaseView(read);
    expect(view.tenant).toBe('arena-demo');
    expect(view.objectId).toBe(NARRATIVE_RECORD_ID);
    expect(view.currentBodyVersion).toBe('1.1.0');
    expect(view.openTaskCount).toBe(1);
    expect(view.resolvedTaskCount).toBe(2);
    expect(view.lastEvaluation?.result).toBe('pass');

    // The RC1.0 lens questions, verbatim, for the four reference roles.
    const expectedQuestions: Record<string, string> = {
      owner: 'Why is my agent struggling?',
      expert: 'What work am I being asked to perform?',
      'agent-builder': 'What capability is missing from the Body?',
      researcher: 'What evidence supports the capability hypothesis?',
    };
    for (const roleId of FOUR_REFERENCE_ROLES) {
      const projection = projectCapabilityCase(view, roleId);
      expect(projection.lensQuestion).toBe(expectedQuestions[roleId]);
    }
    await resetDemoApp();
  });

  it('walks the story across the REAL surfaces with truth labels intact', async () => {
    await bootDemoApp();

    // --- Task (narrative task detail through the REAL task view) ---------
    const taskView = await resolveDemoTask('task-reproduce');
    expect(taskView.shape).toBe('narrative');
    expect(taskView.narrative?.taskId).toBe('task-reproduce');
    expect(taskView.narrative?.state).toBe('completed');
    const taskHtml = renderToStaticMarkup(createElement(TaskDetailView, { view: taskView }));
    expect(taskHtml).toContain('data-arena-mode="demo"');
    expect(taskHtml).toContain('data-arena-demo-banner="true"');

    // --- Trajectory (the case record's replayed trajectory, read canonically) ---
    const narrativeDetail = await resolveDemoCaseDetail(NARRATIVE_RECORD_ID);
    expect('unreadable' in narrativeDetail).toBe(false);
    if ('unreadable' in narrativeDetail) return;
    expect(narrativeDetail.shape).toBe('narrative');
    const narrativeHtml = renderToStaticMarkup(
      createElement(CaseDetailView, { view: narrativeDetail }),
    );
    expect(narrativeHtml).toContain('data-arena-narrative-case="true"');
    expect(narrativeHtml).toContain('data-arena-demo-banner="true"');

    // --- Evaluation (the /demo/evaluation surface over the B012 corpus) --
    const evaluationHome = await resolveDemoEvaluationHome();
    expect(evaluationHome.demo.isDemo).toBe(true);
    expect(evaluationHome.distinctionNote.length).toBeGreaterThan(0);
    expect(evaluationHome.reports.length).toBeGreaterThan(0);
    expect(evaluationHome.verifications.length).toBeGreaterThan(0);
    expect(evaluationHome.certifications.length).toBeGreaterThan(0);
    // Evaluation is its own truth class, distinct from verification and
    // certification — the report row carries the evaluation-result mark.
    expect(evaluationHome.reports[0]?.truthClass).toBe('evaluation-result');
    // The narrative suite verdict is a real aggregate judgment with metrics.
    expect(evaluationHome.reports[0]?.aggregate?.outcome).toBe('meets-criteria');
    expect(evaluationHome.reports[0]?.metrics.length).toBeGreaterThan(0);
    // The certification claims section reads through the canonical read
    // path (the B006 corpus certification record is a claim).
    expect(evaluationHome.claims.length).toBeGreaterThan(0);

    // --- Verification (independent checks — its own concept) -------------
    expect(evaluationHome.verifications[0]?.truthClass).toBe('verified-fact');
    expect(evaluationHome.verifications[0]?.outcome).toBe('pass');
    expect(evaluationHome.verifications[0]?.verifier).toBeDefined();

    // --- Certification (the /demo/evaluation/certification/:id surface) --
    const certification = await resolveDemoCertificationExperience(
      EVALUATION_DEMO_IDS.certificationRunA,
    );
    expect('view' in certification).toBe(true);
    if (!('view' in certification)) return;
    expect(certification.view.kind).toBe('certification');
    if (certification.view.kind !== 'certification') return;
    expect(certification.view.truthClass).toBe('certification');
    // Certification covers the tested COMPOSITION (body@version + the
    // five-part tuple), never the model alone.
    expect(certification.view.composition.bodyVersion.name).toBe('software-engineer-body');
    expect(certification.view.composition.bodyVersion.version).toBe('1.1.0');
    expect(certification.view.verdict).toBe('satisfied');

    // --- Release (the certified body release in the bodies studio) -------
    const bodyDetail = await resolveDemoBodyDetailExperience('demo.agent-body.software-engineer');
    expect(bodyDetail.status).toBe('body');
    if (bodyDetail.status !== 'body') return;
    expect(bodyDetail.view.demo.isDemo).toBe(true);
    expect(bodyDetail.view.card.identity.versioning.currentVersion).toBe('1.1.0');
    expect(bodyDetail.view.claims.length).toBeGreaterThan(0);
    const bodyHtml = renderToStaticMarkup(
      createElement(
        (await import('../../apps/web/src/bodies/bodies-detail-view.js')).BodyDetailView,
        { view: bodyDetail.view },
      ),
    );
    expect(bodyHtml).toContain('data-arena-studio-mode="demo"');
    expect(bodyHtml).toContain('data-arena-version-current="1.1.0"');
    // The RELEASE hop: the certified release renders as a claim scoped to
    // the tested composition body-software-engineer@1.1.0.
    expect(bodyHtml).toContain('data-arena-claim-scope="body-software-engineer@1.1.0"');
    expect(bodyHtml).toContain('data-arena-truth="certification"');

    await resetDemoApp();
  });

  it('cleans up after itself: reset restores the identical corpus hash', async () => {
    const boot = await bootDemoApp();
    // A write through the demo store...
    await boot.flow.startCase({
      ...referenceFraming('arena-demo'),
      identity: { tenant: 'arena-demo', caseId: 'case-e2e-reset-probe' },
      source: { type: 'user', tenant: 'arena-demo', principalId: 'demo-visitor' },
    });
    // ...then the total reset...
    resetDemoApp();
    const runtimeModule = await import('../../apps/web/src/demo/runtime.js');
    const runtime = await runtimeModule.getDemoRuntime();
    // ...reseeds to the IDENTICAL corpus hash.
    expect(runtime.corpusHash).toBe(boot.corpusHash);
    const cockpitModule = await import('../../apps/web/src/cockpit/runtime.js');
    const context = await cockpitModule.getDemoCockpitContext();
    const page = await context.port.scroll('capability-case');
    expect(page.records.map((record) => record.recordId)).toEqual([NARRATIVE_RECORD_ID]);
    await resetDemoApp();
  });

  it('the TWO reference Bodies render in the bodies studio (A028 + A029)', async () => {
    await bootDemoApp();
    const studio = await resolveDemoBodiesStudioView('agent-builder');
    expect(studio.demo.isDemo).toBe(true);
    const recordIds = studio.bodies.map((entry) => entry.card.recordId);
    expect(recordIds).toContain('demo.agent-body.software-engineer');
    expect(recordIds).toContain('demo.agent-body.structural-engineer');
    expect(studio.bodies.length).toBe(2);
    // Both carry their lineage (current versions 1.1.0 and 1.0.0).
    const software = studio.bodies.find(
      (entry) => entry.card.recordId === 'demo.agent-body.software-engineer',
    );
    const structural = studio.bodies.find(
      (entry) => entry.card.recordId === 'demo.agent-body.structural-engineer',
    );
    expect(software?.card.identity.versioning.currentVersion).toBe('1.1.0');
    expect(structural?.card.identity.versioning.currentVersion).toBe('1.0.0');
    await resetDemoApp();
  });
});
