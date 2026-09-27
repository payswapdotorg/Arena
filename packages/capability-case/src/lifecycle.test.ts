/**
 * Lifecycle suite (Work Order A005 gate 3 + gate 4 + gate 6): the
 * DRAFT → SUBMITTED → TRIAGED → ACTIVE → RESOLVED/SUPERSEDED state machine,
 * append-only event history, terminal finality, supersession transitions
 * and evidence discipline.
 */

import { describe, expect, it } from 'vitest';
import {
  CASE_LIFECYCLE_EVENT_KINDS,
  CASE_STATUSES,
  CASE_TERMINAL_STATUSES,
  activateCase,
  assertAppendOnly,
  attachEvidence,
  isCaseLifecycleEvent,
  isCaseStatus,
  isTerminalCase,
  isTerminalCaseStatus,
  resolveCase,
  submitCase,
  supersedeCase,
  toCaseStatus,
  triageCase,
} from './lifecycle.js';
import { createCapabilityCase } from './case.js';
import { CapabilityCaseError } from './errors.js';
import {
  ACTOR,
  ACTOR_SERVICE,
  AT_EVEN_LATER,
  AT_LATER,
  DIGEST_A,
  DIGEST_B,
  validCaseInput,
} from './test-support.js';

async function draftCase() {
  return createCapabilityCase(validCaseInput());
}

async function submittedCase() {
  return submitCase(await draftCase(), { at: AT_LATER, actor: ACTOR });
}

async function triagedCase() {
  return triageCase(await submittedCase(), {
    at: AT_LATER,
    actor: ACTOR_SERVICE,
    note: 'High expected information value; capability gap confirmed.',
  });
}

async function activeCase() {
  return activateCase(await triagedCase(), { at: AT_EVEN_LATER, actor: ACTOR_SERVICE });
}

describe('status vocabulary (gate 3)', () => {
  it('enumerates the closed status set and the terminal subset', () => {
    expect(CASE_STATUSES).toEqual([
      'draft',
      'submitted',
      'triaged',
      'active',
      'resolved',
      'superseded',
    ]);
    expect(CASE_TERMINAL_STATUSES).toEqual(['resolved', 'superseded']);
    expect(isCaseStatus('draft')).toBe(true);
    expect(isCaseStatus('open')).toBe(false);
    expect(() => toCaseStatus('closed')).toThrow(/unknown case status/);
    expect(isTerminalCaseStatus('resolved')).toBe(true);
    expect(isTerminalCaseStatus('active')).toBe(false);
  });
});

describe('the happy-path lifecycle (positive)', () => {
  it('DRAFT → SUBMITTED → TRIAGED → ACTIVE → RESOLVED with events', async () => {
    const draft = await draftCase();
    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    const triaged = await triageCase(submitted, {
      at: AT_LATER,
      actor: ACTOR_SERVICE,
      note: 'Confirmed capability gap.',
    });
    const active = await activateCase(triaged, { at: AT_EVEN_LATER, actor: ACTOR_SERVICE });
    const resolved = await resolveCase(active, {
      at: AT_EVEN_LATER,
      actor: ACTOR_SERVICE,
      resolution: 'Netting skill shipped in invoicing-agent 3.3.0 and verified.',
    });

    expect(draft.status).toBe('draft');
    expect(submitted.status).toBe('submitted');
    expect(triaged.status).toBe('triaged');
    expect(active.status).toBe('active');
    expect(resolved.status).toBe('resolved');
    expect(isTerminalCase(resolved)).toBe(true);

    // Append-only history: exactly one event per transition, in order.
    const kinds = resolved.lifecycle.map((event) => event.kind);
    expect(kinds).toEqual([
      'case-created',
      'case-submitted',
      'case-triaged',
      'case-activated',
      'case-resolved',
    ]);
    expect(
      resolved.lifecycle.map((event) => event.sequence),
    ).toEqual([1, 2, 3, 4, 5]);
    for (const event of resolved.lifecycle) {
      expect(isCaseLifecycleEvent(event)).toBe(true);
    }

    // Every state change produces a NEW content address; prior states stay
    // immutable and addressable.
    const digests = new Set([draft, submitted, triaged, active, resolved].map((c) => c.digest));
    expect(digests.size).toBe(5);
    expect(submitted.digest).not.toBe(draft.digest);
  });

  it('transitions are PURE: the input case is never modified', async () => {
    const draft = await draftCase();
    const before = draft.status;
    const eventsBefore = draft.lifecycle.length;
    await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    expect(draft.status).toBe(before);
    expect(draft.lifecycle.length).toBe(eventsBefore);
  });

  it('the event log prefix is preserved verbatim (append-only)', async () => {
    const draft = await draftCase();
    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    expect(submitted.lifecycle[0]).toBe(draft.lifecycle[0]); // identical reference
    const triaged = await triageCase(submitted, {
      at: AT_LATER,
      actor: ACTOR_SERVICE,
      note: 'rationale',
    });
    expect(triaged.lifecycle[0]).toBe(draft.lifecycle[0]);
    expect(triaged.lifecycle[1]).toBe(submitted.lifecycle[1]);
  });

  it('each state carries its own content address and stays frozen', async () => {
    const draft = await draftCase();
    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    expect(Object.isFrozen(submitted)).toBe(true);
    expect(Object.isFrozen(submitted.lifecycle)).toBe(true);
    expect(Object.isFrozen(submitted.lifecycle[1])).toBe(true);
    // the DRAFT state is still addressable by ITS digest
    expect(draft.digest).not.toBe(submitted.digest);
  });
});

