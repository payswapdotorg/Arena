/**
 * The four-tier knowledge lattice (Work Order C008; issue #115; EES1.0
 * "Knowledge capture" + architecture-lock rules 31, 32).
 *
 * Tiers (ordered lattice, the C006 vocabulary — never redefined here):
 *
 *   task-specific-guidance   < scoped-reusable-knowledge
 *                           < candidate-domain-rule
 *                           < verified-domain-constraint
 *
 * A LatticeKnowledgeRecord wraps a C006 KnowledgeArtifact and adds the
 * C008 capture envelope: a STRUCTURED scope declaration
 * (task/case/domain/jurisdiction — scope.ts), non-empty evidence refs, a
 * validation state derived from the artifact's validation reference,
 * the rights/consent statement, capture correlation and provenance, and
 * an append-only promotion history.
 *
 * THE NO-SILENT-PROMOTION LAW IS ENFORCED STRUCTURALLY:
 *   - records are deep-frozen — the tier/scope of a constructed record
 *     can never be rewritten;
 *   - promotion is an EXPLICIT operation (promoteLatticeKnowledge) that
 *     produces a NEW append-only record through the C006 promotion
 *     constructor (which itself requires a recorded justification and a
 *     fresh GRANTED consent statement);
 *   - the OVERGENERALIZATION WALL: a promotion may widen the declared
 *     scope by AT MOST ONE rank — task-scoped guidance can never surface
 *     as domain/jurisdiction (universal) knowledge, no matter what the
 *     justification claims; violations fail closed with a
 *     machine-readable reason;
 *   - the verified-domain-constraint tier REQUIRES validation evidence;
 *   - promotion requires non-empty evidence and a provenance match.
 */

import type { ConsentRightsStatement, KnowledgeArtifact, KnowledgeTier } from '@arena/expert-session';
import { isKnowledgeArtifact, isKnowledgeTier, promoteKnowledgeArtifact } from '@arena/expert-session';
import { KNOWLEDGE_CAPTURE_ERROR_CODES, KnowledgeCaptureError } from './errors.js';
import {
  MAX_SCOPE_WIDENING_PER_PROMOTION,
  isKnowledgeScopeDeclaration,
  scopeRank,
} from './scope.js';
import type { KnowledgeScopeDeclaration } from './scope.js';
import type { KnowledgeRecordId } from './shared.js';
import {
  canonicalContentKey,
  isKnowledgeRecordId,
  newKnowledgeRecordId,
  toKnowledgeCaptureTimestamp,
} from './shared.js';

/** Wire version of the lattice record shape. */
export const KNOWLEDGE_LATTICE_RECORD_VERSION = 1 as const;

/** Validation state of a lattice record (derived from validation evidence). */
export const KNOWLEDGE_VALIDATION_STATES = Object.freeze(['unvalidated', 'validated'] as const);
export type KnowledgeValidationState = (typeof KNOWLEDGE_VALIDATION_STATES)[number];

export function isKnowledgeValidationState(value: unknown): value is KnowledgeValidationState {
  return (
    typeof value === 'string' && (KNOWLEDGE_VALIDATION_STATES as readonly string[]).includes(value)
  );
}

/** Validation evidence backing (or not backing) a record. */
export interface ValidationEvidence {
  readonly state: KnowledgeValidationState;
  /** The validation receipt/reference (non-null iff state is validated). */
  readonly validationRef: string | null;
}

/** Capture provenance — correlation-linked to the originating flow. */
export interface KnowledgeCaptureProvenance {
  readonly tenantId: string;
  readonly interventionId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly expertRef: string | null;
  readonly capturedAt: string;
}

/** One append-only promotion decision (never rewritten). */
export interface KnowledgePromotion {
  readonly fromTier: KnowledgeTier;
  readonly toTier: KnowledgeTier;
  readonly fromScope: KnowledgeScopeDeclaration;
  readonly toScope: KnowledgeScopeDeclaration;
  readonly justification: string;
  readonly consent: ConsentRightsStatement;
  readonly validationRef: string | null;
  readonly occurredAt: string;
}

