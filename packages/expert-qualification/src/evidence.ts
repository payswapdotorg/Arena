/**
 * QualificationEvidence — typed, digest-addressed evidence records backing
 * a competency claim (Work Order A007; requirement R7 "Qualify experts
 * against evidence-backed competencies"; architecture-lock rule 6
 * "Historical evidence is append-only and never rewritten").
 *
 * The CLOSED evidence-kind vocabulary mirrors the Work Order's evidence
 * sources exactly (credential refs from the A006 expert registry, work
 * product refs, verification refs via the A013 verification protocol,
 * evaluation refs via the A012 evaluation protocol):
 *
 *   - `credential-ref` — a professional credential reference
 *     (structurally @arena/expert-registry's CredentialRefView);
 *   - `work-product-ref` — a digest-addressed work product (the A006
 *     EvidenceRef convention: digest + description);
 *   - `verification-ref` — a reference to an A013 VerificationRecord by
 *     content digest, carrying the record's DERIVED outcome
 *     (pass | fail | unknown) so qualification and matching can reason
 *     about verification results WITHOUT network access to the
 *     verification fabric — the record itself stays the authority;
 *   - `evaluation-ref` — a reference to an A012 EvaluationRecord by
 *     content digest.
 *
 * Evidence is APPEND-ONLY: an evidence record is immutable and
 * content-addressed (same record ⇒ same digest; deep-frozen; no mutation
 * API). Supersession APPENDS — a new record may carry `supersedes`
 * (the digest of the record it replaces); the superseded record is never
 * edited and remains addressable for audit. Evidence sufficiency engines
 * (qualification.ts) resolve supersession chains by EXCLUDING superseded
 * records from counts while keeping them in the record set.
 *
 * `observedAt` is the recency dimension (spec/quality-model.md
 * "recentness/freshness"): qualification policies bound how old the
 * evidence backing an in-force qualification may be.
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  isContentDigest,
  isCredentialKind,
  isNeutralText,
  isExpertQualificationTimestamp,
  toContentDigest,
  toCredentialRefView,
  toNeutralText,
  toExpertQualificationTimestamp,
} from './shared.js';
import type { ContentDigest, CredentialRefView, NeutralText } from './shared.js';

/** Wire version of the qualification-evidence record shape. */
export const QUALIFICATION_EVIDENCE_VERSION = 1 as const;

/**
 * The CLOSED evidence-kind vocabulary (Work Order A007 §3.1): credential
 * refs, work-product refs, verification refs (A013 protocol) and
 * evaluation refs (A012 protocol). Unknown kinds are rejected.
 */
export const QUALIFICATION_EVIDENCE_KINDS = Object.freeze([
  'credential-ref',
  'work-product-ref',
  'verification-ref',
  'evaluation-ref',
] as const);

export type QualificationEvidenceKind = (typeof QUALIFICATION_EVIDENCE_KINDS)[number];

export function isQualificationEvidenceKind(
  value: unknown,
): value is QualificationEvidenceKind {
  return (
    typeof value === 'string' &&
    (QUALIFICATION_EVIDENCE_KINDS as readonly string[]).includes(value)
  );
}

/** The DERIVED outcome of a referenced A013 VerificationRecord (A013 enum). */
export const VERIFICATION_REF_OUTCOMES = Object.freeze(['pass', 'fail', 'unknown'] as const);

export type VerificationRefOutcome = (typeof VERIFICATION_REF_OUTCOMES)[number];

export function isVerificationRefOutcome(value: unknown): value is VerificationRefOutcome {
  return (
    typeof value === 'string' &&
    (VERIFICATION_REF_OUTCOMES as readonly string[]).includes(value)
  );
}

/** Stable field list for the evidence record (tests + contracts mirror it). */
export const QUALIFICATION_EVIDENCE_FIELDS = Object.freeze([
  'recordVersion',
  'kind',
  'observedAt',
  'supersedes',
  'credential',
  'workProduct',
  'verification',
  'evaluation',
  'note',
  'digest',
] as const) as readonly string[];

/** Fields of the credential-ref payload variant. */
export const EVIDENCE_CREDENTIAL_FIELDS = Object.freeze(['kind', 'reference', 'issuer'] as const);

