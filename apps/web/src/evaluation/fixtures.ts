/**
 * The deterministic B012 evaluation/verification/certification corpus
 * (Work Order B012; issue #87; apps/web/src/evaluation).
 *
 * PURE, DETERMINISTIC fixtures built EXCLUSIVELY through the PUBLIC APIs
 * of the sibling protocol packages (`@arena/evaluation`, `@arena/
 * verification`, `@arena/certification` — relative imports, the
 * expert-runtime posture): every object below is a REAL, validated,
 * content-addressed protocol object, not a look-alike JSON shape. The
 * corpus carries the B006 demo narrative (the payments-reliability case:
 * an evaluated, independently verified, then composition-certified run)
 * with NO randomness and NO wall clock — every timestamp is a fixed
 * narrative constant, every digest either computed by the protocol
 * package itself or a fixed sha256-shaped constant.
 *
 * Two constructions of this corpus are byte-identical (tested): the demo
 * composition (/demo/evaluation, /demo/research) renders this corpus and
 * the unit tests assert its determinism, so demo state stays
 * deterministic, resettable and visibly labelled — never customer state.
 *
 * The corpus deliberately demonstrates the three truth postures side by
 * side:
 *   - the A012 EvaluationRecord (an evaluation result — never verified);
 *   - the A013 VerificationRecord (evidence support — never a score);
 *   - the A023 CertificationRecords (composition-scoped claims: run A
 *     revoked after a mis-declared pin, run B active and superseding).
 */

import { canonicalJson } from '@arena/protocol-core';
import {
  createEvaluationCriteria,
  createEvaluatorDescriptor,
  createEvaluationRecord,
} from '../../../../packages/evaluation/src/index.js';
import type {
  EvaluationCriteria,
  EvaluationRecord,
  EvaluatorDescriptor,
} from '../../../../packages/evaluation/src/index.js';
import {
  createVerificationRecord,
  createVerifierDescriptor,
} from '../../../../packages/verification/src/index.js';
import type {
  VerificationRecord,
  VerifierDescriptor,
} from '../../../../packages/verification/src/index.js';
import {
  createCertificationSubject,
  createCertificationSuite,
  createRevocationRecord,
  evaluateCertificationRun,
} from '../../../../packages/certification/src/index.js';
import type {
  CertificationRecord,
  CertificationSubject,
  CertificationSuite,
} from '../../../../packages/certification/src/index.js';

// ---------------------------------------------------------------------------
// Fixed narrative constants (no randomness, no wall clock)
// ---------------------------------------------------------------------------

/** The demo narrative epoch offsets used by this corpus (ms-precision UTC). */
export const EVALUATION_DEMO_TIME = Object.freeze({
  t0: '2026-10-01T08:00:00.000Z',
  t1: '2026-10-01T08:05:00.000Z',
  t2: '2026-10-01T08:10:00.000Z',
  t3: '2026-10-01T08:15:00.000Z',
  t4: '2026-10-01T08:20:00.000Z',
} as const);

/** Stable route ids for the demo detail pages (record digests stay internal). */
export const EVALUATION_DEMO_IDS = Object.freeze({
  report: 'demo.evaluation.report.payments-reliability',
  verification: 'demo.evaluation.verification.payments-reliability',
  certificationRunA: 'demo.evaluation.certification.run-a',
  certificationRunB: 'demo.evaluation.certification.run-b',
} as const);

/** Fixed sha256-shaped digests for the objects this corpus references but does not construct. */
const DIGEST_DEMO_CASE = 'ca5e'.repeat(16);
const DIGEST_DEMO_TRAJECTORY = '7a2e'.repeat(16);
const DIGEST_DEMO_BODY_VERSION = 'b04d'.repeat(16);
const DIGEST_DEMO_SUBSTRATE = '5cab'.repeat(16);
const DIGEST_DEMO_REGRESSION = '9e67'.repeat(16);
const DIGEST_DEMO_REVIEW = '2ec0'.repeat(16);

