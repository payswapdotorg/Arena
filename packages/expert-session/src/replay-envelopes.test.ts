/**
 * Replay + envelope suites (Work Order C006; EES1.0 "Replay"; house
 * envelope conventions).
 *
 * Adversarial minimum covered here:
 *   - REPLAY-MASQUERADING-AS-LIVE-MUTATION: replay traces carry the
 *     observational marker and liveMutation:false; any attempt to
 *     convert a trace into a live mutation is the typed REPLAY_AS_LIVE
 *     failure (architecture-lock rule 28 — the replica is never a
 *     live-world write path).
 */

import { describe, expect, it } from 'vitest';
import { newCorrelationId, serializeEnvelope, toIdempotencyKey } from '@arena/protocol-core';
import { buildReplayTrace, asLiveMutation, isReplayTrace, REPLAY_KIND } from './replay.js';
import { createExpertSessionEvent } from './events.js';
import {
  makeOpenExpertSessionCommand,
  parseOpenExpertSessionCommand,
  makeGetExpertSessionQuery,
  parseGetExpertSessionQuery,
  makeExpertSessionResponse,
  parseExpertSessionResponse,
  makeSubmitExpertSessionCommand,
  parseSubmitExpertSessionCommand,
} from './envelopes.js';
import { createExpertSessionSubmission } from './submission.js';
import { ExpertSessionError, EXPERT_SESSION_ERROR_CODES } from './errors.js';
import { T0, T1, T2, T3, makeOpenCommandPayload } from './test-support.js';

const SESSION_ID = 'session-replay-test-1';
const CAPSULE_DIGEST = 'a'.repeat(64);

function replayEvents() {
  return [
    createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 1, kind: 'environment-observation', payload: { step: 'awaiting-vendor-match' }, now: T0 }),
    createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 2, kind: 'human-action', payload: { action: 'queried registry' }, now: T1, actor: 'expert-alice' }),
    createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 3, kind: 'tool-result', payload: { vendorId: 'vendor-7' }, now: T2 }),
    createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 4, kind: 'annotation', payload: { note: 'registry is authoritative' }, now: T3 }),
    createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 5, kind: 'final-result', payload: { matched: 'vendor-7' }, now: T3 }),
    createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 6, kind: 'human-action', payload: { action: 'wrote summary' }, now: T3, actor: 'expert-alice' }),
    createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 7, kind: 'artifact-change', payload: { artifact: 'reconciliation.md', change: 'final' }, now: T3 }),
  ];
}

describe('replay traces', () => {
  it('shows state → human action → observable consequence → evidence', () => {
    const trace = buildReplayTrace(SESSION_ID, CAPSULE_DIGEST, replayEvents(), T3);
    expect(trace.frames).toHaveLength(2);
    expect(trace.frames[0]).toMatchObject({
      step: 1,
      state: { step: 'awaiting-vendor-match' },
      action: { action: 'queried registry' },
      consequence: { vendorId: 'vendor-7' },
    });
    expect(trace.frames[0]?.evidence).toEqual([
      { note: 'registry is authoritative' },
      { matched: 'vendor-7' },
    ]);
    expect(trace.frames[1]?.action).toMatchObject({ action: 'wrote summary' });
    expect(trace.frames[1]?.consequence).toEqual({ artifact: 'reconciliation.md', change: 'final' });
    expect(trace.frames[1]?.evidence).toEqual([]);
  });

  it('clearly indicates a bounded expert session, not a live-world mutation', () => {
    const trace = buildReplayTrace(SESSION_ID, CAPSULE_DIGEST, replayEvents(), T3);
    expect(trace.kind).toBe(REPLAY_KIND);
    expect(trace.liveMutation).toBe(false);
    expect(isReplayTrace(trace)).toBe(true);
    expect(Object.isFrozen(trace)).toBe(true);
  });

  it('ADVERSARIAL: replay masquerading as a live mutation fails closed (REPLAY_AS_LIVE)', () => {
    const trace = buildReplayTrace(SESSION_ID, CAPSULE_DIGEST, replayEvents(), T3);
    expect(() => asLiveMutation(trace)).toThrowError(ExpertSessionError);
    try {
      asLiveMutation(trace);
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.REPLAY_AS_LIVE);
    }
  });

  it('requires the capsule digest and session id (provenance)', () => {
    expect(() => buildReplayTrace(SESSION_ID, 'not-a-digest', [], T3)).toThrowError(ExpertSessionError);
    expect(() => buildReplayTrace('', CAPSULE_DIGEST, [], T3)).toThrowError(ExpertSessionError);
  });
});

describe('envelope wiring (house conventions)', () => {
  it('open-expert-session-command: required idempotency key, strict parse round-trip', () => {
    const envelope = makeOpenExpertSessionCommand(
      makeOpenCommandPayload(),
      newCorrelationId(),
      toIdempotencyKey('open-1'),
    );
    const parsed = parseOpenExpertSessionCommand(serializeEnvelope(envelope));
    expect(parsed.payload.sessionMode).toBe('teach');
    expect(parsed.idempotencyKey).toBe('open-1');
  });

  it('open command rejects query/response kinds and wrong namespaces (fail-closed)', () => {
    const wrongKind = serializeEnvelope({
      ...makeOpenExpertSessionCommand(makeOpenCommandPayload(), newCorrelationId(), toIdempotencyKey('open-2')),
      kind: 'query' as never,
      idempotencyKey: null as never,
    });
    expect(() => parseOpenExpertSessionCommand(wrongKind)).toThrow();
  });

  it('get-expert-session-query: NULL idempotency key (reads are not commands)', () => {
    const envelope = makeGetExpertSessionQuery(
      { queryVersion: 1, sessionId: SESSION_ID, tenantId: 'tenant-alpha' },
      newCorrelationId(),
    );
    const parsed = parseGetExpertSessionQuery(serializeEnvelope(envelope));
    expect(parsed.idempotencyKey).toBeNull();
    expect(parsed.payload.sessionId).toBe(SESSION_ID);
  });

  it('expert-session-response round-trips with the closed result vocabulary', () => {
    const envelope = makeExpertSessionResponse(
      {
        responseVersion: 1,
        kind: 'session-opened',
        sessionId: SESSION_ID,
        tenantId: 'tenant-alpha',
        state: 'open',
        capsuleDigest: CAPSULE_DIGEST,
        eventCount: 0,
      },
      newCorrelationId(),
    );
    const parsed = parseExpertSessionResponse(serializeEnvelope(envelope));
    expect(parsed.payload.kind).toBe('session-opened');
  });

  it('submit-expert-session-command: idempotency key + validated submission payload', () => {
    const submission = createExpertSessionSubmission({
      sessionId: SESSION_ID,
      result: { matched: 'vendor-7' },
      evidence: [{ kind: 'event-ref', ref: 'esevt_00000000000000000000000000000099' }],
      consentRightsStatement: { granted: true, statement: 'Reusable under Arena terms.' },
      now: T3,
    });
    const envelope = makeSubmitExpertSessionCommand(submission, newCorrelationId(), toIdempotencyKey('submit-1'));
    const parsed = parseSubmitExpertSessionCommand(serializeEnvelope(envelope));
    expect(parsed.payload.submissionVersion).toBe(1);
    expect(parsed.idempotencyKey).toBe('submit-1');
  });
});
