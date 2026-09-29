/**
 * Evidence objects — the required-evidence declaration, the
 * provenance-bearing evidence reference and the evidence-support summary
 * (Work Order A013; spec EV1.0 "Verification establishes evidence
 * supporting a result"; requirements R13, R14; architecture-lock rules
 * 6, 18 — historical evidence is append-only; material artifacts are
 * provenance-addressable).
 *
 * Evidence in Arena is ALWAYS an A002 MaterialArtifact addressed by an
 * ArtifactRef (namespace/name/version + sha256 content digest). This
 * module binds those refs — reusing @arena/artifact-protocol's real
 * validators (isArtifactRef / toArtifactRef / artifactRefKey), never
 * reimplementing them — and adds the two verification-specific layers:
 *
 *   - EvidenceRequirement — one clause of a verifier's REQUIRED-EVIDENCE
 *     declaration: the evidence KIND demanded, the CLAIM the evidence
 *     must support, and optional pins (exact artifact ref, required
 *     producer). Evidence kinds are an OPEN, charset-validated
 *     vocabulary ('test-report', 'trajectory', 'balance-proof', …):
 *     EV1.0 closes the METHOD vocabulary, not the evidence taxonomy —
 *     new domains extend evidence kinds without forking the lifecycle
 *     (architecture-lock rule 21).
 *
 *   - EvidenceReference — one item of a run's evidence bundle: the
 *     evidence kind the artifact claims to carry, the A002 artifact ref
 *     and the evidence provenance (who produced it, when, notes — R14).
 *
 *   - RequirementSupport / EvidenceSupportSummary — the per-requirement
 *     support statuses that distinguish "evidence exists" from "evidence
 *     exists and supports the claim":
 *
 *       present-supported    — present, digest/provenance verified, and
 *                              the verifier established that it supports
 *                              the claim;
 *       present-unsupported  — present and verified, but contradicts or
 *                              does not support the claim;
 *       present-unverified   — present, but digest or provenance-chain
 *                              validation failed (never silently
 *                              trusted);
 *       present-indeterminate— present and verified, but the method
 *                              could not decide (method limitation);
 *       missing              — absent from the bundle (or its reference
 *                              unresolvable).
 *
 *     The status set is CLOSED and carries no quantitative members; the
 *     aggregate outcome is derived from it by deriveVerificationOutcome
 *     (outcome.ts), never supplied by callers.
 */

import { artifactRefKey, isArtifactRef, toArtifactRef } from '@arena/artifact-protocol';
import type { ArtifactRef } from '@arena/artifact-protocol';
import { VERIFICATION_ERROR_CODES, VerificationError } from './errors.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isVerificationId,
  isVerificationTimestamp,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toVerificationId,
  toVerificationTimestamp,
} from './shared.js';
import type { ContentDigest, NeutralId, NeutralText, VerificationId, VerificationTimestamp } from './shared.js';

// ---------------------------------------------------------------------------
// Evidence kinds (open, charset-validated vocabulary)
// ---------------------------------------------------------------------------

/**
 * Evidence kind — an OPEN vocabulary constrained to the neutral-id
 * charset (EV1.0 closes verification METHODS, not evidence taxonomies;
 * architecture-lock rule 21 — new domains extend, they do not fork).
 */
export type EvidenceKind = string;

