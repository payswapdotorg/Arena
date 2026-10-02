/**
 * Verification view-model tests (Work Order B012; issue #87).
 *
 * Positive: verifier identity + scope + derived verdict + append-only
 * evidence addresses, as the OWN truth class of a verification outcome.
 * Adversarial: unknown-outcome records render as UNKNOWN (fail honest);
 * malformed payloads degrade truthfully.
 */

import { describe, expect, it } from 'vitest';

import { createVerificationRecord } from '../../../../packages/verification/src/index.js';
import { toVerificationDetailView } from './verification-view-model.js';
import { buildEvaluationDemoCorpus, EVALUATION_DEMO_IDS } from './fixtures.js';

describe('verification detail view projection (positive)', () => {
  it('projects the verifier identity, scope, verdict and append-only evidence addresses', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = toVerificationDetailView({
      record: corpus.verificationRecord,
      descriptor: corpus.verifier,
      verificationId: EVALUATION_DEMO_IDS.verification,
    });

    expect(view.viewVersion).toBe(1);
    expect(view.readable).toBe(true);
    expect(view.verificationId).toBe(EVALUATION_DEMO_IDS.verification);
    expect(view.digest).toBe(corpus.verificationRecord.digest);
    expect(view.unknownFields).toEqual([]);

    // The OWN truth class of a DECIDED verification outcome: a verified
    // fact — checked by the NAMED verifier, WITH its scope.
    expect(view.truthClass).toBe('verified-fact');
    expect(view.outcome).toBe('pass');
    expect(view.unknownCause).toBeUndefined();

    // Verifier identity.
    expect(view.verifier.verifierId).toBe('verifier-payments-reliability');
    expect(view.verifier.version).toBe('1.0.0');
    expect(view.verifier.method).toBe('constraint_check');
    expect(view.verifier.reproducibility).toBe('deterministic');
    expect(view.verifier.verifierRef).toBe(corpus.verifier.digest);
    expect(view.verifier.semantics?.pass).toContain('present and supports');

    // Scope: one row per declared requirement, in descriptor order.
    expect(view.requirements).toHaveLength(2);
    expect(view.requirements[0]?.requirementId).toBe('req-regression-rerun');
    expect(view.requirements[0]?.evidenceKind).toBe('regression-test-suite');
    expect(view.requirements[0]?.claim).toContain('clean environment');
    expect(view.requirements[0]?.status).toBe('present-supported');
    expect(view.requirements[1]?.requirementId).toBe('req-second-review');

    // Evidence addresses: append-only bundle order, content-addressed keys.
    expect(view.evidence).toHaveLength(2);
    expect(view.evidence[0]?.key).toBe(
      `regression-test-suite:arena-demo/regression-test-suite@1.0.0#${corpus.verificationRecord.evidence[0]?.artifact.digest}`,
    );
    expect(view.evidence[0]?.producedBy).toBe('arena-demo-verifier');
    expect(view.evidence[1]?.evidenceKind).toBe('review-report');
    expect(view.evidence[1]?.producedBy).toBe('arena-demo-reviewer');

    // Run identity + the not-an-evaluation framing.
    expect(view.correlationId).toBe('demo-corr-payments-reliability');
    expect(view.inputDigest).toBe(corpus.verificationRecord.inputDigest);
    expect(view.notEvaluationNote).toContain('NEVER carries a score');
  });

  it('is deterministic: two projections are identical', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const one = toVerificationDetailView({ record: corpus.verificationRecord, descriptor: corpus.verifier });
    const two = toVerificationDetailView({ record: corpus.verificationRecord, descriptor: corpus.verifier });
    expect(one).toEqual(two);
  });
});

describe('verification detail view projection (adversarial — fail honest)', () => {
  it('renders an UNKNOWN-outcome record as unknown with its structured cause', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const unknownRecord = await createVerificationRecord(
      {
        verifierRef: corpus.verifier.digest,
        evidence: [
          {
            evidenceKind: 'regression-test-suite',
            artifact: {
              namespace: 'arena-demo',
              name: 'regression-test-suite',
              version: '1.0.0',
              digest: corpus.verificationRecord.evidence[0]?.artifact.digest as string,
            },
            provenance: { producedBy: 'arena-demo-verifier', producedAt: '2026-10-01T08:05:00.000Z', notes: null },
          },
        ],
        evidenceSupport: [
          { requirementId: 'req-regression-rerun', status: 'missing', evidenceDigest: null, notes: null },
          { requirementId: 'req-second-review', status: 'missing', evidenceDigest: null, notes: null },
        ],
        correlationId: 'demo-corr-verification-unknown',
        idempotencyKey: 'demo-idem-verification-unknown',
        startedAt: '2026-10-01T08:05:00.000Z',
        finishedAt: '2026-10-01T08:10:00.000Z',
        provenance: { executedBy: 'arena-demo-verifier', recordedAt: '2026-10-01T08:10:00.000Z', notes: null },
      },
      corpus.verifier,
    );

    const view = toVerificationDetailView({ record: unknownRecord, descriptor: corpus.verifier });
    expect(view.outcome).toBe('unknown');
    // FAIL HONEST: an undecided verification is NEVER a verified fact.
    expect(view.truthClass).toBe('unknown');
    expect(view.unknownCause?.reason).toBe('missing-evidence');
    expect(view.unknownCause?.detail).toBeTruthy();
  });

  it('degrades a malformed record without throwing, keeping the descriptor-declared scope', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    for (const malformed of [null, 7, 'record', {}]) {
      const view = toVerificationDetailView({ record: malformed, descriptor: corpus.verifier });
      expect(view.readable).toBe(false);
      expect(view.digest).toBeNull();
      expect(view.outcome).toBeUndefined();
      expect(view.truthClass).toBe('unknown');
      expect(view.unknownFields).toContain('verification record (structurally unreadable)');
      // The declared scope still renders (from the descriptor), with support statuses unknown.
      expect(view.requirements).toHaveLength(2);
      expect(view.requirements[0]?.status).toBeUndefined();
      expect(view.unknownFields).toContain('support status req-regression-rerun');
      expect(view.evidence).toEqual([]);
    }
  });

  it('degrades the verifier identity when only the record is readable', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = toVerificationDetailView({ record: corpus.verificationRecord });
    expect(view.readable).toBe(true);
    expect(view.outcome).toBe('pass');
    expect(view.truthClass).toBe('verified-fact');
    expect(view.verifier.verifierId).toBeUndefined();
    expect(view.verifier.verifierRef).toBe(corpus.verificationRecord.verifierRef);
    expect(view.unknownFields).toContain('verifier descriptor');
    // Requirements fall back to the record's support rows (ids + statuses, claims unknown).
    expect(view.requirements).toHaveLength(2);
    expect(view.requirements[0]?.status).toBe('present-supported');
    expect(view.requirements[0]?.claim).toBeUndefined();
  });
});
