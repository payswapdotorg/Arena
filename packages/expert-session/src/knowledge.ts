/**
 * Knowledge-capture tiers (Work Order C006; spec
 * expert-environment-session.md EES1.0 "Knowledge capture" —
 * architecture-lock rules 31, 32).
 *
 * An expert can mark a statement as one of FOUR tiers:
 *   - temporary task-specific guidance;
 *   - scoped reusable knowledge;
 *   - candidate domain rule;
 *   - verified domain constraint.
 *
 * THE NO-SILENT-PROMOTION LAW (EES1.0): Arena must not silently promote
 * task-specific advice to universal knowledge. Enforced STRUCTURALLY:
 *   - artifacts are deep-frozen — the tier field of a constructed
 *     artifact can never be rewritten;
 *   - promotion is an EXPLICIT operation that produces a NEW artifact
 *     (append-only provenance chain: promotedFrom artifact id) carrying
 *     a fresh justification and a fresh consent/rights statement;
 *   - the verified-domain-constraint tier REQUIRES a validation
 *     reference — an unverified claim can never be constructed as
 *     verified;
 *   - reusable tiers REQUIRE an explicit consent/rights statement
 *     (lock rule 31: reuse requires explicit rights, provenance,
 *     validation and scope);
 *   - demotion is denied (TIER_PROMOTION_DENIED) — the tier lattice is
 *     monotonic and every step is a recorded decision.
 */

import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { ExpertSessionId, ExpertSessionTimestamp, KnowledgeArtifactId } from './shared.js';
import {
  isExpertSessionId,
  isKnowledgeArtifactId,
  newKnowledgeArtifactId,
  toKnowledgeArtifactId,
  toExpertSessionTimestamp,
} from './shared.js';

/** Wire version of the knowledge artifact shape. */
export const KNOWLEDGE_ARTIFACT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Tiers (ordered lattice)
// ---------------------------------------------------------------------------

export const KNOWLEDGE_TIERS = Object.freeze([
  'task-specific-guidance',
  'scoped-reusable-knowledge',
  'candidate-domain-rule',
  'verified-domain-constraint',
] as const);
export type KnowledgeTier = (typeof KNOWLEDGE_TIERS)[number];

export function isKnowledgeTier(value: unknown): value is KnowledgeTier {
  return typeof value === 'string' && (KNOWLEDGE_TIERS as readonly string[]).includes(value);
}

const TIER_RANK: Readonly<Record<KnowledgeTier, number>> = Object.freeze({
  'task-specific-guidance': 0,
  'scoped-reusable-knowledge': 1,
  'candidate-domain-rule': 2,
  'verified-domain-constraint': 3,
});

/** Tiers above task-specific guidance require explicit consent/rights. */
export function tierRequiresConsent(tier: KnowledgeTier): boolean {
  return tier !== 'task-specific-guidance';
}

// ---------------------------------------------------------------------------
// Consent / rights statement
// ---------------------------------------------------------------------------

/** Consent and rights statement for reusable learning (EES1.0 "Session completion"). */
export interface ConsentRightsStatement {
  /** Are reusable-learning rights granted for this statement? */
  readonly granted: boolean;
  /** The human-readable rights statement (required — never empty). */
  readonly statement: string;
}

function validateConsent(value: unknown): ConsentRightsStatement {
  if (typeof value !== 'object' || value === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
      message: 'consent/rights statement must be an object { granted, statement }',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['granted'] !== 'boolean') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
      message: 'consent.granted must be an explicit boolean',
    });
  }
  if (typeof candidate['statement'] !== 'string' || candidate['statement'].length === 0 || candidate['statement'].length > 4096) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
      message: 'consent.statement must be a non-empty string (<= 4096 chars)',
    });
  }
  return Object.freeze({ granted: candidate['granted'], statement: candidate['statement'] });
}

// ---------------------------------------------------------------------------
// Knowledge artifact
// ---------------------------------------------------------------------------

