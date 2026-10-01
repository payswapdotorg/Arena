import { describe, expect, it } from 'vitest';

/**
 * Guided flow-action tests (Work Order B008): the start/continue
 * affordances execute through the product-flows runtime with the B004
 * origin-check posture, and every rejection surfaces its TYPED code
 * honestly (canonical CAPABILITY_CASE_* codes verbatim — never a fake
 * success, never a re-coded vocabulary).
 */

import { FakeControlPlaneRepository, ManualClock } from '../../../../packages/persistence/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import { executeGuidedAction, parseGuidedAction, referenceFraming } from './flow-actions.js';
import { createCapabilityFlowRuntime } from './runtime.js';

const TENANT = 'tenant-alpha';
const ACTOR = Object.freeze({
  type: 'user',
  tenant: TENANT,
  principalId: 'worker-one',
} as const);

function postRequest(body: Record<string, string>, origin = 'https://arena.test'): Request {
  const form = new URLSearchParams(body);
  return new Request('https://arena.test/cases/start', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

async function freshFlow() {
  const repository = new FakeControlPlaneRepository({ clock: new ManualClock(DEMO_NARRATIVE_EPOCH_MS) });
  const flow = await createCapabilityFlowRuntime({ repository });
  return { flow, repository };
}

async function startReferenceCase(flow: Awaited<ReturnType<typeof createCapabilityFlowRuntime>>): Promise<void> {
  const framing = referenceFraming(TENANT);
  await flow.startCase(framing);
}

describe('parseGuidedAction (the guided form grammar)', () => {
  it('parses a start form with the user-edited narrative fields', () => {
    const form = new FormData();
    form.set('intent', 'start');
    form.set('caseId', 'case-my-gap');
    form.set('problemStatement', 'My agent cannot summarize audit trails.');
    form.set('unknowns', 'first unknown\nsecond unknown');
    const action = parseGuidedAction(form, { tenantId: TENANT, principalLabel: 'worker-one' });
    if (action.kind !== 'start') throw new Error('expected start');
    expect(action.framing.identity.caseId).toBe('case-my-gap');
    expect(action.framing.identity.tenant).toBe(TENANT);
    expect(action.framing.problemStatement).toBe('My agent cannot summarize audit trails.');
    expect(action.framing.unknowns).toEqual(['first unknown', 'second unknown']);
    // Structural refs stay canonical (content-addressed; user-editable in the form).
    expect(action.framing.evidence[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('parses a continue form (stepId + caseId + step-specific fields)', () => {
    const form = new FormData();
    form.set('stepId', 'compose-task');
    form.set('caseId', 'case-my-gap');
    form.set('note', 'Selected: reproducible failure.');
    const action = parseGuidedAction(form, { tenantId: TENANT, principalLabel: 'worker-one' });
    if (action.kind !== 'continue') throw new Error('expected continue');
    expect(action.stepId).toBe('compose-task');
    expect(action.note).toBe('Selected: reproducible failure.');
  });

  it('rejects a continue form without stepId/caseId (malformed input)', () => {
    const form = new FormData();
    expect(() => parseGuidedAction(form, { tenantId: TENANT, principalLabel: 'worker-one' })).toThrow();
  });
});

describe('executeGuidedAction (origin-check → flow runtime → typed outcome)', () => {
  it('rejects a request without an Origin header (B004 CSRF posture, 403 family)', async () => {
    const { flow } = await freshFlow();
    const request = new Request('https://arena.test/cases/start', { method: 'POST' });
    const outcome = await executeGuidedAction({ request, tenantId: TENANT, actor: ACTOR, flow });
    expect(outcome.status).toBe('origin-rejected');
  });

  it('rejects a foreign Origin (cross-site form post)', async () => {
    const { flow } = await freshFlow();
    const outcome = await executeGuidedAction({
      request: postRequest({ intent: 'start' }, 'https://evil.example'),
      tenantId: TENANT,
      actor: ACTOR,
      flow,
    });
    expect(outcome.status).toBe('origin-rejected');
  });

  it('starts a case through the runtime and reports the record id', async () => {
    const { flow, repository } = await freshFlow();
    const outcome = await executeGuidedAction({
      request: postRequest({
        intent: 'start',
        caseId: 'case-origin-checked',
        problemStatement: 'The agent cannot summarize audit trails.',
      }),
      tenantId: TENANT,
      actor: ACTOR,
      flow,
    });
    expect(outcome.status).toBe('done');
    if (outcome.status === 'done') {
      expect(outcome.recordId).toBe('case.tenant-alpha.case-origin-checked');
      expect(outcome.stepId).toBe('start-case');
    }
    const stored = await repository.get('case.tenant-alpha.case-origin-checked');
    expect(stored?.kind).toBe('capability-case');
  });

  it('continues a case through the canonical lifecycle (frame-gap on a draft)', async () => {
    const { flow } = await freshFlow();
    await startReferenceCase(flow);
    const outcome = await executeGuidedAction({
      request: postRequest({
        stepId: 'frame-gap',
        caseId: 'case-your-first-gap',
        note: 'Framing submitted for triage.',
      }),
      tenantId: TENANT,
      actor: ACTOR,
      flow,
    });
    expect(outcome.status).toBe('done');
  });

  it('surfaces the CANONICAL typed rejection verbatim on an invalid transition', async () => {
    const { flow } = await freshFlow();
    await startReferenceCase(flow);
    // decide is valid from active; the case is draft.
    const outcome = await executeGuidedAction({
      request: postRequest({
        stepId: 'decide',
        caseId: 'case-your-first-gap',
        resolution: 'too early',
      }),
      tenantId: TENANT,
      actor: ACTOR,
      flow,
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.code).toBe('CAPABILITY_CASE_INVALID_TRANSITION');
      expect(outcome.message).toContain('decide');
    }
  });

  it('surfaces the canonical rejection for a missing triage rationale', async () => {
    const { flow } = await freshFlow();
    await startReferenceCase(flow);
    await flow.continueCase({
      stepId: 'frame-gap',
      identity: { tenant: TENANT, caseId: 'case-your-first-gap' },
      actor: ACTOR,
      at: '2026-10-01T10:00:00.000Z',
    });
    const outcome = await executeGuidedAction({
      request: postRequest({ stepId: 'compose-task', caseId: 'case-your-first-gap' }),
      tenantId: TENANT,
      actor: ACTOR,
      flow,
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.code).toBe('CAPABILITY_CASE_INVALID_TRANSITION');
    }
  });

  it('surfaces the canonical DUPLICATE_EVIDENCE rejection on observe replays', async () => {
    const { flow } = await freshFlow();
    await startReferenceCase(flow);
    const identity = { tenant: TENANT, caseId: 'case-your-first-gap' };
    await flow.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: '2026-10-01T10:00:00.000Z' });
    await flow.continueCase({ stepId: 'compose-task', identity, actor: ACTOR, at: '2026-10-01T11:00:00.000Z', note: 'selected' });
    await flow.continueCase({ stepId: 'run', identity, actor: ACTOR, at: '2026-10-01T12:00:00.000Z' });
    // Re-attach the framing's own evidence digest → canonical duplicate rejection.
    const outcome = await executeGuidedAction({
      request: postRequest({
        stepId: 'observe',
        caseId: 'case-your-first-gap',
        evidenceDigest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        evidenceDescription: 'duplicate',
      }),
      tenantId: TENANT,
      actor: ACTOR,
      flow,
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.code).toBe('CAPABILITY_CASE_DUPLICATE_EVIDENCE');
    }
  });

  it('surfaces the flow typed rejection for an unknown step id', async () => {
    const { flow } = await freshFlow();
    await startReferenceCase(flow);
    const outcome = await executeGuidedAction({
      request: postRequest({ stepId: 'teleport', caseId: 'case-your-first-gap' }),
      tenantId: TENANT,
      actor: ACTOR,
      flow,
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.code).toBe('PRODUCT_FLOW_UNKNOWN_STEP');
    }
  });

  it('surfaces the flow typed rejection for a missing case', async () => {
    const { flow } = await freshFlow();
    const outcome = await executeGuidedAction({
      request: postRequest({ stepId: 'frame-gap', caseId: 'case-never-started' }),
      tenantId: TENANT,
      actor: ACTOR,
      flow,
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.code).toBe('PRODUCT_FLOW_CASE_NOT_FOUND');
    }
  });

  it('rejects a non-form body (malformed input)', async () => {
    const { flow } = await freshFlow();
    const request = new Request('https://arena.test/cases/start', {
      method: 'POST',
      headers: { origin: 'https://arena.test' },
      body: 'not a form',
    });
    const outcome = await executeGuidedAction({ request, tenantId: TENANT, actor: ACTOR, flow });
    expect(outcome.status).toBe('rejected');
  });
});