/** The schema refs the demo descriptors declare (protocol-core SchemaRef objects). */
const EVALUATION_OUTPUT_SCHEMA = Object.freeze({
  namespace: 'evaluation',
  name: 'evaluation-record',
  version: '1.0.0',
});
const VERIFIER_INPUT_SCHEMA = Object.freeze({
  namespace: 'verification',
  name: 'verifier-descriptor',
  version: '1.0.0',
});
const CERTIFICATION_SCHEMA = Object.freeze({
  namespace: 'certification',
  name: 'certification-record',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** The deterministic evaluation/verification/certification demo corpus. */
export interface EvaluationDemoCorpus {
  /** The A012 criteria set the report was judged against. */
  readonly criteria: EvaluationCriteria;
  /** The A012 evaluator descriptor that judged. */
  readonly evaluator: EvaluatorDescriptor;
  /** The A012 evaluation record (an evaluation result — never a verification claim). */
  readonly evaluationRecord: EvaluationRecord;
  /** The A013 verifier descriptor that ran. */
  readonly verifier: VerifierDescriptor;
  /** The A013 verification record (evidence support — never a score). */
  readonly verificationRecord: VerificationRecord;
  /** The A023 composition under test (all five components — never a bare model). */
  readonly subject: CertificationSubject;
  /** The A023 certification suite (evaluation + verification + composition stages). */
  readonly suite: CertificationSuite;
  /** Certification run A: satisfied, superseded by run B, then revoked. */
  readonly certificationRunA: CertificationRecord;
  /** Certification run B: satisfied, active (supersedes run A). */
  readonly certificationRunB: CertificationRecord;
  /** The append-only A023 revocation record for run A. */
  readonly revocation: CertificationRecord;
  /** Canonical-JSON determinism stamp over the ordered corpus digests + ids. */
  readonly corpusHash: string;
}

/**
 * Build the deterministic evaluation/verification/certification corpus.
 * PURE: identical calls yield identical protocol objects (identical
 * digests) — no randomness, no clock, no shared state.
 */
export async function buildEvaluationDemoCorpus(): Promise<EvaluationDemoCorpus> {
  const { t0, t1, t2, t3, t4 } = EVALUATION_DEMO_TIME;

  // 1) The explicit, versioned, content-addressed criteria set.
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-payments-reliability',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'regression-coverage',
        weight: 1,
        description: 'Regression tests cover the changed retry path and its failure modes.',
        targetRef: DIGEST_DEMO_CASE,
      },
      {
        criterionId: 'retry-behavior',
        weight: 1,
        description: 'Retry behavior obeys the declared jittered-backoff policy under load.',
        targetRef: DIGEST_DEMO_CASE,
      },
      {
        criterionId: 'review-readiness',
        weight: 1,
        description: 'The change is minimal, reviewable and documented for a human reviewer.',
        targetRef: DIGEST_DEMO_CASE,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });

  // 2) The deterministic-test evaluator that judges against those criteria.
  const evaluator = await createEvaluatorDescriptor({
    evaluatorId: 'evaluator-payments-reliability',
    version: '1.0.0',
    kind: 'deterministic-test',
    inputs: {
      caseRef: DIGEST_DEMO_CASE,
      trajectoryRef: DIGEST_DEMO_TRAJECTORY,
      bodyRef: DIGEST_DEMO_BODY_VERSION,
      substrateRef: DIGEST_DEMO_SUBSTRATE,
    },
    criteriaRef: criteria.digest,
    outputSchema: EVALUATION_OUTPUT_SCHEMA,
    reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
    confidence: 0.9,
    limitations: 'Deterministic suite over one recorded trajectory; it does not generalize beyond the tested composition.',
    provenance: { authoredBy: 'arena-demo', submittedAt: t0, notes: null },
  });

  // 3) The append-once evaluation record (aggregate COMPUTED by the package).
  const evaluationRecord = await createEvaluationRecord(
    {
      evaluatorRef: evaluator.digest,
      caseRef: DIGEST_DEMO_CASE,
      trajectoryRef: DIGEST_DEMO_TRAJECTORY,
      criteriaRef: criteria.digest,
      seed: 'demo-seed-payments-reliability-001',
      verdicts: [
        {
          criterionId: 'regression-coverage',
          score: 0.9,
          judgment: 'Regression tests added for jitter bounds and the retry cap.',
          notes: null,
        },
        {
          criterionId: 'retry-behavior',
          score: 0.85,
          judgment: 'Jittered exponential backoff with retries capped at three.',
          notes: null,
        },
        {
          criterionId: 'review-readiness',
          score: 1,
          judgment: 'Minimal diff with an inline rationale for the human reviewer.',
          notes: null,
        },
      ],
      confidence: 0.9,
      limitations: null,
      startedAt: t1,
      finishedAt: t2,
      provenance: {
        executedBy: 'arena-demo-evaluator',
        recordedAt: t2,
        notes: 'Deterministic demo evaluation run.',
      },
    },
    criteria,
  );

  // 4) The constraint-check verifier with its declared evidence requirements.
  const verifier = await createVerifierDescriptor({
    verifierId: 'verifier-payments-reliability',
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
          digest: DIGEST_DEMO_REGRESSION,
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
          digest: DIGEST_DEMO_REVIEW,
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
    inputSchema: VERIFIER_INPUT_SCHEMA,
    outputSchema: VERIFIER_INPUT_SCHEMA,
    provenance: { authoredBy: 'arena-demo', submittedAt: t0, notes: null },
  });

  // 5) The append-once verification record (outcome DERIVED by the package).
  const verificationRecord = await createVerificationRecord(
    {
      verifierRef: verifier.digest,
      evidence: [
        {
          evidenceKind: 'regression-test-suite',
          artifact: {
            namespace: 'arena-demo',
            name: 'regression-test-suite',
            version: '1.0.0',
            digest: DIGEST_DEMO_REGRESSION,
          },
          provenance: {
            producedBy: 'arena-demo-verifier',
            producedAt: t1,
            notes: null,
          },
        },
        {
          evidenceKind: 'review-report',
          artifact: {
            namespace: 'arena-demo',
            name: 'second-review-report',
            version: '1.0.0',
            digest: DIGEST_DEMO_REVIEW,
          },
          provenance: {
            producedBy: 'arena-demo-reviewer',
            producedAt: t1,
            notes: null,
          },
        },
      ],
      evidenceSupport: [
        {
          requirementId: 'req-regression-rerun',
          status: 'present-supported',
          evidenceDigest: DIGEST_DEMO_REGRESSION,
          notes: 'Suite re-run green in a clean environment.',
        },
        {
          requirementId: 'req-second-review',
          status: 'present-supported',
          evidenceDigest: DIGEST_DEMO_REVIEW,
          notes: 'Second reviewer approved the diff.',
        },
      ],
      correlationId: 'demo-corr-payments-reliability',
      idempotencyKey: 'demo-idem-payments-reliability',
      startedAt: t1,
      finishedAt: t2,
      provenance: {
        executedBy: 'arena-demo-verifier',
        recordedAt: t2,
        notes: 'Deterministic demo verification run.',
      },
    },
    verifier,
  );

  // 6) The composition under test — all five components (never a bare model).
  const subject = createCertificationSubject({
    bodyVersionRef: {
      tenant: 'arena-reference',
      name: 'software-engineer-body',
      version: '1.1.0',
      digest: DIGEST_DEMO_BODY_VERSION,
    },
    substrateRef: {
      substrateId: 'workspace-mount',
      substrateVersion: '1.0.0',
      digest: DIGEST_DEMO_SUBSTRATE,
    },
    environmentRef: {
      environmentId: 'sandboxed-workspace',
      environmentVersion: '1.0.0',
      constraints: ['network-denied-by-default'],
    },
    runtimeProfile: {
      runtimeId: 'arena-runtime',
      runtimeVersion: '2.1.0',
      configuration: { timeoutMs: 30000 },
    },
    possessionRef: null,
    tenantId: 'arena-demo',
    workspaceId: 'demo-workspace',
  });

  // 7) The certification suite: evaluation + verification + composition
  //    stages over the pinned digests, with a declared constraint (so the
  //    derived grant level is honestly CONDITIONAL, not CERTIFIED).
  const suite = await createCertificationSuite({
    suiteId: 'suite-payments-reliability',
    version: '1.0.0',
    levelGrant: 'CERTIFIED',
    stages: [
      {
        stageId: 'stage-evaluation',
        kind: 'evaluation',
        evaluatorRef: evaluator.digest,
        criteriaRef: criteria.digest,
        verifierRef: null,
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: null,
        runtimeRequirement: null,
      },
      {
        stageId: 'stage-verification',
        kind: 'verification',
        evaluatorRef: null,
        criteriaRef: null,
        verifierRef: verifier.digest,
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: null,
        runtimeRequirement: null,
      },
      {
        stageId: 'stage-composition',
        kind: 'composition',
        evaluatorRef: null,
        criteriaRef: null,
        verifierRef: null,
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: {
          environmentId: 'sandboxed-workspace',
          environmentVersion: '1.0.0',
        },
        runtimeRequirement: { runtimeId: 'arena-runtime', runtimeVersion: '2.1.0' },
      },
    ],
    constraints: [
      'Certificate applies only under the pinned sandboxed-workspace environment profile.',
    ],
    limitations:
      'Certification covers the tested composition only; it is not a professional qualification and not a marketplace entitlement.',
    supersedes: null,
    inputSchema: CERTIFICATION_SCHEMA,
    outputSchema: CERTIFICATION_SCHEMA,
    provenance: { authoredBy: 'arena-demo', submittedAt: t0, notes: null },
  });

  // 8) Run A: satisfied over the real evidence (evaluation + verification).
  const certificationRunA = await evaluateCertificationRun(
    suite,
    subject,
    { evaluations: [evaluationRecord], verifications: [verificationRecord], compatibility: [], datasets: [] },
    {
      correlationId: 'demo-corr-certification-run-a',
      idempotencyKey: 'demo-idem-certification-run-a',
      startedAt: t2,
      finishedAt: t3,
      provenanceNotes: 'Deterministic demo certification run A.',
      supersedes: null,
    },
  );

  // 9) Run B: the re-certification that supersedes run A (active posture).
  const certificationRunB = await evaluateCertificationRun(
    suite,
    subject,
    { evaluations: [evaluationRecord], verifications: [verificationRecord], compatibility: [], datasets: [] },
    {
      correlationId: 'demo-corr-certification-run-b',
      idempotencyKey: 'demo-idem-certification-run-b',
      startedAt: t3,
      finishedAt: t4,
      provenanceNotes: 'Deterministic demo certification run B (supersedes run A).',
      supersedes: certificationRunA.digest,
    },
  );

  // 10) The append-only revocation of run A (mis-declared pin discovered).
  const revocation = await createRevocationRecord({
    revokes: certificationRunA.digest,
    grounds:
      'Run A was revoked after its environment pin was found mis-declared against the sandboxed-workspace profile.',
    correlationId: 'demo-corr-revocation-run-a',
    idempotencyKey: 'demo-idem-revocation-run-a',
    tenantId: 'arena-demo',
    workspaceId: 'demo-workspace',
    startedAt: t4,
    finishedAt: t4,
    provenance: {
      executedBy: 'arena-demo-governance',
      recordedAt: t4,
      notes: null,
    },
  });

  const corpusHash = canonicalJson([
    EVALUATION_DEMO_IDS.report,
    criteria.digest,
    evaluator.digest,
    evaluationRecord.digest,
    verifier.digest,
    verificationRecord.digest,
    suite.digest,
    certificationRunA.digest,
    certificationRunB.digest,
    revocation.digest,
  ]);

  return Object.freeze({
    criteria,
    evaluator,
    evaluationRecord,
    verifier,
    verificationRecord,
    subject,
    suite,
    certificationRunA,
    certificationRunB,
    revocation,
    corpusHash,
  } satisfies EvaluationDemoCorpus);
}

/**
 * The certification ledger posture of one run, derived from the corpus:
 * REVOKED beats SUPERSEDED beats ACTIVE (the honest projection of the
 * append-only record set — the records themselves are never mutated).
 */
export type CertificationPosture = 'active' | 'superseded' | 'revoked';

/** Derive the effective posture of a certification run digest. */
export function certificationPosture(input: {
  readonly runDigest: string;
  readonly supersededBy: readonly string[];
  readonly revoked: readonly string[];
}): CertificationPosture {
  if (input.revoked.includes(input.runDigest)) return 'revoked';
  if (input.supersededBy.includes(input.runDigest)) return 'superseded';
  return 'active';
}