export interface KnowledgeArtifact {
  readonly artifactVersion: typeof KNOWLEDGE_ARTIFACT_VERSION;
  readonly artifactId: KnowledgeArtifactId;
  readonly tier: KnowledgeTier;
  /** The knowledge statement itself. */
  readonly statement: string;
  /** Scope the statement is claimed within (mandatory for every tier). */
  readonly scope: string;
  /** Provenance: which session / expert produced it and when. */
  readonly provenance: {
    readonly sessionId: ExpertSessionId;
    readonly expertRef: string | null;
    readonly recordedAt: ExpertSessionTimestamp;
  };
  /**
   * Validation reference — REQUIRED for the verified-domain-constraint
   * tier (an unverified claim can never be constructed as verified).
   */
  readonly validationRef: string | null;
  /** Consent / rights statement (required for every reusable tier). */
  readonly consent: ConsentRightsStatement | null;
  /** Append-only promotion chain (present only on promoted artifacts). */
  readonly promotedFrom: KnowledgeArtifactId | null;
}

export interface CreateKnowledgeArtifactInput {
  readonly tier: string;
  readonly statement: string;
  readonly scope: string;
  readonly sessionId: string;
  readonly expertRef?: string;
  readonly now: number | string | Date;
  readonly validationRef?: string;
  readonly consent?: { granted: boolean; statement: string };
  readonly artifactId?: string;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
      message: `${field} must be a non-empty string (<= 4096 chars): ${JSON.stringify(value)}`,
    });
  }
  return value;
}

/** Create a validated knowledge artifact (the no-silent-promotion gate). */
export function createKnowledgeArtifact(input: CreateKnowledgeArtifactInput): KnowledgeArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
      message: 'knowledge artifact input must be an object',
    });
  }
  if (!isKnowledgeTier(input.tier)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
      message: `tier must be one of ${JSON.stringify([...KNOWLEDGE_TIERS])}: ${JSON.stringify(input.tier)}`,
    });
  }
  const tier = input.tier;
  requireNonEmpty(input.statement, 'statement');
  requireNonEmpty(input.scope, 'scope');
  if (!isExpertSessionId(input.sessionId)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
      message: `sessionId is invalid: ${JSON.stringify(input.sessionId)}`,
    });
  }
  if (tierRequiresConsent(tier)) {
    if (input.consent === undefined) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
        message: `tier '${tier}' requires an explicit consent/rights statement (architecture-lock rule 31)`,
        details: { tier },
      });
    }
    if (!input.consent.granted) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
        message: `tier '${tier}' requires granted consent — an ungranted rights statement cannot back reusable knowledge`,
        details: { tier },
      });
    }
  }
  if (tier === 'verified-domain-constraint') {
    if (typeof input.validationRef !== 'string' || input.validationRef.length === 0) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
        message: "tier 'verified-domain-constraint' requires a validationRef — unverified claims can never be constructed as verified",
        details: { tier },
      });
    }
  }

  const artifactId =
    input.artifactId === undefined ? newKnowledgeArtifactId() : toKnowledgeArtifactId(input.artifactId);
  const artifact: KnowledgeArtifact = Object.freeze({
    artifactVersion: KNOWLEDGE_ARTIFACT_VERSION,
    artifactId,
    tier,
    statement: input.statement,
    scope: input.scope,
    provenance: Object.freeze({
      sessionId: input.sessionId,
      expertRef: input.expertRef ?? null,
      recordedAt: toExpertSessionTimestamp(input.now),
    }),
    validationRef: input.validationRef ?? null,
    consent: input.consent === undefined ? null : validateConsent(input.consent),
    promotedFrom: null,
  });
  return artifact;
}

// ---------------------------------------------------------------------------
// EXPLICIT promotion (never silent)
// ---------------------------------------------------------------------------

export interface PromoteKnowledgeInput {
  /** The artifact being promoted (the original — never mutated). */
  readonly artifact: KnowledgeArtifact;
  /** The destination tier — must be STRICTLY higher in the lattice. */
  readonly toTier: string;
  /** Explicit, recorded justification for THIS promotion. */
  readonly justification: string;
  /** Fresh consent/rights statement for the promoted tier. */
  readonly consent: { granted: boolean; statement: string };
  /** Validation reference (required when promoting to verified-domain-constraint). */
  readonly validationRef?: string;
  readonly now: number | string | Date;
  readonly artifactId?: string;
}

