/**
 * VerificationRecord — the APPEND-ONCE record of one verification run
 * (Work Order A013; spec EV1.0 "Verification establishes evidence
 * supporting a result"; requirements R13, R14, R27, R28;
 * architecture-lock rules 6, 17, 18).
 *
 * A record binds:
 *   - `verifierRef` — the digest of the VerifierDescriptor that ran
 *     (which verifier, which version, which required-evidence
 *     declaration — all accountable downstream);
 *   - `evidence` — the run's evidence bundle: provenance-bearing,
 *     digest-addressed A002 artifact references (extra evidence beyond
 *     the requirements is recorded for audit; the support summary
 *     speaks only for the declared requirements);
 *   - `evidenceSupport` — the per-requirement support summary
 *     (evidence.ts): one entry per declared requirement, set-equal to
 *     the descriptor's declaration;
 *   - `outcome` — pass | fail | unknown, DERIVED PURELY from the
 *     support summary by deriveVerificationOutcome — never accepted
 *     from the caller, never numerical, never graded (lock rule 7);
 *   - `unknownCause` — the structured WHY of an unknown outcome
 *     (missing-evidence | unverifiable-provenance |
 *     method-limitation + the driving requirement ids); DERIVED, and
 *     REQUIRED iff outcome === 'unknown' (an unknown without a
 *     recorded reason is rejected by construction);
 *   - `correlationId` + `idempotencyKey` — the protocol-core
 *     addressability pair (lock rule 17): the run's causal correlation
 *     id and the idempotency key of the command that authorized the
 *     run (the reference fabric replays same-key-same-input runs as
 *     no-ops and rejects same-key-different-input as conflicts);
 *   - `inputDigest` — the sha256 digest over the canonical form of the
 *     run inputs (verifier digest + full evidence bundle), COMPUTED by
 *     this constructor — the reproducibility anchor: rerunning the
 *     same verifier over the same evidence commits to the same input
 *     digest, and any evidence change changes it;
 *   - `startedAt` / `finishedAt` + run provenance — who executed, when
 *     recorded, notes.
 *
 * Construction is pure: identical inputs yield the identical record
 * digest; the support summary is canonicalized to the descriptor's
 * requirement order for digest stability; finished-at may not precede
 * started-at. Frozen on creation — no mutation API, append-only by
 * content addressing.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import { VERIFICATION_ERROR_CODES, VerificationError } from './errors.js';
import type {
  EvidenceReference,
  EvidenceSupportSummary,
  RequirementSupportInput,
} from './evidence.js';
import {
  isEvidenceReference,
  isEvidenceSupportSummary,
  isSupportEvidenceConsistent,
  toEvidenceBundle,
  toEvidenceSupportSummary,
} from './evidence.js';
import type { UnknownCause, VerificationOutcome } from './outcome.js';
import { deriveVerificationOutcome, isVerificationOutcome } from './outcome.js';
import type { VerifierDescriptor } from './descriptor.js';
import { isVerifierDescriptor } from './descriptor.js';
import {
  deepFreeze,
  expectFields,
  isNeutralId,
  isNeutralText,
  isVerificationTimestamp,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toVerificationTimestamp,
} from './shared.js';
import type { ContentDigest, NeutralId, NeutralText, VerificationTimestamp } from './shared.js';

/** Wire version of the verification-record shape. */
export const VERIFICATION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Run provenance
// ---------------------------------------------------------------------------

/** Provenance of one verification run (EV1.0 "provenance"). */
export interface VerificationProvenance {
  /** Neutral identity of the executing verifier instance/principal. */
  readonly executedBy: NeutralId;
  /** When the record was recorded (ms-precision UTC). */
  readonly recordedAt: VerificationTimestamp;
  /** Optional free-form notes. */
  readonly notes: NeutralText | null;
}

