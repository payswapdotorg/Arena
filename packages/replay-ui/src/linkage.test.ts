/**
 * Result-linkage view-model tests (Work Order B011; packages/replay-ui).
 *
 * Positive: REAL evaluation / verification records (built through the
 * packages' public factories) project under their OWN truth classes —
 * evaluation-result for the score, verified-fact for a DECIDED
 * verification outcome, unknown for an undecided one; evidence
 * addresses render as append-only digests under the evidence class.
 * Negative: malformed records and malformed digests degrade truthfully
 * (unknown rows / counted omissions) — never a crash, never a guess.
 */

import { describe, expect, it } from 'vitest';
import {
  createEvaluationCriteria,
  createEvaluatorDescriptor,
  createEvaluationRecord,
} from '@arena/evaluation';
import {
  createVerifierDescriptor,
  createVerificationRecord,
} from '@arena/verification';
import {
  evaluationLinksTrajectory,
  toEvaluationLink,
  toEvidenceLinks,
  toReplayLinkage,
  toVerificationLink,
} from './linkage.js';

const T0 = '2026-10-01T08:00:00.000Z';
const T1 = '2026-10-01T08:05:00.000Z';
const T2 = '2026-10-01T08:10:00.000Z';
const DIGEST_CASE = 'ca5e'.repeat(16);
const DIGEST_TRAJECTORY = '7a2e'.repeat(16);
const DIGEST_BODY = 'b04d'.repeat(16);
const DIGEST_SUBSTRATE = '5cab'.repeat(16);
const DIGEST_REGRESSION = '9e67'.repeat(16);
const DIGEST_REVIEW = '2ec0'.repeat(16);

async function buildEvaluation() {
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-linkage-test',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'regression-coverage',
        weight: 1,
        description: 'Regression tests cover the changed path.',
        targetRef: DIGEST_CASE,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });
  const evaluator = await createEvaluatorDescriptor({
    evaluatorId: 'evaluator-linkage-test',
    version: '1.0.0',
    kind: 'deterministic-test',
    inputs: {
      caseRef: DIGEST_CASE,
      trajectoryRef: DIGEST_TRAJECTORY,
      bodyRef: DIGEST_BODY,
      substrateRef: DIGEST_SUBSTRATE,
    },
    criteriaRef: criteria.digest,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
    confidence: 0.9,
    limitations: 'Deterministic suite over one recorded trajectory.',
    provenance: { authoredBy: 'arena-demo', submittedAt: T0, notes: null },
  });
  const record = await createEvaluationRecord(
    {
      evaluatorRef: evaluator.digest,
      caseRef: DIGEST_CASE,
      trajectoryRef: DIGEST_TRAJECTORY,
      criteriaRef: criteria.digest,
      seed: 'seed-linkage-test',
      verdicts: [
        {
          criterionId: 'regression-coverage',
          score: 0.9,
          judgment: 'Tests cover the changed path.',
          notes: null,
        },
      ],
      confidence: 0.9,
      limitations: null,
      startedAt: T1,
      finishedAt: T2,
      provenance: { executedBy: 'arena-demo-evaluator', recordedAt: T2, notes: null },
    },
    criteria,
  );
  return record;
}

