/**
 * B017 M1 — the served-app walk (HTTP over the REAL Next.js server).
 *
 * This is the transport-level layer of the product E2E: the runner
 * (tests/product-e2e/run.mjs) boots the built app (`next start`) on
 * localhost, and this suite drives it over HTTP exactly the way a
 * browser would — GET the demo surfaces, POST the guided-action forms
 * (the house JavaScript-free posture, origin-checked), follow the
 * redirect contract, and reset through POST /demo/reset.
 *
 * Determinism: the corpus is frozen; the walked case's event timestamps
 * carry the server's wall clock (the flow runtime's injected `at`), so
 * assertions target STATE and IDENTITY, never timestamps. No network
 * beyond localhost.
 *
 * Skipped unless ARENA_E2E_BASE_URL is set (the runner sets it) — a bare
 * `vitest run` without the runner cannot hang on a missing server.
 */

import { describe, expect, it } from 'vitest';

const BASE = process.env.ARENA_E2E_BASE_URL;
const NARRATIVE_RECORD_ID = 'demo.capability-case.payments-reliability';
const WALK_CASE_ID = 'case-http-walk';
const WALK_RECORD_ID = `case.arena-demo.${WALK_CASE_ID}`;
const ORIGIN = BASE ?? 'http://localhost:31317';

interface FormPostResult {
  readonly status: number;
  readonly location: string | null;
  readonly body: string;
}

/** Normalize a redirect target to path + query (Response.redirect is absolute). */
function locationTarget(location: string | null): string {
  if (location === null) return '<null>';
  const url = new URL(location, BASE);
  return `${url.pathname}${url.search}`;
}

async function get(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  return { status: response.status, body: await response.text() };
}

async function postForm(path: string, fields: Record<string, string>, origin = ORIGIN): Promise<FormPostResult> {
  const form = new URLSearchParams(fields);
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    body: await response.text(),
  };
}