/** Stable field list for run provenance (tests + contracts mirror it). */
export const VERIFICATION_RECORD_PROVENANCE_FIELDS = Object.freeze([
  'executedBy',
  'recordedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for run provenance. */
export function isVerificationProvenance(value: unknown): value is VerificationProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['executedBy']) &&
    isVerificationTimestamp(candidate['recordedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toVerificationProvenance(value: unknown): VerificationProvenance {
  const record = expectFields(
    value,
    ['executedBy', 'recordedAt', 'notes'],
    [],
    VERIFICATION_ERROR_CODES.INVALID_PROVENANCE,
    'verification record provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'verification record provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    executedBy: toNeutralId(
      typeof record['executedBy'] === 'string' ? record['executedBy'] : '',
      'verification record provenance executedBy',
    ),
    recordedAt: toVerificationTimestamp(
      typeof record['recordedAt'] === 'string' ? record['recordedAt'] : '',
      'verification record provenance recordedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'verification record provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// The input digest (reproducibility anchor)
// ---------------------------------------------------------------------------

/**
 * Compute the run-input digest: sha256 over the canonical JSON of
 * { verifierRef, evidence } — the full input material of the run. The
 * record constructor computes this itself from its own view, so a
 * record can always prove what inputs produced it.
 */
export async function computeVerificationInputDigest(
  verifierRef: string,
  evidence: readonly EvidenceReference[],
): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      verifierRef,
      evidence: [...evidence],
    }),
    'verification input digest',
  );
}

// ---------------------------------------------------------------------------
// VerificationRecord
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the record digest commits to. */
export interface VerificationRecordView {
  readonly recordVersion: typeof VERIFICATION_RECORD_VERSION;
  /** Digest of the VerifierDescriptor that ran. */
  readonly verifierRef: ContentDigest;
  /** The evidence bundle examined (provenance-bearing artifact references). */
  readonly evidence: readonly EvidenceReference[];
  /** One support entry per declared requirement (descriptor order). */
  readonly evidenceSupport: EvidenceSupportSummary;
  /** The DERIVED outcome: pass | fail | unknown — never a caller-supplied value. */
  readonly outcome: VerificationOutcome;
  /** The DERIVED structured WHY of an unknown outcome (null iff outcome !== 'unknown'). */
  readonly unknownCause: UnknownCause | null;
  /** The run's correlation id (protocol-core, lock rule 17). */
  readonly correlationId: CorrelationId;
  /** The idempotency key of the command that authorized the run (lock rule 17). */
  readonly idempotencyKey: IdempotencyKey;
  /** Digest over the canonical run inputs {verifierRef, evidence} — computed here. */
  readonly inputDigest: ContentDigest;
  readonly startedAt: VerificationTimestamp;
  readonly finishedAt: VerificationTimestamp;
  readonly provenance: VerificationProvenance;
}

/** A frozen, content-addressed verification record: the view plus its sha256 digest. */
export interface VerificationRecord extends VerificationRecordView {
  readonly digest: ContentDigest;
}

/** Stable field list for the record view (tests + contracts mirror it). */
export const VERIFICATION_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'verifierRef',
  'evidence',
  'evidenceSupport',
  'outcome',
  'unknownCause',
  'correlationId',
  'idempotencyKey',
  'inputDigest',
  'startedAt',
  'finishedAt',
  'provenance',
] as const) as readonly string[];