async function buildVerification(outcomeKind: 'decided' | 'unknown') {
  const verifier = await createVerifierDescriptor({
    verifierId: 'verifier-linkage-test',
    version: '1.0.0',
    method: 'constraint_check',
    requiredEvidence: [
      {
        requirementId: 'req-regression-rerun',
        evidenceKind: 'regression-test-suite',
        claim: 'Regression tests re-run in a clean environment.',
        artifact: {
          namespace: 'arena-demo',
          name: 'regression-test-suite',
          version: '1.0.0',
          digest: DIGEST_REGRESSION,
        },
        requiredProducer: null,
      },
      {
        requirementId: 'req-second-review',
        evidenceKind: 'review-report',
        claim: 'The change diff was inspected by a second reviewer.',
        artifact: {
          namespace: 'arena-demo',
          name: 'second-review-report',
          version: '1.0.0',
          digest: DIGEST_REVIEW,
        },
        requiredProducer: null,
      },
    ],
    outcomeSemantics: {
      pass: 'Every declared evidence requirement is present and supports its claim.',
      fail: 'At least one present evidence item fails to support its claim.',
      unknown: 'Evidence is missing, unverified or indeterminate, so no verdict is guessed.',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'verifier-descriptor', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verifier-descriptor', version: '1.0.0' },
    provenance: { authoredBy: 'arena-demo', submittedAt: T0, notes: null },
  });
  const evidence = [
    {
      evidenceKind: 'regression-test-suite',
      artifact: {
        namespace: 'arena-demo',
        name: 'regression-test-suite',
        version: '1.0.0',
        digest: DIGEST_REGRESSION,
      },
      provenance: { producedBy: 'arena-demo-verifier', producedAt: T1, notes: null },
    },
    {
      evidenceKind: 'review-report',
      artifact: {
        namespace: 'arena-demo',
        name: 'second-review-report',
        version: '1.0.0',
        digest: DIGEST_REVIEW,
      },
      provenance: { producedBy: 'arena-demo-reviewer', producedAt: T1, notes: null },
    },
  ];
  // Decided: everything present-supported → pass. Unknown: one
  // requirement's evidence is MISSING → the derived outcome is unknown.
  const support = outcomeKind === 'decided'
    ? [
        {
          requirementId: 'req-regression-rerun',
          status: 'present-supported',
          evidenceDigest: DIGEST_REGRESSION,
          notes: 'Suite re-run green in a clean environment.',
        },
        {
          requirementId: 'req-second-review',
          status: 'present-supported',
          evidenceDigest: DIGEST_REVIEW,
          notes: 'Second reviewer approved the diff.',
        },
      ]
    : [
        {
          requirementId: 'req-regression-rerun',
          status: 'missing',
          evidenceDigest: null,
          notes: 'Evidence was not supplied.',
        },
        {
          requirementId: 'req-second-review',
          status: 'present-supported',
          evidenceDigest: DIGEST_REVIEW,
          notes: 'Second reviewer approved the diff.',
        },
      ];
  return createVerificationRecord(
    {
      verifierRef: verifier.digest,
      evidence: outcomeKind === 'decided' ? evidence : [evidence[1] as typeof evidence[number]],
      evidenceSupport: support,
      correlationId: 'corr-linkage-test',
      idempotencyKey: 'idem-linkage-test',
      startedAt: T1,
      finishedAt: T2,
      provenance: { executedBy: 'arena-demo-verifier', recordedAt: T2, notes: null },
    },
    verifier,
  );
}

describe('toEvidenceLinks — append-only evidence addresses', () => {
  it('renders valid content digests under the evidence truth class (positive)', () => {
    const { links, malformedCount } = toEvidenceLinks(
      [DIGEST_REGRESSION, DIGEST_REVIEW],
      'trajectory-completion',
    );
    expect(links).toHaveLength(2);
    expect(malformedCount).toBe(0);
    for (const link of links) {
      expect(link.truthClass).toBe('evidence');
      expect(link.source).toBe('trajectory-completion');
      expect(link.note).toContain('append-only evidence address');
    }
  });

  it('counts (never renders) malformed digests (negative)', () => {
    const { links, malformedCount } = toEvidenceLinks(
      [DIGEST_REGRESSION, 'not-a-digest', 42, null],
      'run-result',
    );
    expect(links).toHaveLength(1);
    expect(malformedCount).toBe(3);
  });
});

describe('toEvaluationLink — evaluation results render as evaluation-result, never verified', () => {
  it('projects a REAL evaluation record under its OWN truth class (positive)', async () => {
    const record = await buildEvaluation();
    const link = toEvaluationLink(record);
    expect(link.readable).toBe(true);
    expect(link.truthClass).toBe('evaluation-result');
    expect(link.truthClass).not.toBe('verified-fact');
    expect(link.trajectoryRef).toBe(DIGEST_TRAJECTORY);
    expect(link.aggregateScore).toBeGreaterThan(0.75);
    expect(link.verdictCount).toBe(1);
    expect(link.note).toContain('NOT a verification outcome');
  });

  it('binds to the trajectory by content addressing (the linkage predicate)', async () => {
    const record = await buildEvaluation();
    expect(evaluationLinksTrajectory(record, DIGEST_TRAJECTORY)).toBe(true);
    expect(evaluationLinksTrajectory(record, '0'.repeat(64))).toBe(false);
  });

  it('degrades malformed payloads to unknown rows (negative)', () => {
    for (const payload of [null, 42, { digest: 'x' }, { verdicts: [] }]) {
      const link = toEvaluationLink(payload);
      expect(link.readable).toBe(false);
      expect(link.truthClass).toBe('unknown');
      expect(link.aggregateScore).toBeNull();
      expect(link.note).toContain('never guessed');
    }
  });
});

describe('toVerificationLink — verification renders as its own class', () => {
  it('renders a DECIDED outcome as verified-fact (a fact about what the verifier decided)', async () => {
    const record = await buildVerification('decided');
    const link = toVerificationLink(record);
    expect(link.readable).toBe(true);
    expect(link.outcome).toBe('pass');
    expect(link.truthClass).toBe('verified-fact');
    expect(link.requirementsCount).toBe(2);
    expect(link.supportedCount).toBe(2);
    expect(link.note).toContain('never emits a score');
  });

  it('renders an UNKNOWN outcome as unknown — never guessed', async () => {
    const record = await buildVerification('unknown');
    const link = toVerificationLink(record);
    expect(link.outcome).toBe('unknown');
    expect(link.truthClass).toBe('unknown');
    expect(link.unknownCause).not.toBeNull();
    expect(link.note).toContain('no verdict is guessed');
  });

  it('degrades malformed payloads to unknown rows (negative)', () => {
    for (const payload of [null, 'garbage', { outcome: 'pass' }]) {
      const link = toVerificationLink(payload);
      expect(link.readable).toBe(false);
      expect(link.truthClass).toBe('unknown');
      expect(link.outcome).toBeNull();
    }
  });
});

describe('toReplayLinkage — the whole linkage assembly', () => {
  it('deduplicates evidence addresses across sources and carries verification evidence', async () => {
    const verification = await buildVerification('decided');
    const linkage = toReplayLinkage({
      trajectoryEvidenceDigests: [DIGEST_REGRESSION],
      runResultEvidenceDigests: [DIGEST_REGRESSION, DIGEST_REVIEW],
      evaluationRecords: [],
      verificationRecords: [verification],
    });
    expect(linkage.evidence.map((link) => link.digest).sort()).toEqual(
      [DIGEST_REGRESSION, DIGEST_REVIEW].sort(),
    );
    expect(linkage.degradation).toHaveLength(0);
  });

  it('reports degradation notes for malformed digests and unreadable records (negative)', () => {
    const linkage = toReplayLinkage({
      trajectoryEvidenceDigests: ['bad-digest'],
      runResultEvidenceDigests: [],
      evaluationRecords: [{ garbage: true }],
      verificationRecords: ['garbage'],
    });
    expect(linkage.evidence).toHaveLength(0);
    expect(linkage.evaluations[0]?.truthClass).toBe('unknown');
    expect(linkage.verifications[0]?.truthClass).toBe('unknown');
    expect(linkage.degradation.join(' ')).toContain('malformed trajectory evidence address');
    expect(linkage.degradation.join(' ')).toContain('unreadable');
  });
});