/** The lattice knowledge record. */
export interface LatticeKnowledgeRecord {
  readonly recordVersion: typeof KNOWLEDGE_LATTICE_RECORD_VERSION;
  readonly recordId: KnowledgeRecordId;
  /** The C006 four-tier artifact this record stages. */
  readonly artifact: KnowledgeArtifact;
  /** The structured scope declaration (typed, machine-checked). */
  readonly scope: KnowledgeScopeDeclaration;
  /** Evidence backing the statement (non-empty by construction). */
  readonly evidenceRefs: readonly string[];
  readonly validation: ValidationEvidence;
  /** Rights/consent statement backing reuse (required for reusable tiers). */
  readonly rights: ConsentRightsStatement | null;
  readonly provenance: KnowledgeCaptureProvenance;
  readonly correlation: {
    readonly correlationId: string;
    readonly captureKey: string;
  };
  /** Deterministic content key over the artifact + scope (dedup). */
  readonly contentKey: string;
  /** Append-only promotion history (empty on capture). */
  readonly promotions: readonly KnowledgePromotion[];
}

export interface CreateLatticeKnowledgeRecordInput {
  readonly artifact: KnowledgeArtifact;
  readonly scope: KnowledgeScopeDeclaration;
  readonly evidenceRefs: readonly string[];
  readonly tenantId: string;
  readonly interventionId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly expertRef?: string;
  readonly correlationId: string;
  readonly captureKey: string;
  readonly now: number | string | Date;
  readonly recordId?: string;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PROVENANCE_MISMATCH, {
      message: `${field} must be a non-empty string (<= 512 chars): ${JSON.stringify(value)}`,
      details: { field },
    });
  }
  return value;
}

/** Tiers that carry reusable knowledge (everything above task guidance). */
export function isReusableTier(tier: KnowledgeTier): boolean {
  return tier !== 'task-specific-guidance';
}

/** Validation evidence derived from an artifact's validation reference. */
export function validationEvidenceOf(artifact: KnowledgeArtifact): ValidationEvidence {
  return artifact.validationRef === null || artifact.validationRef.length === 0
    ? Object.freeze({ state: 'unvalidated', validationRef: null })
    : Object.freeze({ state: 'validated', validationRef: artifact.validationRef });
}

/**
 * Create a lattice knowledge record (fail-closed on every wall):
 *   - the artifact must be a valid C006 KnowledgeArtifact;
 *   - the artifact's session provenance must match the capture provenance
 *     (provenance tampering fails closed);
 *   - the scope must be a typed declaration;
 *   - evidence must be non-empty;
 *   - reusable tiers REQUIRE granted rights (lock rule 31);
 *   - the verified tier REQUIRES validation evidence.
 */
export function createLatticeKnowledgeRecord(
  input: CreateLatticeKnowledgeRecordInput,
): LatticeKnowledgeRecord {
  if (typeof input !== 'object' || input === null) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
      message: 'lattice record input must be an object',
    });
  }
  if (!isKnowledgeArtifact(input.artifact)) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
      message: 'artifact must be a valid C006 KnowledgeArtifact (four-tier vocabulary)',
    });
  }
  if (!isKnowledgeScopeDeclaration(input.scope)) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_SCOPE, {
      message: `scope must be a typed declaration { kind, ref }: ${JSON.stringify(input.scope)}`,
    });
  }
  if (input.artifact.provenance.sessionId !== input.sessionId) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PROVENANCE_MISMATCH, {
      message: 'artifact provenance session must match the capture session (provenance tampering fails closed)',
      details: {
        artifactSession: input.artifact.provenance.sessionId,
        captureSession: input.sessionId,
      },
    });
  }
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.MISSING_EVIDENCE, {
      message: 'evidenceRefs is required — knowledge without evidence is an unverifiable claim',
    });
  }
  for (const ref of input.evidenceRefs) {
    if (typeof ref !== 'string' || ref.length === 0 || ref.length > 512) {
      throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.MISSING_EVIDENCE, {
        message: `evidenceRefs entries must be non-empty strings: ${JSON.stringify(ref)}`,
      });
    }
  }

  const tier = input.artifact.tier;
  if (isReusableTier(tier)) {
    const rights = input.artifact.consent;
    if (rights === null || !rights.granted) {
      throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.MISSING_RIGHTS, {
        message: `tier '${tier}' requires GRANTED rights/consent (architecture-lock rule 31 — reuse requires explicit rights)`,
        details: { tier },
      });
    }
  }
  const validation = validationEvidenceOf(input.artifact);
  if (tier === 'verified-domain-constraint' && validation.state !== 'validated') {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
      message: "tier 'verified-domain-constraint' requires validation evidence — unverified claims can never be constructed as verified",
      details: { tier },
    });
  }

  const tenantId = requireNonEmpty(input.tenantId, 'tenantId');
  const interventionId = requireNonEmpty(input.interventionId, 'interventionId');
  const requestId = requireNonEmpty(input.requestId, 'requestId');
  const sessionId = requireNonEmpty(input.sessionId, 'sessionId');
  const correlationId = requireNonEmpty(input.correlationId, 'correlationId');
  const captureKey = requireNonEmpty(input.captureKey, 'captureKey');
  const capturedAt = toKnowledgeCaptureTimestamp(input.now);
  const recordId =
    input.recordId === undefined
      ? newKnowledgeRecordId()
      : isKnowledgeRecordId(input.recordId)
        ? input.recordId
        : (() => {
            throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
              message: `recordId is invalid: ${JSON.stringify(input.recordId)}`,
            });
          })();

  const record: LatticeKnowledgeRecord = Object.freeze({
    recordVersion: KNOWLEDGE_LATTICE_RECORD_VERSION,
    recordId,
    artifact: input.artifact,
    scope: Object.freeze({ kind: input.scope.kind, ref: input.scope.ref }),
    evidenceRefs: Object.freeze([...input.evidenceRefs]),
    validation,
    rights: input.artifact.consent,
    provenance: Object.freeze({
      tenantId,
      interventionId,
      requestId,
      sessionId,
      expertRef: input.expertRef ?? null,
      capturedAt,
    }),
    correlation: Object.freeze({ correlationId, captureKey }),
    contentKey: knowledgeContentKey(input.artifact, input.scope),
    promotions: Object.freeze([]),
  });
  return record;
}

