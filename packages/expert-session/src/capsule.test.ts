/**
 * Capsule derivation + session lifecycle suites (Work Order C006;
 * EES1.0 "Environment Capsule").
 *
 * Asserts the five EES1.0 capsule properties:
 *   isolated (barrier applied at derivation); scoped to ONE escalation;
 *   time-bounded; privacy-policy controlled; non-authoritative.
 * Plus determinism of the content-addressed digest, deep-freeze, and
 * the session record lifecycle (open → active → completed; expiry;
 * append-only events; monotonic sequences).
 */

import { describe, expect, it } from 'vitest';
import {
  deriveExpertSessionCapsule,
  isCapsuleWithinTimeBound,
  isExpertSessionCapsule,
  CAPSULE_AUTHORITY,
} from './capsule.js';
import {
  applyExpertSessionTransition,
  appendSessionEvent,
  createExpertSessionRecord,
  isExpertSessionRecord,
} from './lifecycle.js';
import { createExpertSessionSubmission } from './submission.js';
import { ExpertSessionError, EXPERT_SESSION_ERROR_CODES } from './errors.js';
import {
  ENV_DIGEST_A,
  ENV_DIGEST_B,
  EXPIRY,
  PAST,
  REQUEST_ID_A,
  T0,
  T1,
  T2,
  T3,
  TENANT_A,
  TENANT_B,
  makeBarrierInput,
  makeCapsuleSourceInput,
  makeDeriveCapsuleInput,
} from './test-support.js';

describe('ExpertSessionCapsule derivation', () => {
  it('derives a bounded, frozen, content-addressed capsule', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    expect(capsule.capsuleVersion).toBe(1);
    expect(capsule.sessionId).toBe('session-test-capsule-1');
    expect(capsule.escalationRef).toEqual({ requestId: REQUEST_ID_A, tenantId: TENANT_A });
    expect(capsule.authority).toBe(CAPSULE_AUTHORITY);
    expect(capsule.createdAt).toBe(T0);
    expect(capsule.expiresAt).toBe(EXPIRY);
    expect(capsule.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isExpertSessionCapsule(capsule)).toBe(true);
    expect(Object.isFrozen(capsule)).toBe(true);
  });

  it('ISOLATED: the barrier is applied AT derivation (world state screened, redacted docs dropped, excluded tools removed)', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    expect(capsule.worldState).toMatchObject({
      customerEmail: '[REDACTED]',
      accountNumber: '[REDACTED]',
      customerName: 'masked-identity',
      step: 'awaiting-vendor-match',
    });
    expect(capsule.resources.map((r) => r.ref)).toEqual(['logs/agent-trace.jsonl', 'docs/vendor-catalog.md']);
    expect(capsule.tools).toEqual(['search-vendors', 'compute-reconciliation']);
    expect(capsule.derivedFrom.redactedDocumentCount).toBe(1);
    expect(capsule.derivedFrom.excludedToolCount).toBe(1);
  });

  it('SCOPED TO ONE ESCALATION + derived-from provenance', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    expect(capsule.derivedFrom.taskRef).toBe('task/invoice-reconciliation-42');
    expect(capsule.derivedFrom.environmentDigest).toBe(ENV_DIGEST_A);
    expect([...capsule.derivedFrom.relevantHistory]).toEqual(['trajectory/run-42', 'artifact/eval-9']);
  });

  it('TIME-BOUNDED: expiry must be after creation; time-bound predicate flips after expiry', async () => {
    await expect(
      deriveExpertSessionCapsule(makeDeriveCapsuleInput({ expiresAt: T0 })),
    ).rejects.toThrowError(ExpertSessionError);
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    expect(isCapsuleWithinTimeBound(capsule, T1)).toBe(true);
    expect(isCapsuleWithinTimeBound(capsule, PAST)).toBe(false);
  });

  it('fail-closed: mode outside the allowed set, tenant mismatch, bad refs', async () => {
    await expect(
      deriveExpertSessionCapsule(makeDeriveCapsuleInput({ sessionMode: 'takeover' })),
    ).rejects.toThrowError(ExpertSessionError);
    await expect(
      deriveExpertSessionCapsule(
        makeDeriveCapsuleInput({ barrier: makeBarrierInput({ tenantId: TENANT_B }) }),
      ),
    ).rejects.toThrowError(ExpertSessionError);
    await expect(
      deriveExpertSessionCapsule(
        makeDeriveCapsuleInput({ escalationRef: { requestId: 'nope', tenantId: TENANT_A } }),
      ),
    ).rejects.toThrowError(ExpertSessionError);
    await expect(
      deriveExpertSessionCapsule(
        makeDeriveCapsuleInput({ source: { ...makeCapsuleSourceInput(), environmentDigest: ENV_DIGEST_B } }),
      ),
    ).resolves.toBeTruthy();
  });

  it('DETERMINISM: same derivation input ⇒ same digest; any content change ⇒ new digest', async () => {
    const first = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    const second = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    expect(second.digest).toBe(first.digest);
    const changed = await deriveExpertSessionCapsule(
      makeDeriveCapsuleInput({ sessionMode: 'observe', allowedModes: ['observe'] }),
    );
    expect(changed.digest).not.toBe(first.digest);
  });
});

