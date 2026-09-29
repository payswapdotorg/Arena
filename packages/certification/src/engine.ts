/**
 * CertificationEngine — the DETERMINISTIC evaluation of one
 * Body × Substrate × Environment × RuntimeProfile × Suite tuple into a
 * typed CertificationRecord (Work Order A023; requirements R21, R22,
 * R43; architecture-lock rules 4, 16, 17; docs/architecture.md §13/§14;
 * the README design law).
 *
 * Pure orchestration over the CONSUMED sibling protocols (all merged,
 * consumed through their public guards — never reimplemented):
 *
 *   - verification stages (A013 @arena/verification): a
 *     VerificationRecord whose verifierRef equals the stage pin;
 *     satisfied ⇔ outcome pass; fail ⇒ not-satisfied; unknown ⇒
 *     unknown (method-limitation — the verifier could not decide);
 *   - evaluation stages (A012 @arena/evaluation): an EvaluationRecord
 *     whose evaluatorRef AND criteriaRef equal the stage pins;
 *     satisfied ⇔ aggregate outcome meets-criteria; below-criteria ⇒
 *     not-satisfied;
 *   - compatibility stages (A022 @arena/compatibility): a
 *     CompatibilityRecord for the subject's exact body×substrate pair;
 *     satisfied ⇔ verdict compatible; incompatible-with-reasons ⇒
 *     not-satisfied (the reasons ride along); unknown-with-structured-
 *     causes ⇒ unknown (method-limitation);
 *   - dataset stages (A014 @arena/datasets): the pinned DatasetManifest
 *     resolving by digest; satisfied ⇔ present with matching identity;
 *   - composition stages: the subject's environment/runtime components
 *     matching the stage pins; mismatch ⇒ not-satisfied
 *     (composition-mismatch — the suite requires a different
 *     composition than the one under test).
 *
 * FAIL-CLOSED everywhere: a stage with NO resolving evidence is UNKNOWN
 * (missing-evidence) — never a silent pass; evidence that resolves but
 * does not match the pin is UNKNOWN (evidence-mismatch); structurally
 * invalid evidence is UNKNOWN (invalid-evidence); cross-tenant
 * compatibility evidence is UNKNOWN (tenant-mismatch, lock rule 11).
 * The suite verdict rolls up through deriveCertificationOutcome.
 *
 * Determinism: identical (suite, subject, evidence, context) tuples
 * yield the byte-identical record digest (fixed timestamps in the
 * context make the whole run deterministic — the reproducibility
 * anchor of R22).
 */

import { isEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { isVerificationRecord } from '@arena/verification';
import type { VerificationRecord } from '@arena/verification';
import { isCompatibilityRecord } from '@arena/compatibility';
import type { CompatibilityRecord } from '@arena/compatibility';
import { isDatasetManifest } from '@arena/datasets';
import type { DatasetManifest } from '@arena/datasets';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { CertificationUnknownReason, StageResult } from './outcome.js';
import { createCertificationRecord } from './record.js';
import type { CertificationRecord } from './record.js';
import type { CertificationSubject } from './subject.js';
import type { CertificationSuite } from './suite.js';
import { isCertificationSuite } from './suite.js';

// ---------------------------------------------------------------------------
// The canonical subject keys (what the compatibility evidence must name)
// ---------------------------------------------------------------------------

/** The canonical body-version ref key of a subject (A022 evidence matching). */
export function subjectBodyVersionRefKey(subject: CertificationSubject): string {
  return `${subject.bodyVersionRef.tenant}/${subject.bodyVersionRef.name}@${subject.bodyVersionRef.version}#${subject.bodyVersionRef.digest}`;
}

/** The canonical substrate ref key of a subject (A022 evidence matching). */
export function subjectSubstrateRefKey(subject: CertificationSubject): string {
  return `${subject.substrateRef.substrateId}@${subject.substrateRef.substrateVersion}#${subject.substrateRef.digest}`;
}

// ---------------------------------------------------------------------------
// Evidence bundle
// ---------------------------------------------------------------------------

/**
 * The evidence bundle of one certification run: the sibling-protocol
 * records the engine consumes. Unknown-shaped entries are REJECTED as
 * invalid evidence per stage (fail-closed), never silently skipped.
 */
export interface CertificationEvidence {
  /** A012 EvaluationRecords (evaluation stages). */
  readonly evaluations: readonly unknown[];
  /** A013 VerificationRecords (verification stages). */
  readonly verifications: readonly unknown[];
  /** A022 CompatibilityRecords (compatibility stages). */
  readonly compatibility: readonly unknown[];
  /** A014 DatasetManifests (dataset stages). */
  readonly datasets: readonly unknown[];
}

/** Stable field list for the evidence bundle (tests + contracts mirror it). */
export const CERTIFICATION_EVIDENCE_FIELDS = Object.freeze([
  'evaluations',
  'verifications',
  'compatibility',
  'datasets',
] as const) as readonly string[];

// ---------------------------------------------------------------------------
// Stage evaluation (closed conditions, machine-readable reasons)
// ---------------------------------------------------------------------------

function unknownStage(
  stageId: string,
  reason: CertificationUnknownReason,
  detail: string,
  evidenceDigest: string | null = null,
): StageResult {
  return {
    stageId,
    outcome: 'unknown',
    reason,
    evidenceDigest,
    unknownCause: { reason, detail },
  };
}

function evaluateVerificationStage(
  stage: { readonly stageId: string; readonly verifierRef: string | null },
  evidence: readonly unknown[],
): StageResult {
  const candidates = evidence.filter((entry) => isVerificationRecord(entry));
  const invalid = evidence.length - candidates.length;
  const pinned = candidates.filter(
    (entry) => (entry as VerificationRecord).verifierRef === stage.verifierRef,
  );
  if (pinned.length === 0) {
    if (candidates.length === 0 && invalid > 0) {
      return unknownStage(
        stage.stageId,
        'invalid-evidence',
        `the supplied verification evidence contains no structurally valid VerificationRecord`,
      );
    }
    if (candidates.length > 0 || invalid > 0) {
      return unknownStage(
        stage.stageId,
        'evidence-mismatch',
        `no verification record matches verifierRef ${String(stage.verifierRef)}`,
      );
    }
    return unknownStage(
      stage.stageId,
      'missing-evidence',
      `no verification record resolves verifierRef ${String(stage.verifierRef)}`,
    );
  }
  const record = pinned[0] as VerificationRecord;
  if (record.outcome === 'pass') {
    return {
      stageId: stage.stageId,
      outcome: 'satisfied',
      reason: 'stage-satisfied',
      evidenceDigest: record.digest,
      unknownCause: null,
    };
  }
  if (record.outcome === 'fail') {
    return {
      stageId: stage.stageId,
      outcome: 'not-satisfied',
      reason: 'stage-failed',
      evidenceDigest: record.digest,
      unknownCause: null,
    };
  }
  return unknownStage(
    stage.stageId,
    'method-limitation',
    `the pinned verification record outcome is unknown (verifier could not decide)`,
    record.digest,
  );
}

function evaluateEvaluationStage(
  stage: {
    readonly stageId: string;
    readonly evaluatorRef: string | null;
    readonly criteriaRef: string | null;
  },
  evidence: readonly unknown[],
): StageResult {
  const candidates = evidence.filter((entry) => isEvaluationRecord(entry));
  const pinned = candidates.filter(
    (entry) =>
      (entry as EvaluationRecord).evaluatorRef === stage.evaluatorRef &&
      (entry as EvaluationRecord).criteriaRef === stage.criteriaRef,
  );
  if (pinned.length === 0) {
    if (candidates.length > 0) {
      return unknownStage(
        stage.stageId,
        'evidence-mismatch',
        `no evaluation record matches evaluatorRef ${String(stage.evaluatorRef)} + criteriaRef ${String(stage.criteriaRef)}`,
      );
    }
    return unknownStage(
      stage.stageId,
      'missing-evidence',
      `no evaluation record resolves evaluatorRef ${String(stage.evaluatorRef)} + criteriaRef ${String(stage.criteriaRef)}`,
    );
  }
  const record = pinned[0] as EvaluationRecord;
  if (record.aggregate.outcome === 'meets-criteria') {
    return {
      stageId: stage.stageId,
      outcome: 'satisfied',
      reason: 'stage-satisfied',
      evidenceDigest: record.digest,
      unknownCause: null,
    };
  }
  return {
    stageId: stage.stageId,
    outcome: 'not-satisfied',
    reason: 'stage-failed',
    evidenceDigest: record.digest,
    unknownCause: null,
  };
}

function evaluateCompatibilityStage(
  stage: {
    readonly stageId: string;
    readonly requiredTestSuites: readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[];
  },
  subject: CertificationSubject,
  evidence: readonly unknown[],
  runTenant: string | null,
): StageResult {
  const bodyKey = subjectBodyVersionRefKey(subject);
  const substrateKey = subjectSubstrateRefKey(subject);
  const candidates = evidence.filter(
    (entry) =>
      isCompatibilityRecord(entry) &&
      (entry as CompatibilityRecord).bodyVersionRef === bodyKey &&
      (entry as CompatibilityRecord).substrateRef === substrateKey,
  );
  if (candidates.length === 0) {
    const anyValid = evidence.some((entry) => isCompatibilityRecord(entry));
    return unknownStage(
      stage.stageId,
      anyValid ? 'evidence-mismatch' : 'missing-evidence',
      anyValid
        ? `no compatibility record matches the subject pair ${bodyKey} × ${substrateKey}`
        : `no compatibility evidence supplied for ${bodyKey} × ${substrateKey}`,
    );
  }
  const record = candidates[0] as CompatibilityRecord;
  // Tenant scoping (lock rule 11): cross-tenant evidence is UNKNOWN,
  // never a pass.
  if (
    runTenant !== null &&
    record.tenantId !== undefined &&
    record.tenantId !== null &&
    record.tenantId !== runTenant
  ) {
    return unknownStage(
      stage.stageId,
      'tenant-mismatch',
      `compatibility evidence belongs to tenant ${JSON.stringify(record.tenantId)} but the run is scoped to ${JSON.stringify(runTenant)}`,
      record.recordDigest,
    );
  }
  if (record.verdict === 'compatible') {
    return {
      stageId: stage.stageId,
      outcome: 'satisfied',
      reason: 'stage-satisfied',
      evidenceDigest: record.recordDigest,
      unknownCause: null,
    };
  }
  if (record.verdict === 'incompatible-with-reasons') {
    return {
      stageId: stage.stageId,
      outcome: 'not-satisfied',
      reason: 'stage-failed',
      evidenceDigest: record.recordDigest,
      unknownCause: null,
    };
  }
  return unknownStage(
    stage.stageId,
    'method-limitation',
    `the compatibility engine returned unknown-with-structured-causes (${record.reasons.join('; ')})`,
    record.recordDigest,
  );
}

function evaluateDatasetStage(
  stage: {
    readonly stageId: string;
    readonly datasetRef: { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string } | null;
  },
  evidence: readonly unknown[],
): StageResult {
  if (stage.datasetRef === null) {
    return unknownStage(stage.stageId, 'invalid-evidence', 'the stage declares no dataset pin');
  }
  const candidates = evidence.filter(
    (entry) => isDatasetManifest(entry) && (entry as DatasetManifest).digest === stage.datasetRef!.digest,
  );
  if (candidates.length === 0) {
    const anyValid = evidence.some((entry) => isDatasetManifest(entry));
    return unknownStage(
      stage.stageId,
      anyValid ? 'evidence-mismatch' : 'missing-evidence',
      anyValid
        ? `no dataset manifest matches the pinned digest ${stage.datasetRef!.digest}`
        : `no dataset evidence supplied for pin ${stage.datasetRef!.namespace}/${stage.datasetRef!.name}@${stage.datasetRef!.version}`,
    );
  }
  const manifest = candidates[0] as DatasetManifest;
  const identity = manifest.identity;
  if (
    identity.namespace !== stage.datasetRef.namespace ||
    identity.name !== stage.datasetRef.name ||
    identity.version !== stage.datasetRef.version
  ) {
    return unknownStage(
      stage.stageId,
      'evidence-mismatch',
      `the manifest at digest ${stage.datasetRef!.digest} declares identity ${identity.namespace}/${identity.name}@${identity.version}, not the pinned ${stage.datasetRef!.namespace}/${stage.datasetRef!.name}@${stage.datasetRef!.version}`,
      manifest.digest,
    );
  }
  return {
    stageId: stage.stageId,
    outcome: 'satisfied',
    reason: 'stage-satisfied',
    evidenceDigest: manifest.digest,
    unknownCause: null,
  };
}

function evaluateCompositionStage(
  stage: {
    readonly stageId: string;
    readonly environmentRequirement: { readonly environmentId: string; readonly environmentVersion: string } | null;
    readonly runtimeRequirement: { readonly runtimeId: string; readonly runtimeVersion: string } | null;
  },
  subject: CertificationSubject,
): StageResult {
  const failures: string[] = [];
  if (
    stage.environmentRequirement !== null &&
    (subject.environmentRef.environmentId !== stage.environmentRequirement.environmentId ||
      subject.environmentRef.environmentVersion !== stage.environmentRequirement.environmentVersion)
  ) {
    failures.push(
      `environment ${subject.environmentRef.environmentId}@${subject.environmentRef.environmentVersion} does not match the required ${stage.environmentRequirement.environmentId}@${stage.environmentRequirement.environmentVersion}`,
    );
  }
  if (
    stage.runtimeRequirement !== null &&
    (subject.runtimeProfile.runtimeId !== stage.runtimeRequirement.runtimeId ||
      subject.runtimeProfile.runtimeVersion !== stage.runtimeRequirement.runtimeVersion)
  ) {
    failures.push(
      `runtime ${subject.runtimeProfile.runtimeId}@${subject.runtimeProfile.runtimeVersion} does not match the required ${stage.runtimeRequirement.runtimeId}@${stage.runtimeRequirement.runtimeVersion}`,
    );
  }
  if (failures.length > 0) {
    return {
      stageId: stage.stageId,
      outcome: 'not-satisfied',
      reason: 'composition-mismatch',
      evidenceDigest: null,
      unknownCause: null,
    };
  }
  return {
    stageId: stage.stageId,
    outcome: 'satisfied',
    reason: 'stage-satisfied',
    evidenceDigest: null,
    unknownCause: null,
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Options for one certification run. */
export interface CertificationRunContext {
  /** REQUIRED: the run's correlation id (protocol-core, lock rule 17). */
  readonly correlationId: string;
  /** REQUIRED: the idempotency key of the command authorizing the run. */
  readonly idempotencyKey: string;
  /** Fixed started-at (ms-precision UTC); defaults to the run clock. */
  readonly startedAt?: string;
  /** Fixed finished-at; defaults to the run clock after the stages ran. */
  readonly finishedAt?: string;
  /** Free-form provenance notes recorded onto the record. */
  readonly provenanceNotes?: string | null;
  /** The digest of the prior record this run supersedes (recertification). */
  readonly supersedes?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Evaluate ONE certification run deterministically: every declared stage
 * is evaluated against the evidence bundle with the closed conditions
 * above, the suite verdict / granted level / scoped statement are
 * DERIVED, and the append-once CertificationRecord is built through the
 * domain constructor (which computes the input digest and freezes).
 */
export async function evaluateCertificationRun(
  suite: CertificationSuite,
  subject: CertificationSubject,
  evidence: CertificationEvidence,
  context: CertificationRunContext,
): Promise<CertificationRecord> {
  if (!isCertificationSuite(suite)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: 'certification requires a structurally valid certification suite',
    });
  }
  const runTenant = subject.tenantId;
  const startedAt = context.startedAt ?? nowIso();
  const stages: StageResult[] = [];
  for (const stage of suite.stages) {
    switch (stage.kind) {
      case 'verification':
        stages.push(evaluateVerificationStage(stage, evidence.verifications));
        break;
      case 'evaluation':
        stages.push(evaluateEvaluationStage(stage, evidence.evaluations));
        break;
      case 'compatibility':
        stages.push(evaluateCompatibilityStage(stage, subject, evidence.compatibility, runTenant));
        break;
      case 'dataset':
        stages.push(evaluateDatasetStage(stage, evidence.datasets));
        break;
      case 'composition':
        stages.push(evaluateCompositionStage(stage, subject));
        break;
    }
  }
  const finishedAt = context.finishedAt ?? nowIso();
  return createCertificationRecord(
    {
      subject,
      suiteRef: suite.digest,
      stages,
      supersedes: context.supersedes === undefined ? null : context.supersedes,
      correlationId: context.correlationId,
      idempotencyKey: context.idempotencyKey,
      tenantId: subject.tenantId,
      workspaceId: subject.workspaceId,
      startedAt,
      finishedAt,
      provenance: {
        executedBy: suite.suiteId,
        recordedAt: finishedAt,
        notes: context.provenanceNotes === undefined ? null : context.provenanceNotes,
      },
    },
    suite,
  );
}