describe('illegal transitions (negative — state machine discipline)', () => {
  it('a draft case cannot be triaged, activated or resolved directly', async () => {
    const draft = await draftCase();
    await expect(
      triageCase(draft, { at: AT_LATER, actor: ACTOR_SERVICE, note: 'x' }),
    ).rejects.toThrow(/cannot transition from draft/);
    await expect(activateCase(draft, { at: AT_LATER, actor: ACTOR_SERVICE })).rejects.toThrow(
      /cannot transition from draft/,
    );
    await expect(
      resolveCase(draft, { at: AT_LATER, actor: ACTOR_SERVICE, resolution: 'x' }),
    ).rejects.toThrow(/cannot transition from draft/);
  });

  it('a submitted case cannot be activated without triage', async () => {
    const submitted = await submittedCase();
    await expect(
      activateCase(submitted, { at: AT_LATER, actor: ACTOR_SERVICE }),
    ).rejects.toThrow(/cannot transition from submitted/);
  });

  it('a triaged case cannot skip to resolution', async () => {
    const triaged = await triagedCase();
    await expect(
      resolveCase(triaged, { at: AT_EVEN_LATER, actor: ACTOR_SERVICE, resolution: 'x' }),
    ).rejects.toThrow(/cannot transition from triaged/);
  });

  it('an active case cannot be re-submitted', async () => {
    const active = await activeCase();
    await expect(submitCase(active, { at: AT_EVEN_LATER, actor: ACTOR })).rejects.toThrow(
      /cannot transition from active/,
    );
  });

  it('triage without a rationale note is rejected (inspectable rationale)', async () => {
    const submitted = await submittedCase();
    await expect(
      triageCase(submitted, {
        at: AT_LATER,
        actor: ACTOR_SERVICE,
        note: '',
      }),
    ).rejects.toThrow(/non-empty rationale note/);
  });

  it('resolution without a statement is rejected', async () => {
    const active = await activeCase();
    await expect(
      resolveCase(active, { at: AT_EVEN_LATER, actor: ACTOR_SERVICE, resolution: '' }),
    ).rejects.toThrow(/non-empty outcome statement/);
  });

  it('malformed transition timestamps are rejected', async () => {
    const draft = await draftCase();
    await expect(
      submitCase(draft, { at: '2026-09-28T10:00:00Z', actor: ACTOR }),
    ).rejects.toThrow(CapabilityCaseError);
  });

  it('invalid actors are rejected', async () => {
    const draft = await draftCase();
    await expect(
      submitCase(draft, {
        at: AT_LATER,
        actor: { type: 'model', tenant: 'tenant-a', principalId: 'x' },
      }),
    ).rejects.toThrow(/unknown principal type/);
  });
});