/** Deterministic content key over the artifact + typed scope (dedup). */
export function knowledgeContentKey(
  artifact: KnowledgeArtifact,
  scope: KnowledgeScopeDeclaration,
): string {
  return canonicalContentKey({
    artifactVersion: artifact.artifactVersion,
    artifactId: artifact.artifactId,
    tier: artifact.tier,
    statement: artifact.statement,
    scope: artifact.scope,
    declaredScope: { kind: scope.kind, ref: scope.ref },
    sessionId: artifact.provenance.sessionId,
    validationRef: artifact.validationRef,
    promotedFrom: artifact.promotedFrom,
  });
}

// ---------------------------------------------------------------------------
// THE NO-SILENT-PROMOTION WALL (machine-checked, fail-closed)
// ---------------------------------------------------------------------------

/** Machine-readable promotion verdict reasons (never bare booleans). */
export const KNOWLEDGE_PROMOTION_REASONS = Object.freeze([
  'promotion_ok',
  'wall_not_upward',
  'wall_same_tier',
  'wall_overgeneralization',
  'wall_scope_requires_consent',
  'wall_verified_requires_validation',
  'wall_missing_evidence',
  'wall_provenance_mismatch',
  'wall_requires_justification',
  'wall_unknown_tier',
] as const);
export type KnowledgePromotionReason = (typeof KNOWLEDGE_PROMOTION_REASONS)[number];

/** Machine-readable promotion verdict (pure — no mutation). */
export interface KnowledgePromotionCheck {
  readonly allowed: boolean;
  readonly reason: KnowledgePromotionReason;
  readonly fromTier: KnowledgeTier;
  readonly toTier: KnowledgeTier;
  readonly fromScope: KnowledgeScopeDeclaration;
  readonly toScope: KnowledgeScopeDeclaration;
}

const TIER_RANK: Readonly<Record<KnowledgeTier, number>> = Object.freeze({
  'task-specific-guidance': 0,
  'scoped-reusable-knowledge': 1,
  'candidate-domain-rule': 2,
  'verified-domain-constraint': 3,
});

export interface CheckKnowledgePromotionInput {
  readonly record: LatticeKnowledgeRecord;
  readonly toTier: string;
  readonly toScope: KnowledgeScopeDeclaration;
  /** Consent backing THIS promotion (must be granted when scope widens or tier rises). */
  readonly consent: ConsentRightsStatement;
  /** Validation reference (required when promoting to verified-domain-constraint). */
  readonly validationRef?: string;
}

/**
 * Verdict for a proposed promotion — THE WALL (pure, total):
 *   - the tier lattice is strictly upward (no demotion, no same-tier);
 *   - scope may widen by AT MOST ONE rank (task -> domain is
 *     overgeneralization and fails closed with wall_overgeneralization);
 *   - scope widening / tier rising REQUIRES granted consent;
 *   - the verified tier REQUIRES validation evidence;
 *   - evidence must be non-empty and provenance must match.
 */