describe('expert session record lifecycle', () => {
  it('open → active → completed with append-only history and events', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    let record = createExpertSessionRecord(capsule, T0);
    expect(record.state).toBe('open');
    expect(isExpertSessionRecord(record)).toBe(true);

    record = applyExpertSessionTransition(record, 'active', { now: T1, actor: 'expert-alice' });
    expect(record.state).toBe('active');

    record = appendSessionEvent(record, {
      kind: 'human-action',
      payload: { action: 'reviewed-open-items' },
      now: T2,
      actor: 'expert-alice',
    });
    record = appendSessionEvent(record, {
      kind: 'artifact-change',
      payload: { artifact: 'reconciliation.md', change: 'proposed-patch' },
      now: T3,
    });
    expect(record.events.map((event) => event.sequence)).toEqual([1, 2]);

    const submission = createExpertSessionSubmission({
      sessionId: record.capsule.sessionId,
      result: { matched: 'vendor-7' },
      evidence: [{ kind: 'event-ref', ref: 'esevt_00000000000000000000000000000000' }],
      consentRightsStatement: { granted: true, statement: 'Reusable under Arena terms.' },
      now: T3,
    });
    record = applyExpertSessionTransition(record, 'completed', { now: T3, submission });
    expect(record.state).toBe('completed');
    expect(record.submission).toBeDefined();
    expect(record.history.map((entry) => entry.to)).toEqual(['open', 'active', 'completed']);
  });

  it('terminal states are final; events append only while active', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    const completed = applyExpertSessionTransition(
      applyExpertSessionTransition(createExpertSessionRecord(capsule, T0), 'active', { now: T1 }),
      'completed',
      {
        now: T2,
        submission: createExpertSessionSubmission({
          sessionId: capsule.sessionId,
          result: { ok: true },
          evidence: [{ kind: 'event-ref', ref: 'esevt_00000000000000000000000000000000' }],
          consentRightsStatement: { granted: false, statement: 'No reuse.' },
          now: T2,
        }),
      },
    );
    expect(() => applyExpertSessionTransition(completed, 'open', { now: T3 })).toThrowError(ExpertSessionError);
    try {
      applyExpertSessionTransition(completed, 'open', { now: T3 });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.TERMINAL_STATE);
    }
    expect(() =>
      appendSessionEvent(createExpertSessionRecord(capsule, T0), {
        kind: 'human-action',
        payload: {},
        now: T1,
      }),
    ).toThrowError(ExpertSessionError);
  });

  it('expiry requires the capsule time bound to be exceeded; illegal transitions denied', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    const open = createExpertSessionRecord(capsule, T0);
    expect(() => applyExpertSessionTransition(open, 'expired', { now: T1 })).toThrowError(ExpertSessionError);
    expect(applyExpertSessionTransition(open, 'expired', { now: PAST }).state).toBe('expired');
    expect(() => applyExpertSessionTransition(open, 'completed', { now: T1 })).toThrowError(ExpertSessionError);
    expect(() => applyExpertSessionTransition(open, 'active', { now: T0 }).history).toBeTruthy();
  });

  it('entering completed REQUIRES the submission; event timestamps are monotonic', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    const active = applyExpertSessionTransition(createExpertSessionRecord(capsule, T0), 'active', { now: T1 });
    expect(() => applyExpertSessionTransition(active, 'completed', { now: T2 })).toThrowError(ExpertSessionError);
    const withEvent = appendSessionEvent(active, { kind: 'human-action', payload: {}, now: T2 });
    expect(() =>
      appendSessionEvent(withEvent, { kind: 'annotation', payload: {}, now: T1 }),
    ).toThrowError(ExpertSessionError);
  });
});