describe('terminal finality (gate 3 — terminal mutation throws)', () => {
  it('every lifecycle operation on a RESOLVED case throws TERMINAL_STATE', async () => {
    const resolved = await resolveCase(await activeCase(), {
      at: AT_EVEN_LATER,
      actor: ACTOR_SERVICE,
      resolution: 'Done.',
    });
    const terminalError = /terminal states are final/;
    await expect(submitCase(resolved, { at: AT_EVEN_LATER, actor: ACTOR })).rejects.toThrow(
      terminalError,
    );
    await expect(
      triageCase(resolved, { at: AT_EVEN_LATER, actor: ACTOR_SERVICE, note: 'x' }),
    ).rejects.toThrow(terminalError);
    await expect(
      activateCase(resolved, { at: AT_EVEN_LATER, actor: ACTOR_SERVICE }),
    ).rejects.toThrow(terminalError);
    await expect(
      resolveCase(resolved, { at: AT_EVEN_LATER, actor: ACTOR_SERVICE, resolution: 'x' }),
    ).rejects.toThrow(terminalError);
    await expect(
      supersedeCase(resolved, {
        at: AT_EVEN_LATER,
        actor: ACTOR_SERVICE,
        superseding: {
          tenant: 'tenant-a',
          caseId: 'case-review-invoices',
          version: '2.0.0',
          digest: DIGEST_A,
        },
      }),
    ).rejects.toThrow(terminalError);
    await expect(
      attachEvidence(resolved, {
        at: AT_EVEN_LATER,
        actor: ACTOR_SERVICE,
        evidence: [{ digest: DIGEST_B, description: 'late evidence' }],
      }),
    ).rejects.toThrow(terminalError);
    // the error is structured with the terminal details
    await expect(submitCase(resolved, { at: AT_EVEN_LATER, actor: ACTOR })).rejects.toThrow(
      CapabilityCaseError,
    );
  });

  it('every lifecycle operation on a SUPERSEDED case throws TERMINAL_STATE', async () => {
    const draft = await draftCase();
    const superseded = await supersedeCase(draft, {
      at: AT_LATER,
      actor: ACTOR,
      superseding: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '2.0.0',
        digest: DIGEST_A,
      },
    });
    expect(superseded.status).toBe('superseded');
    await expect(
      submitCase(superseded, { at: AT_LATER, actor: ACTOR }),
    ).rejects.toThrow(/terminal states are final/);
    await expect(
      attachEvidence(superseded, {
        at: AT_LATER,
        actor: ACTOR,
        evidence: [{ digest: DIGEST_B, description: 'x' }],
      }),
    ).rejects.toThrow(/terminal states are final/);
  });
});

describe('supersession transition (gate 4)', () => {
  it('records the superseding ref on the terminal state and the event', async () => {
    const draft = await draftCase();
    const superseded = await supersedeCase(draft, {
      at: AT_LATER,
      actor: ACTOR,
      superseding: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '2.0.0',
        digest: DIGEST_A,
      },
    });
    expect(superseded.status).toBe('superseded');
    expect(superseded.supersededBy?.version).toBe('2.0.0');
    expect(superseded.supersededBy?.digest).toBe(DIGEST_A);
    const lastEvent = superseded.lifecycle[superseded.lifecycle.length - 1];
    expect(lastEvent?.kind).toBe('case-superseded');
    expect(lastEvent?.supersededBy?.version).toBe('2.0.0');
    // The original state stays immutable and addressable
    expect(draft.status).toBe('draft');
    expect(draft.digest).not.toBe(superseded.digest);
  });

  it('a new case VERSION can supersede the old one (paired refs)', async () => {
    const v1 = await draftCase();
    const v1Superseded = await supersedeCase(v1, {
      at: AT_LATER,
      actor: ACTOR,
      superseding: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '2.0.0',
        digest: DIGEST_A,
      },
    });
    const v2 = await createCapabilityCase({
      ...validCaseInput(),
      version: '2.0.0',
      supersedes: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: v1.digest,
      },
    });
    expect(v2.supersedes?.digest).toBe(v1.digest);
    expect(v1Superseded.supersededBy?.digest).toBe(DIGEST_A);
  });

  it('cross-case supersession is rejected', async () => {
    const draft = await draftCase();
    await expect(
      supersedeCase(draft, {
        at: AT_LATER,
        actor: ACTOR,
        superseding: {
          tenant: 'tenant-b',
          caseId: 'other-case',
          version: '2.0.0',
          digest: DIGEST_A,
        },
      }),
    ).rejects.toThrow(/must stay within one logical case/);
  });

  it('same-version self-supersession is rejected', async () => {
    const draft = await draftCase();
    await expect(
      supersedeCase(draft, {
        at: AT_LATER,
        actor: ACTOR,
        superseding: {
          tenant: 'tenant-a',
          caseId: 'case-review-invoices',
          version: '1.0.0',
          digest: DIGEST_A,
        },
      }),
    ).rejects.toThrow(/same version/);
  });
});