/** Fields of the work-product-ref payload variant. */
export const EVIDENCE_WORK_PRODUCT_FIELDS = Object.freeze(['digest', 'description'] as const);

/** Fields of the verification-ref payload variant. */
export const EVIDENCE_VERIFICATION_FIELDS = Object.freeze(['recordDigest', 'outcome'] as const);

/** Fields of the evaluation-ref payload variant. */
export const EVIDENCE_EVALUATION_FIELDS = Object.freeze(['recordDigest'] as const);

/**
 * A digest-addressed work product reference (the A006 EvidenceRef
 * convention: the sha256 digest of the work product artifact plus a
 * human-auditable description).
 */
export interface WorkProductRef {
  readonly digest: ContentDigest;
  readonly description: NeutralText;
}

/**
 * A reference to an A013 VerificationRecord: the record's content digest
 * plus its DERIVED outcome. The A013 fabric stays the authority for the
 * record; this reference is data ABOUT the record, carried so the
 * qualification protocol can treat verification results as evidence
 * without live fabric access.
 */
export interface VerificationRef {
  readonly recordDigest: ContentDigest;
  readonly outcome: VerificationRefOutcome;
}

/** A reference to an A012 EvaluationRecord by content digest. */
export interface EvaluationRef {
  readonly recordDigest: ContentDigest;
}

/** The digest-free view — exactly what the evidence digest commits to. */
export interface QualificationEvidenceView {
  readonly recordVersion: typeof QUALIFICATION_EVIDENCE_VERSION;
  readonly kind: QualificationEvidenceKind;
  /** When the evidence was observed/recorded (ms-precision UTC — recency). */
  readonly observedAt: string;
  /** Digest of the evidence record this one supersedes (append-only). */
  readonly supersedes?: ContentDigest;
  /** Payload for kind=credential-ref. */
  readonly credential?: CredentialRefView;
  /** Payload for kind=work-product-ref. */
  readonly workProduct?: WorkProductRef;
  /** Payload for kind=verification-ref. */
  readonly verification?: VerificationRef;
  /** Payload for kind=evaluation-ref. */
  readonly evaluation?: EvaluationRef;
  readonly note?: NeutralText;
}

/** A frozen, content-addressed qualification evidence record: view + digest. */
export interface QualificationEvidence extends QualificationEvidenceView {
  readonly digest: ContentDigest;
}

export interface CreateQualificationEvidenceInput {
  readonly kind: string;
  readonly observedAt: string;
  readonly supersedes?: string;
  readonly credential?: {
    readonly kind: string;
    readonly reference: string;
    readonly issuer?: string;
  };
  readonly workProduct?: {
    readonly digest: string;
    readonly description: string;
  };
  readonly verification?: {
    readonly recordDigest: string;
    readonly outcome: string;
  };
  readonly evaluation?: {
    readonly recordDigest: string;
  };
  readonly note?: string;
}

function payloadFieldsFor(kind: QualificationEvidenceKind): readonly string[] {
  switch (kind) {
    case 'credential-ref':
      return ['credential'];
    case 'work-product-ref':
      return ['workProduct'];
    case 'verification-ref':
      return ['verification'];
    case 'evaluation-ref':
      return ['evaluation'];
  }
}

function toWorkProductRef(value: unknown, context: string): WorkProductRef {
  const record = expectFields(
    value,
    ['digest', 'description'],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE,
    `${context} work product`,
  );
  return Object.freeze({
    digest: toContentDigest(
      typeof record['digest'] === 'string' ? record['digest'] : '',
      `${context} work product digest`,
    ),
    description: toNeutralText(
      typeof record['description'] === 'string' ? record['description'] : '',
      `${context} work product description`,
    ),
  });
}

function toVerificationRef(value: unknown, context: string): VerificationRef {
  const record = expectFields(
    value,
    ['recordDigest', 'outcome'],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE,
    `${context} verification ref`,
  );
  return Object.freeze({
    recordDigest: toContentDigest(
      typeof record['recordDigest'] === 'string' ? record['recordDigest'] : '',
      `${context} verification record digest`,
    ),
    outcome: expectEnumMember(
      record['outcome'],
      VERIFICATION_REF_OUTCOMES,
      'outcome',
      EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE,
      `${context} verification ref`,
    ),
  });
}