export function checkKnowledgePromotion(input: CheckKnowledgePromotionInput): KnowledgePromotionCheck {
  const fromTier = input.record.artifact.tier;
  const fromScope = input.record.scope;
  if (!isKnowledgeTier(input.toTier)) {
    return {
      allowed: false,
      reason: 'wall_unknown_tier',
      fromTier,
      toTier: input.toTier as KnowledgeTier,
      fromScope,
      toScope: input.toScope,
    };
  }
  const toTier = input.toTier;
  if (toTier === fromTier) {
    return { allowed: false, reason: 'wall_same_tier', fromTier, toTier, fromScope, toScope: input.toScope };
  }
  if (TIER_RANK[toTier] <= TIER_RANK[fromTier]) {
    return { allowed: false, reason: 'wall_not_upward', fromTier, toTier, fromScope, toScope: input.toScope };
  }
  const widening = scopeRank(input.toScope.kind) - scopeRank(fromScope.kind);
  if (widening > MAX_SCOPE_WIDENING_PER_PROMOTION) {
    // THE EES1.0 WALL: task-specific advice must not silently become
    // universal knowledge — a two-rank jump (task -> domain/jurisdiction)
    // is overgeneralization and fails closed.
    return {
      allowed: false,
      reason: 'wall_overgeneralization',
      fromTier,
      toTier,
      fromScope,
      toScope: input.toScope,
    };
  }
  if (widening > 0 && !input.consent.granted) {
    return {
      allowed: false,
      reason: 'wall_scope_requires_consent',
      fromTier,
      toTier,
      fromScope,
      toScope: input.toScope,
    };
  }
  if (toTier === 'verified-domain-constraint') {
    const ref = input.validationRef ?? input.record.artifact.validationRef;
    if (typeof ref !== 'string' || ref.length === 0) {
      return {
        allowed: false,
        reason: 'wall_verified_requires_validation',
        fromTier,
        toTier,
        fromScope,
        toScope: input.toScope,
      };
    }
  }
  if (input.record.evidenceRefs.length === 0) {
    return { allowed: false, reason: 'wall_missing_evidence', fromTier, toTier, fromScope, toScope: input.toScope };
  }
  if (input.record.provenance.sessionId !== input.record.artifact.provenance.sessionId) {
    return { allowed: false, reason: 'wall_provenance_mismatch', fromTier, toTier, fromScope, toScope: input.toScope };
  }
  return { allowed: true, reason: 'promotion_ok', fromTier, toTier, fromScope, toScope: input.toScope };
}

export interface PromoteLatticeKnowledgeInput {
  readonly record: LatticeKnowledgeRecord;
  readonly toTier: string;
  readonly toScope: KnowledgeScopeDeclaration;
  /** Explicit, recorded justification for THIS promotion (never silent). */
  readonly justification: string;
  /** Fresh consent/rights statement for the promoted tier. */
  readonly consent: { granted: boolean; statement: string };
  /** Validation reference (required when promoting to verified-domain-constraint). */
  readonly validationRef?: string;
  readonly now: number | string | Date;
  readonly recordId?: string;
}

/**
 * Promote a lattice record EXPLICITLY through the wall: the C006
 * promotion constructor builds the promoted artifact (recorded
 * justification + fresh granted consent + append-only promotedFrom
 * chain), and THIS layer wraps it in a NEW append-only lattice record
 * whose promotions history gains the decision. Denied promotions throw
 * a typed fail-closed error carrying the machine-readable wall reason.
 */
