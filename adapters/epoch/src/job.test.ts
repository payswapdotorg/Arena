import { describe, expect, it } from 'vitest';
import { newCorrelationId, newIdempotencyKey } from '@arena/protocol-core';
import {
  EPOCH_JOB_STATUSES,
  EPOCH_JOB_TERMINAL_STATUSES,
  epochJobSubmissionKey,
  hasCrossKindDigestCollision,
  isEpochJob,
  isTerminalEpochJobStatus,
  makeEpochJob,
  normalizeArtifactDigests,
  toCausationId,
  transitionEpochJob,
} from './job.js';
import { toCapabilityDevelopmentRequest } from './request.js';
import { toEpochOutputRef } from './refs.js';
import { EPOCH_ADAPTER_ERROR_CODES } from './errors.js';
import { buildEpochRequest, buildOutputRef, DIGESTS, FIXED_CLOCK } from './test-support.js';

function buildJobInput() {
  const request = toCapabilityDevelopmentRequest(buildEpochRequest());
  const caseRef = toEpochOutputRef(
    buildOutputRef('capability-case', DIGESTS.certification, 'arena:case/acme/epoch-req-001@1.0.0#x'),
  );
  return {
    jobId: globalThis.crypto.randomUUID(),
    idempotencyKey: newIdempotencyKey(),
    correlationId: newCorrelationId(),
    causationId: toCausationId('epoch-cause-001'),
    requestDigest: DIGESTS.evidence,
    authorization: request.authorization,
    targetReleaseChannel: request.targetReleaseChannel,
    caseRef,
    submittedAt: FIXED_CLOCK(),
  };
}

function buildJob() {
  return makeEpochJob(buildJobInput());
}

describe('epoch adapter — asynchronous job envelope (EPI1.0)', () => {
  it('carries job id, correlation id, causation id, idempotency key, digests, authorization and explicit status', () => {
    const job = buildJob();
    expect(job.jobVersion).toBe(1);
    expect(job.status).toBe('queued');
    expect(job.submission.idempotencyScope).toBe('epoch');
    expect(job.causationId).toBe('epoch-cause-001');
    expect(job.artifactDigests).toEqual([job.caseRef?.digest]);
    expect(job.failure).toBeNull();
    expect(Object.isFrozen(job)).toBe(true);
    expect(isEpochJob(job)).toBe(true);
  });

  it('uses the five-state lifecycle with three terminal states', () => {
    expect([...EPOCH_JOB_STATUSES]).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
    ]);
    expect([...EPOCH_JOB_TERMINAL_STATUSES]).toEqual(['succeeded', 'failed', 'cancelled']);
    expect(isTerminalEpochJobStatus('queued')).toBe(false);
    expect(isTerminalEpochJobStatus('succeeded')).toBe(true);
  });

  it('validates causation ids (EPI1.0-mandated identifier)', () => {
    expect(() => toCausationId('bad causation!')).toThrow(/causation id/);
    expect(toCausationId('cause-1')).toBe('cause-1');
  });

  it('rejects malformed job construction (job id / digest / channel / ref)', () => {
    const base = buildJobInput();
    expect(() =>
      makeEpochJob({ ...base, jobId: 'not-a-uuid' }),
    ).toThrow(/job id/);
    expect(() =>
      makeEpochJob({ ...base, requestDigest: 'zzz' }),
    ).toThrow(/requestDigest/);
    expect(() =>
      makeEpochJob({ ...base, targetReleaseChannel: 'canary' as never }),
    ).toThrow(/release channel/);
    expect(() =>
      makeEpochJob({ ...base, caseRef: null as never }),
    ).toThrow(/ref/);
  });

  it('advances queued → running → succeeded and never rewrites terminal jobs', () => {
    const job = buildJob();
    const running = transitionEpochJob(job, 'running', { updatedAt: FIXED_CLOCK() });
    expect(running.status).toBe('running');
    const succeeded = transitionEpochJob(running, 'succeeded', {
      updatedAt: FIXED_CLOCK(),
      outputs: running.outputs,
      artifactDigests: running.artifactDigests,
    });
    expect(succeeded.status).toBe('succeeded');
    expect(() =>
      transitionEpochJob(succeeded, 'running', { updatedAt: FIXED_CLOCK() }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.JOB_TERMINAL);
  });

  it('rejects illegal transitions (queued may not jump to succeeded)', () => {
    const job = buildJob();
    expect(() =>
      transitionEpochJob(job, 'succeeded', { updatedAt: FIXED_CLOCK() }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.INVALID_LIFECYCLE);
  });

  it('normalizeArtifactDigests dedupes and sorts deterministically', () => {
    expect(normalizeArtifactDigests([DIGESTS.certification, DIGESTS.bodyVersion, DIGESTS.certification])).toEqual(
      [DIGESTS.bodyVersion, DIGESTS.certification].sort(),
    );
  });

  it('detects cross-kind digest collisions (a digest never changes meaning)', () => {
    const a = toEpochOutputRef(buildOutputRef('certification', DIGESTS.certification, 'arena:a'));
    const b = toEpochOutputRef(buildOutputRef('compatibility-report', DIGESTS.certification, 'arena:b'));
    const c = toEpochOutputRef(buildOutputRef('certification', DIGESTS.certification, 'arena:a'));
    expect(hasCrossKindDigestCollision([a, b])).toBe(true);
    expect(hasCrossKindDigestCollision([a, c])).toBe(false);
  });

  it('exposes the A015 submission identity key', () => {
    const job = buildJob();
    expect(epochJobSubmissionKey(job)).toBe(
      `epoch:${job.submission.idempotencyKey}:${job.submission.correlationId}`,
    );
  });
});
