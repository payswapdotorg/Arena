/**
 * CompetencyClaim — an expert's claim on a capability/skill node ref with
 * a typed proficiency level and the evidence set backing it (Work Order
 * A007; requirement R7; docs/architecture.md §8 "competencies").
 *
 * Content-addressed and IMMUTABLE: same claim ⇒ same digest; deep-frozen;
 * no mutation API. The capability ref is capability-graph shaped (the
 * A006 view convention) and restricted to the competency node kinds; the
 * proficiency vocabulary is A006's closed five-member enum. Claims are
 * tenant-scoped (lock rule 11) because an expert works inside a tenant —
 * the matching fabric fails closed on cross-tenant reads.
 *
 * Re-claiming (a new proficiency, a new evidence set) APPENDS a new claim
 * that may supersede a prior one by digest (`supersedes`): the prior claim
 * is never edited and remains addressable for audit (lock rule 6). The
 * claim REQUIRES at least one evidence digest and rejects duplicates —
 * an evidence-free proficiency claim is structurally not a claim (R7).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import {
  COMPETENCY_NODE_KINDS,
  deepFreeze,
  expectFields,
  isContentDigest,
  isExpertQualificationTimestamp,
  isNeutralExpertId,
  isProficiencyLevel,
  isTenantScope,
  toCapabilityNodeRefView,
  toContentDigest,
  toExpertQualificationTimestamp,
  toNeutralExpertId,
  toProficiencyLevel,
  toTenantScope,
} from './shared.js';
import type {
  CapabilityNodeRefView,
  ContentDigest,
  NeutralExpertId,
  ProficiencyLevel,
  TenantScope,
} from './shared.js';

/** Wire version of the competency-claim record shape. */
export const COMPETENCY_CLAIM_VERSION = 1 as const;

/** Stable field list for the claim view (tests + contracts mirror it). */
export const COMPETENCY_CLAIM_FIELDS = Object.freeze([
  'claimVersion',
  'expertId',
  'tenant',
  'capability',
  'proficiency',
  'evidence',
  'declaredAt',
  'supersedes',
  'digest',
] as const) as readonly string[];

/** The digest-free view — exactly what the claim digest commits to. */
export interface CompetencyClaimView {
  readonly claimVersion: typeof COMPETENCY_CLAIM_VERSION;
  /** The claiming expert's neutral id (A006-shaped expert id). */
  readonly expertId: NeutralExpertId;
  /** The tenant the claiming expert works in (lock rule 11). */
  readonly tenant: TenantScope;
  /** The claimed capability/skill node ref (content-addressed matching). */
  readonly capability: CapabilityNodeRefView;
  /** The claimed proficiency (data, not a certification claim). */
  readonly proficiency: ProficiencyLevel;
  /** The evidence digests backing the claim (>= 1, unique, append-only). */
  readonly evidence: readonly ContentDigest[];
  /** When the claim was declared (ms-precision UTC). */
  readonly declaredAt: string;
  /** Digest of the claim this one supersedes (append-only; optional). */
  readonly supersedes?: ContentDigest;
}

/** A frozen, content-addressed competency claim: view + digest. */
export interface CompetencyClaim extends CompetencyClaimView {
  readonly digest: ContentDigest;
}

export interface CreateCompetencyClaimInput {
  readonly expertId: string;
  readonly tenant: string;
  readonly capability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly proficiency: string;
  readonly evidence: readonly string[];
  readonly declaredAt: string;
  readonly supersedes?: string;
}

/** Structural (non-throwing) check for the digest-free view. */
export function isCompetencyClaimView(value: unknown): value is CompetencyClaimView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['claimVersion'] !== COMPETENCY_CLAIM_VERSION ||
    !isNeutralExpertId(candidate['expertId']) ||
    !isTenantScope(candidate['tenant']) ||
    !isProficiencyLevel(candidate['proficiency']) ||
    !isExpertQualificationTimestamp(candidate['declaredAt'])
  ) {
    return false;
  }
  const capability = candidate['capability'];
  if (
    typeof capability !== 'object' ||
    capability === null ||
    !COMPETENCY_NODE_KINDS.includes(
      (capability as Record<string, unknown>)['kind'] as (typeof COMPETENCY_NODE_KINDS)[number],
    )
  ) {
    return false;
  }
  const evidence = candidate['evidence'];
  if (
    !Array.isArray(evidence) ||
    evidence.length === 0 ||
    !evidence.every((digest) => isContentDigest(digest))
  ) {
    return false;
  }
  if (candidate['supersedes'] !== undefined && !isContentDigest(candidate['supersedes'])) {
    return false;
  }
  return true;
}