export interface CreateVerificationRecordInput {
  readonly verifierRef: string;
  readonly evidence: readonly {
    readonly evidenceKind: string;
    readonly artifact: {
      readonly namespace: string;
      readonly name: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly provenance: {
      readonly producedBy: string;
      readonly producedAt: string;
      readonly notes: string | null;
    };
  }[];
  readonly evidenceSupport: readonly RequirementSupportInput[];
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly provenance: {
    readonly executedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isVerificationRecordView(value: unknown): value is VerificationRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === VERIFICATION_RECORD_VERSION &&
    isContentDigestLike(candidate['verifierRef']) &&
    Array.isArray(candidate['evidence']) &&
    (candidate['evidence'] as unknown[]).length > 0 &&
    (candidate['evidence'] as unknown[]).every((entry) => isEvidenceReference(entry)) &&
    isEvidenceSupportSummary(candidate['evidenceSupport']) &&
    isVerificationOutcome(candidate['outcome']) &&
    (candidate['unknownCause'] === null ||
      (typeof candidate['unknownCause'] === 'object' &&
        candidate['unknownCause'] !== null &&
        isUnknownCauseValue(candidate['unknownCause']))) &&
    ((candidate['outcome'] === 'unknown') === (candidate['unknownCause'] !== null)) &&
    isCorrelationId(candidate['correlationId']) &&
    isIdempotencyKey(candidate['idempotencyKey']) &&
    isContentDigestLike(candidate['inputDigest']) &&
    isVerificationTimestamp(candidate['startedAt']) &&
    isVerificationTimestamp(candidate['finishedAt']) &&
    isVerificationProvenance(candidate['provenance'])
  );
}

function isContentDigestLike(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isUnknownCauseValue(value: unknown): boolean {
  const candidate = value as Record<string, unknown>;
  return (
    (candidate['reason'] === 'missing-evidence' ||
      candidate['reason'] === 'unverifiable-provenance' ||
      candidate['reason'] === 'method-limitation') &&
    isNeutralText(candidate['detail'])
  );
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isVerificationRecord(value: unknown): value is VerificationRecord {
  if (!isVerificationRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigestLike(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed verification
 * record — the APPEND-ONCE result of one verification run.
 *
 * The outcome and the unknown cause are COMPUTED from the support
 * summary (never caller-supplied); the input digest is COMPUTED from
 * (verifierRef, evidence); the support summary must be set-equal to the
 * descriptor's required-evidence declaration (order is canonicalized to
 * descriptor order); every present status must name the digest of a
 * bundle artifact; the record's verifierRef must bind the exact
 * descriptor supplied; finished-at may not precede started-at; the
 * correlation id and idempotency key must be protocol-core valid.
 */
export async function createVerificationRecord(
  input: CreateVerificationRecordInput,
  descriptor: VerifierDescriptor,
): Promise<VerificationRecord> {
  const record = expectFields(
    input,
    [
      'verifierRef',
      'evidence',
      'evidenceSupport',
      'correlationId',
      'idempotencyKey',
      'startedAt',
      'finishedAt',
      'provenance',
    ],
    [],
    VERIFICATION_ERROR_CODES.INVALID_RECORD,
    'verification record',
  );

  if (!isVerifierDescriptor(descriptor)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'verification record creation requires a structurally valid verifier descriptor',
    });
  }

  // The record's verifierRef must bind the EXACT descriptor supplied:
  // running one verifier version while referencing another is an
  // integrity violation.
  const declaredVerifierRef =
    typeof record['verifierRef'] === 'string' ? record['verifierRef'] : '';
  if (declaredVerifierRef !== descriptor.digest) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.EVIDENCE_MISMATCH, {
      message: `verification record verifierRef ${JSON.stringify(declaredVerifierRef)} does not match the supplied descriptor (digest ${descriptor.digest}) — a record must bind the exact verifier that ran`,
      details: { declared: declaredVerifierRef, actual: descriptor.digest },
    });
  }

  const evidence = toEvidenceBundle(record['evidence']);
  const support = toEvidenceSupportSummary(record['evidenceSupport']);

  // Set-equality between the support summary and the descriptor's
  // required-evidence declaration (every requirement spoken for, no
  // invented requirements).
  const declared = descriptor.requiredEvidence.map((entry) => entry.requirementId);
  const spoken = support.map((entry) => entry.requirementId);
  const declaredSet = new Set<string>(declared);
  const spokenSet = new Set<string>(spoken);
  for (const id of declared) {
    if (!spokenSet.has(id)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.REQUIREMENT_MISMATCH, {
        message: `evidence-support summary is missing an entry for declared requirement ${JSON.stringify(id)} (every declared requirement must be spoken for)`,
        details: { requirementId: id, declared: [...declared] },
      });
    }
  }
  for (const id of spoken) {
    if (!declaredSet.has(id)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.REQUIREMENT_MISMATCH, {
        message: `evidence-support summary speaks for undeclared requirement ${JSON.stringify(id)} (the descriptor declares: ${declared.join(', ')})`,
        details: { requirementId: id, declared: [...declared] },
      });
    }
  }

  // Canonical order: descriptor's requirement order (digest stability).
  const order = new Map(declared.map((id, index) => [id, index]));
  const orderedSupport = Object.freeze(
    [...support].sort(
      (a, b) => (order.get(a.requirementId) ?? -1) - (order.get(b.requirementId) ?? -1),
    ),
  );

  // Support/evidence consistency: missing ⇒ no evidence digest; present
  // ⇒ the digest must name an artifact in the bundle.
  const bundleDigests = new Set<string>(evidence.map((entry) => entry.artifact.digest));
  for (const entry of orderedSupport) {
    if (!isSupportEvidenceConsistent(entry)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
        message: `requirement support for ${JSON.stringify(entry.requirementId)}: a missing requirement cannot name evidence, and a present status must name the digest of the evidence it examined`,
        details: { requirementId: entry.requirementId, status: entry.status },
      });
    }
    if (entry.evidenceDigest !== null && !bundleDigests.has(entry.evidenceDigest)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.EVIDENCE_MISMATCH, {
        message: `requirement support for ${JSON.stringify(entry.requirementId)} names evidence digest ${entry.evidenceDigest} which is not in the run's evidence bundle`,
        details: { requirementId: entry.requirementId, evidenceDigest: entry.evidenceDigest },
      });
    }
  }

  // The DERIVED outcome + structured unknown cause (never caller-supplied).
  const { outcome, unknownCause } = deriveVerificationOutcome(orderedSupport);

  const startedAt = toVerificationTimestamp(
    typeof record['startedAt'] === 'string' ? record['startedAt'] : '',
    'verification record startedAt',
  );
  const finishedAt = toVerificationTimestamp(
    typeof record['finishedAt'] === 'string' ? record['finishedAt'] : '',
    'verification record finishedAt',
  );
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.TIMESTAMP_REGRESSION, {
      message: `verification record: finishedAt ${finishedAt} precedes startedAt ${startedAt}`,
      details: { startedAt, finishedAt },
    });
  }

  const correlationId = record['correlationId'];
  if (!isCorrelationId(correlationId)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `verification record: invalid correlation id: ${JSON.stringify(correlationId)}`,
    });
  }
  const idempotencyKey = record['idempotencyKey'];
  if (!isIdempotencyKey(idempotencyKey)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `verification record: invalid idempotency key: ${JSON.stringify(idempotencyKey)}`,
    });
  }

  const inputDigest = await computeVerificationInputDigest(declaredVerifierRef, evidence);

  const view: VerificationRecordView = {
    recordVersion: VERIFICATION_RECORD_VERSION,
    verifierRef: toContentDigest(declaredVerifierRef, 'verification record verifierRef'),
    evidence,
    evidenceSupport: orderedSupport,
    outcome,
    unknownCause,
    correlationId,
    idempotencyKey,
    inputDigest,
    startedAt,
    finishedAt,
    provenance: toVerificationProvenance(record['provenance']),
  };
  const digest = toContentDigest(await digestCanonical(view), 'verification record digest');
  return deepFreeze({ ...view, digest }) as VerificationRecord;
}