describe.skipIf(BASE === undefined)('B017 M1 — served app (HTTP over next start)', () => {
  it('serves the demo landing and the core demo surfaces with labelling intact', async () => {
    const landing = await get('/demo');
    expect(landing.status).toBe(200);
    expect(landing.body).toContain('data-arena-demo-banner="true"');
    expect(landing.body).toContain('A task run, replayed');

    const cases = await get('/demo/cases');
    expect(cases.status).toBe(200);
    expect(cases.body).toContain('data-arena-case-shape="narrative"');
    expect(cases.body).toContain(NARRATIVE_RECORD_ID);

    const cockpit = await get('/demo/cockpit');
    expect(cockpit.status).toBe(200);
    expect(cockpit.body).toContain('data-arena-route="cockpit"');
    expect(cockpit.body).toContain('data-arena-cockpit-mode="demo"');

    const evaluation = await get('/demo/evaluation');
    expect(evaluation.status).toBe(200);
    expect(evaluation.body).toContain('evaluation');

    const operations = await get('/demo/operations');
    expect(operations.status).toBe(200);

    const capacity = await get('/demo/operations/capacity');
    expect(capacity.status).toBe(200);
    // Fail-closed capacity truth is user-visible on the served page.
    expect(capacity.body).toContain('fails closed');
  });

  it('serves the four role projections of the SAME case with identity preserved and lens changed', async () => {
    const htmls = await Promise.all(
      ['owner', 'expert', 'agent-builder', 'researcher'].map((role) =>
        get(`/demo/cases/${encodeURIComponent(NARRATIVE_RECORD_ID)}?role=${role}`),
      ),
    );
    for (const { status, body } of htmls) {
      expect(status).toBe(200);
      expect(body).toContain(NARRATIVE_RECORD_ID);
      expect(body).toContain('data-arena-narrative-case="true"');
      expect(body).toContain('data-arena-demo-banner="true"');
      expect(body).toContain('arena-demo');
    }
    expect(htmls[0]?.body).toContain('Why is my agent struggling, and what outcome do I need?');
    expect(htmls[1]?.body).toContain('What work am I being asked to perform?');
    expect(htmls[2]?.body).toContain('What capability is missing from the Body?');
    expect(htmls[3]?.body).toContain('What evidence supports the capability hypothesis?');
    expect(new Set(htmls.map((entry) => entry.body))).toHaveLength(4);
  });

  it('walks the full lifecycle over the REAL form POSTs (redirect contract at every hop)', async () => {
    // Fresh demo state first (self-contained regardless of prior runs).
    const reset = await postForm('/demo/reset', {});
    expect([303, 200]).toContain(reset.status);

    // start-case: POST -> 303 to the new record surface.
    const started = await postForm('/demo/cases/start/submit', {
      intent: 'start',
      caseId: WALK_CASE_ID,
    });
    expect(started.status).toBe(303);
    expect(locationTarget(started.location)).toBe(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}`);

    // The record surface renders the case in draft.
    const draft = await get(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}`);
    expect(draft.status).toBe(200);
    expect(draft.body).toContain('data-arena-case-shape="canonical"');
    expect(draft.body).toContain('draft');

    // frame-gap -> submitted
    const framed = await postForm(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}/continue`, {
      stepId: 'frame-gap',
      caseId: WALK_CASE_ID,
    });
    expect(framed.status).toBe(303);
    expect(locationTarget(framed.location)).toBe(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}`);

    // compose-task -> triaged (the Task hop: a TaskSpec proposal is stored)
    const composed = await postForm(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}/continue`, {
      stepId: 'compose-task',
      caseId: WALK_CASE_ID,
      note: 'http-walk triage rationale',
    });
    expect(composed.status).toBe(303);

    // run -> active
    const activated = await postForm(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}/continue`, {
      stepId: 'run',
      caseId: WALK_CASE_ID,
    });
    expect(activated.status).toBe(303);

    // observe -> active (evidence appends)
    const observed = await postForm(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}/continue`, {
      stepId: 'observe',
      caseId: WALK_CASE_ID,
      evidenceDigest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      evidenceDescription: 'http-walk observation',
    });
    expect(observed.status).toBe(303);

    // evaluate -> active
    const evaluated = await postForm(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}/continue`, {
      stepId: 'evaluate',
      caseId: WALK_CASE_ID,
      evidenceDigest: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      evidenceDescription: 'http-walk evaluation evidence',
    });
    expect(evaluated.status).toBe(303);

    // decide -> resolved (terminal)
    const decided = await postForm(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}/continue`, {
      stepId: 'decide',
      caseId: WALK_CASE_ID,
      resolution: 'http-walk resolution: gap closed',
    });
    expect(decided.status).toBe(303);

    // The final surface renders the RESOLVED canonical case with its
    // append-only history.
    const resolved = await get(`/demo/cases/${encodeURIComponent(WALK_RECORD_ID)}`);
    expect(resolved.status).toBe(200);
    expect(resolved.body).toContain('resolved');
    expect(resolved.body).toContain('case-resolved');
    expect(resolved.body).toContain('evidence-attached');

    // The case list now carries BOTH the seeded narrative case and the
    // walked canonical case.
    const list = await get('/demo/cases');
    expect(list.body).toContain(NARRATIVE_RECORD_ID);
    expect(list.body).toContain(WALK_RECORD_ID);
  });

  it('rejects a foreign Origin with 403 and an illegal transition with the typed code (fail-closed over HTTP)', async () => {
    // A FRESH case for deterministic illegal-transition checks (this test
    // must not depend on the walk test's terminal state).
    const caseId = 'case-http-illegal';
    const recordId = `case.arena-demo.${caseId}`;
    const started = await postForm('/demo/cases/start/submit', {
      intent: 'start',
      caseId,
    });
    expect(started.status).toBe(303);

    // The B004 CSRF posture: a foreign origin never reaches the write.
    const foreign = await postForm(
      '/demo/cases/start/submit',
      { intent: 'start', caseId: 'case-foreign-origin' },
      'https://evil.example',
    );
    expect(foreign.status).toBe(403);

    // A missing stepId is a typed malformed-input rejection surfaced via
    // the honest redirect (?flowError=), never a fake success.
    const malformed = await postForm(`/demo/cases/${encodeURIComponent(recordId)}/continue`, {
      caseId,
    });
    expect(malformed.status).toBe(303);
    expect(locationTarget(malformed.location)).toContain('flowError=');

    // An illegal transition (`decide` requires active; this case is in
    // draft) redirects with the canonical typed error code.
    const illegal = await postForm(`/demo/cases/${encodeURIComponent(recordId)}/continue`, {
      stepId: 'decide',
      caseId,
      resolution: 'too early',
    });
    expect(illegal.status).toBe(303);
    expect(locationTarget(illegal.location)).toContain(
      'flowError=CAPABILITY_CASE_INVALID_TRANSITION',
    );
  });

  it('resets the demo corpus deterministically (the product reset semantics)', async () => {
    const reset = await postForm('/demo/reset', {});
    expect([303, 200]).toContain(reset.status);
    const list = await get('/demo/cases');
    // The corpus records are reseeded: the seeded narrative case is back.
    expect(list.body).toContain(NARRATIVE_RECORD_ID);
    // PRODUCT TRUTH (B006 semantics): /demo/reset drops + reseeds the
    // CORPUS records; guided-walk writes (non-corpus records) persist
    // until the server process restarts, which is the total reset —
    // the runner performs it after every battery run (cleanup below).
    expect(list.body).toContain(WALK_RECORD_ID);
  });
});