/** Structural (non-throwing) check for an evidence kind. */
export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function toEvidenceKind(value: unknown, context: string): EvidenceKind {
  if (!isEvidenceKind(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: `${context}: invalid evidence kind: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Evidence provenance (R14 — who produced the evidence, when)
// ---------------------------------------------------------------------------

/** Provenance of one evidence artifact (requirement R14). */
export interface EvidenceProvenance {
  /** Neutral identity of the producing principal (expert, pipeline, environment). */
  readonly producedBy: NeutralId;
  /** When the evidence artifact was produced (ms-precision UTC). */
  readonly producedAt: VerificationTimestamp;
  /** Optional free-form notes (method, capture context). */
  readonly notes: NeutralText | null;
}

/** Stable field list for evidence provenance (tests + contracts mirror it). */
export const EVIDENCE_PROVENANCE_FIELDS = Object.freeze([
  'producedBy',
  'producedAt',
  'notes',
] as const) as readonly string[];

export interface EvidenceProvenanceInput {
  readonly producedBy: string;
  readonly producedAt: string;
  readonly notes: string | null;
}

/** Structural (non-throwing) check for evidence provenance. */
export function isEvidenceProvenance(value: unknown): value is EvidenceProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['producedBy']) &&
    isVerificationTimestamp(candidate['producedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toEvidenceProvenance(value: unknown): EvidenceProvenance {
  const record = expectFields(
    value,
    ['producedBy', 'producedAt', 'notes'],
    [],
    VERIFICATION_ERROR_CODES.INVALID_PROVENANCE,
    'evidence provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'evidence provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    producedBy: toNeutralId(
      typeof record['producedBy'] === 'string' ? record['producedBy'] : '',
      'evidence provenance producedBy',
    ),
    producedAt: toVerificationTimestamp(
      typeof record['producedAt'] === 'string' ? record['producedAt'] : '',
      'evidence provenance producedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'evidence provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// Evidence reference — one item of a run's evidence bundle
// ---------------------------------------------------------------------------

/**
 * A provenance-bearing, digest-addressed reference to one evidence
 * artifact (per A002's artifact protocol): the evidence kind the
 * artifact claims to carry, the artifact ref itself (namespace/name/
 * version + sha256 content digest) and the evidence provenance.
 */
export interface EvidenceReference {
  /** The evidence kind this artifact claims to carry (open vocabulary). */
  readonly evidenceKind: EvidenceKind;
  /** The A002 artifact reference (reused validator, never reimplemented). */
  readonly artifact: ArtifactRef;
  /** Provenance of the evidence artifact (R14). */
  readonly provenance: EvidenceProvenance;
}

/** Stable field list for an evidence reference (tests + contracts mirror it). */
export const EVIDENCE_REFERENCE_FIELDS = Object.freeze([
  'evidenceKind',
  'artifact',
  'provenance',
] as const) as readonly string[];

export interface EvidenceReferenceInput {
  readonly evidenceKind: string;
  readonly artifact: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly provenance: EvidenceProvenanceInput;
}

/** Structural (non-throwing) check for an evidence reference. */
export function isEvidenceReference(value: unknown): value is EvidenceReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isEvidenceKind(candidate['evidenceKind']) &&
    isArtifactRef(candidate['artifact']) &&
    isEvidenceProvenance(candidate['provenance'])
  );
}

function toEvidenceReference(value: unknown, index: number): EvidenceReference {
  const record = expectFields(
    value,
    ['evidenceKind', 'artifact', 'provenance'],
    [],
    VERIFICATION_ERROR_CODES.INVALID_EVIDENCE,
    `evidence reference ${String(index + 1)}`,
  );
  const artifact = record['artifact'];
  if (typeof artifact !== 'object' || artifact === null || Array.isArray(artifact)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: `evidence reference ${String(index + 1)}: artifact must be an A002 artifact reference`,
    });
  }
  return deepFreeze({
    evidenceKind: toEvidenceKind(record['evidenceKind'], `evidence reference ${String(index + 1)}`),
    artifact: toArtifactRef(artifact as {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    }),
    provenance: toEvidenceProvenance(record['provenance']),
  });
}

/** Validate and freeze a full evidence bundle (non-empty, no unknown fields). */
export function toEvidenceBundle(value: unknown): readonly EvidenceReference[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'an evidence bundle must be a non-empty array of evidence references',
    });
  }
  return Object.freeze(value.map((entry, index) => toEvidenceReference(entry, index)));
}

/** Stable key for an evidence reference: `<kind>:<artifactRefKey>`. */
export function evidenceReferenceKey(ref: EvidenceReference): string {
  return `${ref.evidenceKind}:${artifactRefKey(ref.artifact)}`;
}

// ---------------------------------------------------------------------------
// Evidence requirement — one clause of the required-evidence declaration
// ---------------------------------------------------------------------------

/**
 * One clause of a verifier's REQUIRED-EVIDENCE declaration (EV1.0: "A
 * verifier declares required evidence"): the evidence kind demanded, the
 * claim the evidence must support, and optional pins — an exact artifact
 * ref and/or a required producing principal.
 */
export interface EvidenceRequirement {
  /** Requirement id, unique within the descriptor. */
  readonly requirementId: VerificationId;
  /** The evidence kind that can satisfy this requirement (open vocabulary). */
  readonly evidenceKind: EvidenceKind;
  /** The claim the evidence must support (EV1.0 Separation). */
  readonly claim: NeutralText;
  /** Optional pin: only this exact artifact (by ref) can satisfy the requirement. */
  readonly artifact: ArtifactRef | null;
  /** Optional pin: the evidence must have been produced by this principal. */
  readonly requiredProducer: NeutralId | null;
}

/** Stable field list for an evidence requirement (tests + contracts mirror it). */
export const EVIDENCE_REQUIREMENT_FIELDS = Object.freeze([
  'requirementId',
  'evidenceKind',
  'claim',
  'artifact',
  'requiredProducer',
] as const) as readonly string[];

export interface EvidenceRequirementInput {
  readonly requirementId: string;
  readonly evidenceKind: string;
  readonly claim: string;
  readonly artifact: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  } | null;
  readonly requiredProducer: string | null;
}

/** Structural (non-throwing) check for an evidence requirement. */
export function isEvidenceRequirement(value: unknown): value is EvidenceRequirement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isVerificationId(candidate['requirementId']) &&
    isEvidenceKind(candidate['evidenceKind']) &&
    isNeutralText(candidate['claim']) &&
    (candidate['artifact'] === null || isArtifactRef(candidate['artifact'])) &&
    (candidate['requiredProducer'] === null || isNeutralId(candidate['requiredProducer']))
  );
}

function toEvidenceRequirement(value: unknown, index: number): EvidenceRequirement {
  const record = expectFields(
    value,
    ['requirementId', 'evidenceKind', 'claim', 'artifact', 'requiredProducer'],
    [],
    VERIFICATION_ERROR_CODES.INVALID_REQUIREMENT,
    `evidence requirement ${String(index + 1)}`,
  );
  const artifact = record['artifact'];
  if (artifact !== null && (typeof artifact !== 'object' || artifact === null || Array.isArray(artifact))) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REQUIREMENT, {
      message: `evidence requirement ${String(index + 1)}: artifact pin must be an A002 artifact reference or null`,
    });
  }
  const requiredProducer = record['requiredProducer'];
  if (requiredProducer !== null && typeof requiredProducer !== 'string') {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REQUIREMENT, {
      message: `evidence requirement ${String(index + 1)}: requiredProducer must be a neutral id or null`,
    });
  }
  return deepFreeze({
    requirementId: toVerificationId(
      typeof record['requirementId'] === 'string' ? record['requirementId'] : '',
      `evidence requirement ${String(index + 1)} requirementId`,
    ),
    evidenceKind: toEvidenceKind(record['evidenceKind'], `evidence requirement ${String(index + 1)}`),
    claim: toNeutralText(
      typeof record['claim'] === 'string' ? record['claim'] : '',
      `evidence requirement ${String(index + 1)} claim`,
    ),
    artifact:
      artifact === null
        ? null
        : toArtifactRef(artifact as {
            namespace: string;
            name: string;
            version: string;
            digest: string;
          }),
    requiredProducer:
      requiredProducer === null
        ? null
        : toNeutralId(requiredProducer, `evidence requirement ${String(index + 1)} requiredProducer`),
  });
}

/**
 * Validate a full required-evidence declaration: non-empty, unique
 * requirement ids (DUPLICATE_REQUIREMENT otherwise). Frozen on return.
 */
export function toRequiredEvidence(value: unknown): readonly EvidenceRequirement[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REQUIREMENT, {
      message: 'a verifier must declare a non-empty required-evidence list (EV1.0: a verifier declares required evidence)',
    });
  }
  const requirements = value.map((entry, index) => toEvidenceRequirement(entry, index));
  const seen = new Set<string>();
  for (const requirement of requirements) {
    if (seen.has(requirement.requirementId)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.DUPLICATE_REQUIREMENT, {
        message: `duplicate requirement id ${JSON.stringify(requirement.requirementId)} in required-evidence declaration`,
        details: { requirementId: requirement.requirementId },
      });
    }
    seen.add(requirement.requirementId);
  }
  return Object.freeze(requirements);
}

// ---------------------------------------------------------------------------
// Requirement support + the evidence-support summary
// ---------------------------------------------------------------------------

/** The CLOSED evidence-support status vocabulary (no quantitative members). */
export const EVIDENCE_SUPPORT_STATUSES = Object.freeze([
  'present-supported',
  'present-unsupported',
  'present-unverified',
  'present-indeterminate',
  'missing',
] as const);

export type EvidenceSupportStatus = (typeof EVIDENCE_SUPPORT_STATUSES)[number];

/** Structural (non-throwing) check for the closed support-status enum. */
export function isEvidenceSupportStatus(value: unknown): value is EvidenceSupportStatus {
  return (
    typeof value === 'string' &&
    (EVIDENCE_SUPPORT_STATUSES as readonly string[]).includes(value)
  );
}

/** Validate an evidence-support status against the closed enum. */
export function toEvidenceSupportStatus(
  value: string,
  context: string,
): EvidenceSupportStatus {
  return expectEnumMember(
    value,
    EVIDENCE_SUPPORT_STATUSES,
    'status',
    VERIFICATION_ERROR_CODES.INVALID_EVIDENCE,
    context,
  );
}

/** One requirement's support status within a run. */
export interface RequirementSupport {
  /** The requirement this entry speaks for (set-equal to the descriptor's declaration). */
  readonly requirementId: VerificationId;
  /** The closed support status. */
  readonly status: EvidenceSupportStatus;
  /** Digest of the evidence artifact examined (null when missing). */
  readonly evidenceDigest: ContentDigest | null;
  /** Optional free-form notes supporting the status. */
  readonly notes: NeutralText | null;
}

/** Stable field list for one support entry (tests + contracts mirror it). */
export const REQUIREMENT_SUPPORT_FIELDS = Object.freeze([
  'requirementId',
  'status',
  'evidenceDigest',
  'notes',
] as const) as readonly string[];

export interface RequirementSupportInput {
  readonly requirementId: string;
  readonly status: string;
  readonly evidenceDigest: string | null;
  readonly notes: string | null;
}

/** Structural (non-throwing) check for one support entry. */
export function isRequirementSupport(value: unknown): value is RequirementSupport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isVerificationId(candidate['requirementId']) &&
    isEvidenceSupportStatus(candidate['status']) &&
    (candidate['evidenceDigest'] === null || isContentDigest(candidate['evidenceDigest'])) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

/** The evidence-support summary: one entry per declared requirement. */
export type EvidenceSupportSummary = readonly RequirementSupport[];

/** Structural (non-throwing) check for a support summary (non-empty, valid entries). */
export function isEvidenceSupportSummary(value: unknown): value is EvidenceSupportSummary {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => isRequirementSupport(entry));
}

function toRequirementSupport(value: unknown, index: number): RequirementSupport {
  const record = expectFields(
    value,
    ['requirementId', 'status', 'evidenceDigest', 'notes'],
    [],
    VERIFICATION_ERROR_CODES.INVALID_EVIDENCE,
    `requirement support ${String(index + 1)}`,
  );
  const evidenceDigest = record['evidenceDigest'];
  if (evidenceDigest !== null && typeof evidenceDigest !== 'string') {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: `requirement support ${String(index + 1)}: evidenceDigest must be a content digest or null`,
    });
  }
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: `requirement support ${String(index + 1)}: notes must be neutral text or null`,
    });
  }
  return deepFreeze({
    requirementId: toVerificationId(
      typeof record['requirementId'] === 'string' ? record['requirementId'] : '',
      `requirement support ${String(index + 1)} requirementId`,
    ),
    status: toEvidenceSupportStatus(
      typeof record['status'] === 'string' ? record['status'] : '',
      `requirement support ${String(index + 1)}`,
    ),
    evidenceDigest:
      evidenceDigest === null
        ? null
        : toContentDigest(evidenceDigest, `requirement support ${String(index + 1)} evidenceDigest`),
    notes: notes === null ? null : toNeutralText(notes, `requirement support ${String(index + 1)} notes`),
  });
}

/**
 * Validate and freeze a full evidence-support summary: non-empty, valid
 * entries, no unknown fields, unique requirement ids.
 */
export function toEvidenceSupportSummary(value: unknown): EvidenceSupportSummary {
  if (!Array.isArray(value) || value.length === 0) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'an evidence-support summary must be a non-empty array of requirement-support entries',
    });
  }
  const entries = value.map((entry, index) => toRequirementSupport(entry, index));
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.requirementId)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.DUPLICATE_REQUIREMENT, {
        message: `duplicate requirement id ${JSON.stringify(entry.requirementId)} in evidence-support summary`,
        details: { requirementId: entry.requirementId },
      });
    }
    seen.add(entry.requirementId);
  }
  return Object.freeze(entries);
}

/**
 * Consistency rule between a support status and its evidence digest: a
 * MISSING requirement cannot name evidence, and any PRESENT status must
 * name the digest of the evidence it examined (the summary never claims
 * presence without addressing the artifact it examined).
 */
export function isSupportEvidenceConsistent(entry: RequirementSupport): boolean {
  if (entry.status === 'missing') return entry.evidenceDigest === null;
  return entry.evidenceDigest !== null;
}
