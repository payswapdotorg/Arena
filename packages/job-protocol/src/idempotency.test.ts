/**
 * Idempotency + correlation addressability — positive AND negative tests
 * (gates 4, 12): submission identity, composite keys, idempotent hits and
 * conflicting re-submissions (lock rule 17).
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  assertIdempotentResubmission,
  isJobSubmissionIdentity,
  isSameJobSubmission,
  jobSubmissionIdentityOf,
  jobSubmissionKey,
  resolveIdempotentSubmission,
  toJobSubmissionIdentity,
} from './idempotency.js';
import { createJobRecord } from './record.js';
import { JOB_ERROR_CODES } from './errors.js';

const DIGEST_A = 'aa'.repeat(32);
const CORR = toCorrelationId('corr-42');
const IDEM = toIdempotencyKey('idem-42');
const DIGEST_B = 'bb'.repeat(32);

function record(definitionDigest: string) {
  return createJobRecord({
    definitionDigest,
    kind: { namespace: 'billing', name: 'reconcile', version: '1.0.0' },
    correlationId: CORR,
    idempotencyKey: IDEM,
    idempotencyScope: 'billing-reconcile',
    input: { ledger: 'q3' },
    policy: {
      timeoutMs: 30_000,
      retry: { maxAttempts: 1, backoffScheduleMs: [], retryableErrorClasses: [] },
    },
    jobId: 'job-0001',
    submittedAt: '2026-01-15T09:30:00.000Z',
  });
}

describe('idempotency — submission identity (positive)', () => {
  it('validates and freezes a submission identity', () => {
    const identity = toJobSubmissionIdentity({
      idempotencyScope: 'billing-reconcile',
      idempotencyKey: 'idem-42',
      correlationId: 'corr-42',
    });
    expect(identity.idempotencyScope).toBe('billing-reconcile');
    expect(Object.isFrozen(identity)).toBe(true);
    expect(isJobSubmissionIdentity(identity)).toBe(true);
    expect(jobSubmissionKey(identity)).toBe('billing-reconcile:idem-42:corr-42');
    expect(isSameJobSubmission(identity, identity)).toBe(true);
  });

  it('the composite key is unambiguous (no \u201c:\u201d in the identifier charset)', () => {
    // ':' is not in the identifier charset, so it can never appear inside a
    // component — the composite `scope:key:correlation` is injective.
    expect(() =>
      toJobSubmissionIdentity({
        idempotencyScope: 's',
        idempotencyKey: 'a:b',
        correlationId: 'c',
      }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_IDENTITY }));
  });

  it('a job record exposes its submission identity', () => {
    const identity = jobSubmissionIdentityOf(record(DIGEST_A));
    expect(jobSubmissionKey(identity)).toBe('billing-reconcile:idem-42:corr-42');
    expect(isJobSubmissionIdentity(identity)).toBe(true);
  });

  it('same (idempotency key, correlation id) + same definition digest ⇒ IDEMPOTENT HIT', () => {
    const existing = record(DIGEST_A);
    const resolution = resolveIdempotentSubmission(existing, DIGEST_A);
    expect(resolution.outcome).toBe('idempotent-hit');
    if (resolution.outcome === 'idempotent-hit') {
      expect(resolution.record).toBe(existing); // the SAME record object
    }
    expect(() => assertIdempotentResubmission(existing, DIGEST_A)).not.toThrow();
  });

  it('no existing record ⇒ fresh submission', () => {
    const resolution = resolveIdempotentSubmission(undefined, DIGEST_A);
    expect(resolution.outcome).toBe('fresh-submission');
  });

  it('different scopes / keys / correlations are DIFFERENT submissions', () => {
    const a = toJobSubmissionIdentity({
      idempotencyScope: 'scope-a',
      idempotencyKey: 'idem-42',
      correlationId: 'corr-42',
    });
    const differentScope = toJobSubmissionIdentity({
      idempotencyScope: 'scope-b',
      idempotencyKey: 'idem-42',
      correlationId: 'corr-42',
    });
    const differentKey = toJobSubmissionIdentity({
      idempotencyScope: 'scope-a',
      idempotencyKey: 'idem-43',
      correlationId: 'corr-42',
    });
    const differentCorrelation = toJobSubmissionIdentity({
      idempotencyScope: 'scope-a',
      idempotencyKey: 'idem-42',
      correlationId: 'corr-43',
    });
    expect(isSameJobSubmission(a, differentScope)).toBe(false);
    expect(isSameJobSubmission(a, differentKey)).toBe(false);
    expect(isSameJobSubmission(a, differentCorrelation)).toBe(false);
  });
});

describe('idempotency — submission identity (negative)', () => {
  it('rejects malformed identities', () => {
    expect(() =>
      toJobSubmissionIdentity({ idempotencyScope: 'NOPE', idempotencyKey: 'k', correlationId: 'c' }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_IDENTITY }));
    expect(() =>
      toJobSubmissionIdentity({ idempotencyScope: 's', idempotencyKey: 'bad key', correlationId: 'c' }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_IDENTITY }));
    expect(() =>
      toJobSubmissionIdentity({ idempotencyScope: 's', idempotencyKey: 'k', correlationId: '' }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_IDENTITY }));
    expect(isJobSubmissionIdentity({ idempotencyScope: 's' })).toBe(false);
    expect(isJobSubmissionIdentity(null)).toBe(false);
  });

  it('idempotency key reuse with a DIFFERENT definition digest is a CONFLICT', () => {
    const existing = record(DIGEST_A);
    expect(() => resolveIdempotentSubmission(existing, DIGEST_B)).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.IDENTITY_CONFLICT }),
    );
    expect(() => assertIdempotentResubmission(existing, DIGEST_B)).toThrow(
      expect.objectContaining({
        code: JOB_ERROR_CODES.IDENTITY_CONFLICT,
        details: {
          idempotencyKey: 'idem-42',
          idempotencyScope: 'billing-reconcile',
          correlationId: 'corr-42',
          bound: DIGEST_A,
          attempted: DIGEST_B,
        },
      }),
    );
  });

  it('a hypothetical foreign digest would still conflict', () => {
    const existing = record(DIGEST_A);
    expect(() => resolveIdempotentSubmission(existing, 'cc'.repeat(32))).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.IDENTITY_CONFLICT }),
    );
  });
});