describe('evidence discipline (gate 6, lock rule 6)', () => {
  it('attachEvidence APPENDS and emits an evidence-attached event', async () => {
    const draft = await draftCase();
    const withEvidence = await attachEvidence(draft, {
      at: AT_LATER,
      actor: ACTOR,
      evidence: [{ digest: DIGEST_A, description: 'second trajectory export' }],
    });
    expect(withEvidence.evidence.length).toBe(2);
    expect(withEvidence.evidence[1]?.digest).toBe(DIGEST_A);
    expect(withEvidence.evidence[0]).toBe(draft.evidence[0]); // prefix preserved verbatim
    const lastEvent = withEvidence.lifecycle[withEvidence.lifecycle.length - 1];
    expect(lastEvent?.kind).toBe('evidence-attached');
    expect(lastEvent?.evidenceAppended?.length).toBe(1);
    expect(withEvidence.status).toBe('draft'); // no status change
  });

  it('evidence can be attached in any non-terminal status', async () => {
    const active = await activeCase();
    const withEvidence = await attachEvidence(active, {
      at: AT_EVEN_LATER,
      actor: ACTOR_SERVICE,
      evidence: [{ digest: DIGEST_A, description: 'evaluation-time evidence' }],
    });
    expect(withEvidence.status).toBe('active');
    expect(withEvidence.evidence.length).toBe(2);
  });

  it('duplicate evidence digests are rejected', async () => {
    const draft = await draftCase();
    const existing = draft.evidence[0]?.digest;
    expect(existing).toBeDefined();
    await expect(
      attachEvidence(draft, {
        at: AT_LATER,
        actor: ACTOR,
        evidence: [{ digest: existing as string, description: 'same digest again' }],
      }),
    ).rejects.toThrow(/already attached/);
  });

  it('empty attach calls are rejected', async () => {
    const draft = await draftCase();
    await expect(
      attachEvidence(draft, { at: AT_LATER, actor: ACTOR, evidence: [] }),
    ).rejects.toThrow(/at least one evidence reference/);
  });

  it('malformed evidence refs are rejected', async () => {
    const draft = await draftCase();
    await expect(
      attachEvidence(draft, {
        at: AT_LATER,
        actor: ACTOR,
        evidence: [{ digest: 'nope', description: 'x' }],
      }),
    ).rejects.toThrow(/sha256 content digest/);
  });
});

describe('assertAppendOnly (the auditor tripwire, negative)', () => {
  it('accepts a legitimate next state', async () => {
    const draft = await draftCase();
    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    expect(assertAppendOnly(draft, submitted)).toBeUndefined();
  });

  it('rejects evidence removal (EVIDENCE_REMOVAL)', async () => {
    const draft = await draftCase();
    const withEvidence = await attachEvidence(draft, {
      at: AT_LATER,
      actor: ACTOR,
      evidence: [{ digest: DIGEST_A, description: 'second' }],
    });
    // A forged "next state" with the evidence list truncated.
    const forged = {
      ...draft,
      lifecycle: withEvidence.lifecycle,
    };
    expect(() => assertAppendOnly(withEvidence, forged as never)).toThrow(
      /evidence removal detected/,
    );
  });

  it('rejects evidence rewrites (EVIDENCE_REMOVAL)', async () => {
    const draft = await draftCase();
    const withEvidence = await attachEvidence(draft, {
      at: AT_LATER,
      actor: ACTOR,
      evidence: [{ digest: DIGEST_A, description: 'second' }],
    });
    const rewritten = {
      ...withEvidence,
      evidence: [
        { digest: withEvidence.evidence[0]?.digest, description: 'rewritten' },
        { digest: DIGEST_A, description: 'second' },
      ],
    };
    expect(() => assertAppendOnly(withEvidence, rewritten as never)).toThrow(
      /evidence rewrite detected/,
    );
  });

  it('rejects history rewrites (INVALID_LIFECYCLE)', async () => {
    const draft = await draftCase();
    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    const forgedEvent = { ...submitted.lifecycle[1]!, note: 'forged' };
    const forged = {
      ...submitted,
      lifecycle: [submitted.lifecycle[0], forgedEvent],
    };
    expect(() => assertAppendOnly(submitted, forged as never)).toThrow(
      /history rewrite detected/,
    );
  });

  it('rejects history shrinks and cross-version misuse', async () => {
    const draft = await draftCase();
    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    expect(() => assertAppendOnly(submitted, draft as never)).toThrow(
      /history shrink detected/,
    );
    const otherVersion = { ...submitted, version: '2.0.0' };
    expect(() => assertAppendOnly(submitted, otherVersion as never)).toThrow(
      /one case version/,
    );
  });
});

describe('event vocabulary', () => {
  it('enumerates the closed event kind set', () => {
    expect(CASE_LIFECYCLE_EVENT_KINDS).toEqual([
      'case-created',
      'case-submitted',
      'case-triaged',
      'case-activated',
      'case-resolved',
      'case-superseded',
      'evidence-attached',
    ]);
  });

  it('isCaseLifecycleEvent guards reject malformed events', async () => {
    const draft = await draftCase();
    const event = draft.lifecycle[0];
    expect(event).toBeDefined();
    expect(isCaseLifecycleEvent(event)).toBe(true);
    expect(isCaseLifecycleEvent(null)).toBe(false);
    expect(isCaseLifecycleEvent({ sequence: 1 })).toBe(false);
  });
});