/** The digest-free view of a record (what the digest commits to). */
export function verificationRecordView(record: VerificationRecord): VerificationRecordView {
  const { digest: _digest, ...view } = record;
  return deepFreeze({ ...view }) as VerificationRecordView;
}

/**
 * Recompute the record digest over the digest-free view and compare
 * (optionally against an expected digest). Throws VERIFICATION_TAMPERED
 * on any mismatch — the append-once content-addressing tripwire.
 */
export async function recomputeVerificationRecordDigest(
  record: VerificationRecord,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isVerificationRecord(record)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'record digest recomputation requires a structurally valid verification record',
    });
  }
  const actual = await digestCanonical(verificationRecordView(record));
  if (actual !== record.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.TAMPERED, {
      message: `verification record digest mismatch: expected ${expectedDigest ?? record.digest}, got ${actual}`,
      details: {
        verifierRef: record.verifierRef,
        expected: expectedDigest ?? record.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed record digest');
}

/**
 * Replay a verification record's construction PURELY from its own
 * inputs: re-derives the outcome and unknown cause from the support
 * summary and rebuilds the record, asserting the byte-identical digest.
 * Throws VERIFICATION_TAMPERED when the recomputed digest differs — the
 * record is append-once, so a replay divergence means tampering.
 */
export async function replayVerificationRecord(
  record: VerificationRecord,
  descriptor: VerifierDescriptor,
): Promise<VerificationRecord> {
  if (!isVerificationRecord(record)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'verification replay requires a structurally valid verification record',
    });
  }
  const rebuilt = await createVerificationRecord(
    {
      verifierRef: record.verifierRef,
      evidence: record.evidence.map((entry) => ({
        evidenceKind: entry.evidenceKind,
        artifact: { ...entry.artifact },
        provenance: { ...entry.provenance },
      })),
      evidenceSupport: record.evidenceSupport.map((entry) => ({
        requirementId: entry.requirementId,
        status: entry.status,
        evidenceDigest: entry.evidenceDigest,
        notes: entry.notes,
      })),
      correlationId: record.correlationId,
      idempotencyKey: record.idempotencyKey,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      provenance: {
        executedBy: record.provenance.executedBy,
        recordedAt: record.provenance.recordedAt,
        notes: record.provenance.notes,
      },
    },
    descriptor,
  );
  if (rebuilt.digest !== record.digest) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.TAMPERED, {
      message: `verification record replay diverged: record declares ${record.digest}, pure reconstruction yields ${rebuilt.digest}`,
      details: { declared: record.digest, reconstructed: rebuilt.digest },
    });
  }
  return rebuilt;
}