function toEvaluationRef(value: unknown, context: string): EvaluationRef {
  const record = expectFields(
    value,
    ['recordDigest'],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE,
    `${context} evaluation ref`,
  );
  return Object.freeze({
    recordDigest: toContentDigest(
      typeof record['recordDigest'] === 'string' ? record['recordDigest'] : '',
      `${context} evaluation record digest`,
    ),
  });
}

/** Structural (non-throwing) check for the digest-free view. */
export function isQualificationEvidenceView(
  value: unknown,
): value is QualificationEvidenceView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['recordVersion'] !== QUALIFICATION_EVIDENCE_VERSION ||
    !isQualificationEvidenceKind(candidate['kind']) ||
    !isExpertQualificationTimestamp(candidate['observedAt'])
  ) {
    return false;
  }
  if (
    candidate['supersedes'] !== undefined &&
    !isContentDigest(candidate['supersedes'])
  ) {
    return false;
  }
  if (candidate['note'] !== undefined && !isNeutralText(candidate['note'])) {
    return false;
  }
  const kind = candidate['kind'];
  const payload = payloadFieldsFor(kind as QualificationEvidenceKind);
  for (const field of payload) {
    if (candidate[field] === undefined) return false;
  }
  const credential = candidate['credential'];
  if (credential !== undefined) {
    if (typeof credential !== 'object' || credential === null) return false;
    const cred = credential as Record<string, unknown>;
    if (!isCredentialKind(cred['kind'])) return false;
    if (typeof cred['reference'] !== 'string' || cred['reference'].length === 0) return false;
  }
  const workProduct = candidate['workProduct'];
  if (workProduct !== undefined) {
    if (typeof workProduct !== 'object' || workProduct === null) return false;
    const wp = workProduct as Record<string, unknown>;
    if (!isContentDigest(wp['digest'])) return false;
    if (typeof wp['description'] !== 'string' || wp['description'].length === 0) return false;
  }
  const verification = candidate['verification'];
  if (verification !== undefined) {
    if (typeof verification !== 'object' || verification === null) return false;
    const ver = verification as Record<string, unknown>;
    if (!isContentDigest(ver['recordDigest'])) return false;
    if (!isVerificationRefOutcome(ver['outcome'])) return false;
  }
  const evaluation = candidate['evaluation'];
  if (evaluation !== undefined) {
    if (typeof evaluation !== 'object' || evaluation === null) return false;
    const ev = evaluation as Record<string, unknown>;
    if (!isContentDigest(ev['recordDigest'])) return false;
  }
  return true;
}