export const TIER_PROMOTION_REASONS = Object.freeze([
  'promotion_ok',
  'promotion_not_upward',
  'promotion_same_tier',
  'promotion_requires_validation',
  'promotion_requires_consent',
] as const);
export type TierPromotionReason = (typeof TIER_PROMOTION_REASONS)[number];

/** Machine-readable promotion verdict (never a bare boolean). */
export interface TierPromotionCheck {
  readonly allowed: boolean;
  readonly reason: TierPromotionReason;
  readonly from: KnowledgeTier;
  readonly to: KnowledgeTier;
}

/** Verdict for a proposed tier promotion (pure — no mutation). */
export function checkTierPromotion(from: KnowledgeTier, to: KnowledgeTier): TierPromotionCheck {
  if (to === from) {
    return { allowed: false, reason: 'promotion_same_tier', from, to };
  }
  if (TIER_RANK[to] <= TIER_RANK[from]) {
    return { allowed: false, reason: 'promotion_not_upward', from, to };
  }
  return { allowed: true, reason: 'promotion_ok', from, to };
}

/**
 * Promote a knowledge artifact EXPLICITLY: produces a NEW append-only
 * artifact (promotedFrom chain), requires a recorded justification and
 * a fresh granted consent statement; promotion to
 * verified-domain-constraint requires a validationRef. Demotion and
 * same-tier re-issue are denied (TIER_PROMOTION_DENIED).
 */
export function promoteKnowledgeArtifact(input: PromoteKnowledgeInput): KnowledgeArtifact {
  if (!isKnowledgeTier(input.toTier)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TIER, {
      message: `destination tier is invalid: ${JSON.stringify(input.toTier)}`,
    });
  }
  const verdict = checkTierPromotion(input.artifact.tier, input.toTier);
  if (!verdict.allowed) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.TIER_PROMOTION_DENIED, {
      message: `tier promotion ${input.artifact.tier} -> ${input.toTier} denied (${verdict.reason})`,
      details: { reason: verdict.reason, from: verdict.from, to: verdict.to },
    });
  }
  if (typeof input.justification !== 'string' || input.justification.length === 0 || input.justification.length > 4096) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.TIER_PROMOTION_DENIED, {
      message: 'promotion requires a recorded justification (never silent)',
    });
  }
  const consent = validateConsent(input.consent);
  if (!consent.granted) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.TIER_PROMOTION_DENIED, {
      message: 'promotion requires a fresh GRANTED consent/rights statement',
    });
  }
  if (input.toTier === 'verified-domain-constraint') {
    if (typeof input.validationRef !== 'string' || input.validationRef.length === 0) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.TIER_PROMOTION_DENIED, {
        message: "promotion to 'verified-domain-constraint' requires a validationRef",
      });
    }
  }

  const artifactId =
    input.artifactId === undefined ? newKnowledgeArtifactId() : toKnowledgeArtifactId(input.artifactId);
  const promoted: KnowledgeArtifact = Object.freeze({
    artifactVersion: KNOWLEDGE_ARTIFACT_VERSION,
    artifactId,
    tier: input.toTier,
    statement: input.artifact.statement,
    scope: input.artifact.scope,
    provenance: Object.freeze({
      sessionId: input.artifact.provenance.sessionId,
      expertRef: input.artifact.provenance.expertRef,
      recordedAt: toExpertSessionTimestamp(input.now),
    }),
    validationRef: input.validationRef ?? input.artifact.validationRef,
    consent,
    promotedFrom: input.artifact.artifactId,
  });
  return promoted;
}

/** Structural guard for wire values claiming to be knowledge artifacts. */
export function isKnowledgeArtifact(value: unknown): value is KnowledgeArtifact {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['artifactVersion'] !== KNOWLEDGE_ARTIFACT_VERSION ||
    !isKnowledgeArtifactId(candidate['artifactId']) ||
    !isKnowledgeTier(candidate['tier'])
  ) {
    return false;
  }
  if (candidate['tier'] === 'verified-domain-constraint') {
    if (typeof candidate['validationRef'] !== 'string' || candidate['validationRef'].length === 0) return false;
  }
  if (candidate['promotedFrom'] !== null && !isKnowledgeArtifactId(candidate['promotedFrom'])) return false;
  return true;
}