export function promoteLatticeKnowledge(
  input: PromoteLatticeKnowledgeInput,
): LatticeKnowledgeRecord {
  if (typeof input !== 'object' || input === null) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PROMOTION_DENIED, {
      message: 'promotion input must be an object',
    });
  }
  if (!isKnowledgeScopeDeclaration(input.toScope)) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_SCOPE, {
      message: `toScope must be a typed declaration { kind, ref }: ${JSON.stringify(input.toScope)}`,
    });
  }
  if (typeof input.justification !== 'string' || input.justification.length === 0 || input.justification.length > 4096) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PROMOTION_DENIED, {
      message: 'promotion requires a recorded justification (never silent)',
      details: { reason: 'wall_requires_justification' },
      correlationId: input.record.correlation.correlationId,
    });
  }
  const consent: ConsentRightsStatement = Object.freeze({
    granted: input.consent.granted,
    statement: input.consent.statement,
  });
  const verdict = checkKnowledgePromotion({
    record: input.record,
    toTier: input.toTier,
    toScope: input.toScope,
    consent,
    ...(input.validationRef !== undefined ? { validationRef: input.validationRef } : {}),
  });
  if (!verdict.allowed) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.PROMOTION_DENIED, {
      message: `knowledge promotion ${verdict.fromTier}@${verdict.fromScope.kind} -> ${verdict.toTier}@${verdict.toScope.kind} denied (${verdict.reason})`,
      details: {
        reason: verdict.reason,
        fromTier: verdict.fromTier,
        toTier: verdict.toTier,
        fromScope: verdict.fromScope,
        toScope: verdict.toScope,
      },
      correlationId: input.record.correlation.correlationId,
    });
  }

  // The C006 constructor re-enforces justification/consent/validation and
  // stamps the append-only promotedFrom chain on the artifact.
  const promotedArtifact = promoteKnowledgeArtifact({
    artifact: input.record.artifact,
    toTier: input.toTier,
    justification: input.justification,
    consent: input.consent,
    ...(input.validationRef !== undefined ? { validationRef: input.validationRef } : {}),
    now: input.now,
  });

  const occurredAt = toKnowledgeCaptureTimestamp(input.now);
  const recordId =
    input.recordId === undefined
      ? newKnowledgeRecordId()
      : isKnowledgeRecordId(input.recordId)
        ? input.recordId
        : (() => {
            throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
              message: `recordId is invalid: ${JSON.stringify(input.recordId)}`,
            });
          })();

  const promoted: LatticeKnowledgeRecord = Object.freeze({
    recordVersion: KNOWLEDGE_LATTICE_RECORD_VERSION,
    recordId,
    artifact: promotedArtifact,
    scope: Object.freeze({ kind: input.toScope.kind, ref: input.toScope.ref }),
    evidenceRefs: input.record.evidenceRefs,
    validation: validationEvidenceOf(promotedArtifact),
    rights: promotedArtifact.consent,
    provenance: Object.freeze({
      ...input.record.provenance,
      capturedAt: input.record.provenance.capturedAt,
    }),
    correlation: input.record.correlation,
    contentKey: knowledgeContentKey(promotedArtifact, input.toScope),
    promotions: Object.freeze([
      ...input.record.promotions,
      Object.freeze({
        fromTier: verdict.fromTier,
        toTier: verdict.toTier,
        fromScope: verdict.fromScope,
        toScope: verdict.toScope,
        justification: input.justification,
        consent,
        validationRef: promotedArtifact.validationRef,
        occurredAt,
      }),
    ]),
  });
  return promoted;
}

/** Structural guard for wire values claiming to be lattice records. */
export function isLatticeKnowledgeRecord(value: unknown): value is LatticeKnowledgeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === KNOWLEDGE_LATTICE_RECORD_VERSION &&
    isKnowledgeRecordId(candidate['recordId']) &&
    isKnowledgeArtifact(candidate['artifact']) &&
    isKnowledgeScopeDeclaration(candidate['scope']) &&
    Array.isArray(candidate['evidenceRefs']) &&
    candidate['evidenceRefs'].length > 0 &&
    isKnowledgeValidationState(
      (candidate['validation'] as { state?: unknown } | undefined)?.['state'],
    ) &&
    Array.isArray(candidate['promotions'])
  );
}

/** View helper: the tier of the record (the C006 vocabulary). */
export function tierOf(record: LatticeKnowledgeRecord): KnowledgeTier {
  return record.artifact.tier;
}

/** View helper: does the record carry granted reuse rights? */
export function hasGrantedRights(record: LatticeKnowledgeRecord): boolean {
  return record.rights !== null && record.rights.granted;
}

/** The reusable tiers (patches may only be cut from these). */
export const REUSABLE_KNOWLEDGE_TIERS = Object.freeze([
  'scoped-reusable-knowledge',
  'candidate-domain-rule',
  'verified-domain-constraint',
] as const);
export type ReusableKnowledgeTier = (typeof REUSABLE_KNOWLEDGE_TIERS)[number];

export function isReusableKnowledgeTier(value: unknown): value is ReusableKnowledgeTier {
  return (
    typeof value === 'string' && (REUSABLE_KNOWLEDGE_TIERS as readonly string[]).includes(value)
  );
}