/** Structural (non-throwing) check for the full evidence record (view + digest). */
export function isQualificationEvidence(value: unknown): value is QualificationEvidence {
  if (!isQualificationEvidenceView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed qualification
 * evidence record. Rejects unknown kinds, missing/extra payload fields for
 * the declared kind, payload fields of OTHER kinds (a kind carries exactly
 * its own payload), malformed payloads, and self-supersession — all with
 * typed ExpertQualificationErrors.
 */
export async function createQualificationEvidence(
  input: CreateQualificationEvidenceInput,
): Promise<QualificationEvidence> {
  const record = expectFields(
    input,
    ['kind', 'observedAt'],
    ['supersedes', 'credential', 'workProduct', 'verification', 'evaluation', 'note'],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE,
    'qualification evidence',
  );

  const kind = expectEnumMember(
    record['kind'],
    QUALIFICATION_EVIDENCE_KINDS,
    'kind',
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE,
    'qualification evidence',
  );

  const observedAt = toExpertQualificationTimestamp(
    typeof record['observedAt'] === 'string' ? record['observedAt'] : '',
    'qualification evidence observedAt',
  );

  const supersedes =
    record['supersedes'] === undefined
      ? undefined
      : toContentDigest(
          typeof record['supersedes'] === 'string' ? record['supersedes'] : '',
          'qualification evidence supersedes',
        );

  // Exactly the declared kind's payload may be present — a credential-ref
  // record carrying a verification payload is a malformed record (the
  // strict-shape twin of the contracts' oneOf-by-kind).
  const expectedPayload = payloadFieldsFor(kind);
  const allPayloadFields = ['credential', 'workProduct', 'verification', 'evaluation'];
  for (const field of allPayloadFields) {
    const present = record[field] !== undefined;
    const expected = expectedPayload.includes(field);
    if (present && !expected) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
        message: `qualification evidence: kind ${JSON.stringify(kind)} carries unexpected payload field '${field}' (each kind carries exactly its own payload)`,
        details: { kind, field, allowed: [...expectedPayload] },
      });
    }
  }
  for (const field of expectedPayload) {
    if (record[field] === undefined) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
        message: `qualification evidence: kind ${JSON.stringify(kind)} requires payload field '${field}'`,
        details: { kind, field },
      });
    }
  }

  const credential =
    kind === 'credential-ref'
      ? toCredentialRefView(
          record['credential'] as {
            kind: string;
            reference: string;
            issuer?: string;
          },
        )
      : undefined;
  const workProduct =
    kind === 'work-product-ref'
      ? toWorkProductRef(record['workProduct'], 'qualification evidence')
      : undefined;
  const verification =
    kind === 'verification-ref'
      ? toVerificationRef(record['verification'], 'qualification evidence')
      : undefined;
  const evaluation =
    kind === 'evaluation-ref'
      ? toEvaluationRef(record['evaluation'], 'qualification evidence')
      : undefined;

  const note =
    record['note'] === undefined
      ? undefined
      : toNeutralText(
          typeof record['note'] === 'string' ? record['note'] : '',
          'qualification evidence note',
        );

  const view: QualificationEvidenceView = {
    recordVersion: QUALIFICATION_EVIDENCE_VERSION,
    kind,
    observedAt,
    ...(supersedes !== undefined ? { supersedes } : {}),
    ...(credential !== undefined ? { credential } : {}),
    ...(workProduct !== undefined ? { workProduct } : {}),
    ...(verification !== undefined ? { verification } : {}),
    ...(evaluation !== undefined ? { evaluation } : {}),
    ...(note !== undefined ? { note } : {}),
  };

  const digest = toContentDigest(
    await digestCanonical(view),
    'qualification evidence digest',
  );
  return deepFreeze({ ...view, digest }) as QualificationEvidence;
}

/** The digest-free view of an evidence record (what the digest commits to). */
export function qualificationEvidenceView(
  evidence: QualificationEvidence,
): QualificationEvidenceView {
  const { digest: _digest, ...view } = evidence;
  return deepFreeze({ ...view }) as QualificationEvidenceView;
}

/**
 * Recompute the evidence digest over the digest-free view and compare.
 * Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeQualificationEvidenceDigest(
  evidence: QualificationEvidence,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isQualificationEvidence(evidence)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'evidence digest recomputation requires a structurally valid qualification evidence record',
    });
  }
  const actual = await digestCanonical(qualificationEvidenceView(evidence));
  if (
    actual !== evidence.digest ||
    (expectedDigest !== undefined && actual !== expectedDigest)
  ) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `qualification evidence digest mismatch: expected ${expectedDigest ?? evidence.digest}, got ${actual}`,
      details: {
        kind: evidence.kind,
        observedAt: evidence.observedAt,
        expected: expectedDigest ?? evidence.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed evidence digest');
}

/**
 * Resolve supersession within an evidence SET (append-only discipline):
 * return the digests of records that are NOT superseded by another record
 * in the same set, SORTED (a pure order-independent projection — the input
 * order never leaks into the result). Superseded records stay in the input
 * set for audit — this projection lists only the evidence that still
 * COUNTS. Pure; deterministic.
 */
export function resolveActiveEvidenceDigests(
  evidence: readonly QualificationEvidence[],
): readonly ContentDigest[] {
  const present = new Set(evidence.map((record) => record.digest));
  const superseded = new Set<string>();
  for (const record of evidence) {
    if (record.supersedes !== undefined && present.has(record.supersedes)) {
      superseded.add(record.supersedes);
    }
  }
  return Object.freeze(
    evidence
      .filter((record) => !superseded.has(record.digest))
      .map((record) => record.digest)
      .sort(),
  );
}