/** Structural (non-throwing) check for the full claim (view + digest). */
export function isCompetencyClaim(value: unknown): value is CompetencyClaim {
  if (!isCompetencyClaimView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed competency claim.
 * Rejects unknown proficiency levels, non-competency capability node
 * kinds, empty/duplicate evidence lists, malformed timestamps/tenants and
 * unknown fields — all with typed ExpertQualificationErrors.
 */
export async function createCompetencyClaim(
  input: CreateCompetencyClaimInput,
): Promise<CompetencyClaim> {
  const record = expectFields(
    input,
    ['expertId', 'tenant', 'capability', 'proficiency', 'evidence', 'declaredAt'],
    ['supersedes'],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_CLAIM,
    'competency claim',
  );

  const expertId = toNeutralExpertId(
    typeof record['expertId'] === 'string' ? record['expertId'] : '',
    'competency claim expertId',
  );
  const tenant = toTenantScope(
    typeof record['tenant'] === 'string' ? record['tenant'] : '',
    'competency claim tenant',
  );
  const capability = toCapabilityNodeRefView(
    record['capability'] as {
      kind: string;
      id: string;
      version: string;
      digest: string;
    },
    COMPETENCY_NODE_KINDS,
  );
  const proficiency = toProficiencyLevel(
    typeof record['proficiency'] === 'string' ? record['proficiency'] : '',
    'competency claim proficiency',
  );

  if (!Array.isArray(record['evidence']) || record['evidence'].length === 0) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_CLAIM, {
      message:
        'a competency claim requires at least one digest-addressed evidence ref (an evidence-free proficiency claim is not a claim — R7)',
      details: { field: 'evidence' },
    });
  }
  const evidence = Object.freeze(
    (record['evidence'] as readonly string[]).map((digest) =>
      toContentDigest(digest, 'competency claim evidence'),
    ),
  );
  const seen = new Set<string>();
  for (const digest of evidence) {
    if (seen.has(digest)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_CLAIM, {
        message: `duplicate claim evidence digest: ${digest}`,
        details: { digest },
      });
    }
    seen.add(digest);
  }

  const declaredAt = toExpertQualificationTimestamp(
    typeof record['declaredAt'] === 'string' ? record['declaredAt'] : '',
    'competency claim declaredAt',
  );
  const supersedes =
    record['supersedes'] === undefined
      ? undefined
      : toContentDigest(
          typeof record['supersedes'] === 'string' ? record['supersedes'] : '',
          'competency claim supersedes',
        );

  const view: CompetencyClaimView = {
    claimVersion: COMPETENCY_CLAIM_VERSION,
    expertId,
    tenant,
    capability,
    proficiency,
    evidence,
    declaredAt,
    ...(supersedes !== undefined ? { supersedes } : {}),
  };

  const digest = toContentDigest(
    await digestCanonical(view),
    'competency claim digest',
  );
  return deepFreeze({ ...view, digest }) as CompetencyClaim;
}

/** The digest-free view of a claim (what the digest commits to). */
export function competencyClaimView(claim: CompetencyClaim): CompetencyClaimView {
  const { digest: _digest, ...view } = claim;
  return deepFreeze({ ...view }) as CompetencyClaimView;
}

/**
 * Recompute the claim digest over the digest-free view and compare.
 * Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeCompetencyClaimDigest(
  claim: CompetencyClaim,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isCompetencyClaim(claim)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_CLAIM, {
      message: 'claim digest recomputation requires a structurally valid competency claim',
    });
  }
  const actual = await digestCanonical(competencyClaimView(claim));
  if (actual !== claim.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `competency claim digest mismatch: expected ${expectedDigest ?? claim.digest}, got ${actual}`,
      details: {
        expertId: claim.expertId,
        capability: claim.capability.id,
        expected: expectedDigest ?? claim.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed claim digest');
}

/**
 * The claim identity key — "expertId@tenant::capability-key". The reference
 * pool keys supersession/lineage detection on this pair: two claims of the
 * same identity form an append-only supersession chain.
 */
export function competencyClaimIdentityKey(claim: CompetencyClaim): string {
  return `${claim.expertId}@${claim.tenant}::${claim.capability.kind}:${claim.capability.id}@${claim.capability.version}`;
}
