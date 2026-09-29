/**
 * QualifiedExpertCard — the tenant-scoped expert view the matching fabric
 * evaluates (Work Order A007; requirement R8; docs/architecture.md §8
 * "identity, competencies, qualifications, evidence, task history,
 * reliability, availability and domain/jurisdiction"; architecture-lock
 * rules 11 and 23).
 *
 * The card is the matching-side VIEW of an expert (structurally compatible
 * with @arena/expert-registry profile data, consumed as DATA through the
 * shared views — never modified): the neutral expert id, the tenant scope,
 * the declared domain node refs, the typed jurisdictions and the typed
 * availability windows. Claims and qualification records attach to the
 * (expertId, tenant) pair — the matching fabric REQUIRES a card for every
 * claim expert so scope metadata is always well-defined (fail closed).
 *
 * The card deliberately carries NO quality aggregate and NO task history:
 * matching ranks by per-requirement qualification evidence only
 * (spec/quality-model.md — do not collapse expert quality into a single
 * global score).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isAvailabilityWindowView,
  isCapabilityNodeRefView,
  isContentDigest,
  isJurisdictionView,
  isNeutralExpertId,
  isTenantScope,
  toAvailabilityWindowView,
  toCapabilityNodeRefView,
  toContentDigest,
  toJurisdictionView,
  toNeutralExpertId,
  toTenantScope,
} from './shared.js';
import type {
  AvailabilityWindowView,
  CapabilityNodeRefView,
  ContentDigest,
  JurisdictionView,
  NeutralExpertId,
  TenantScope,
} from './shared.js';

/** Wire version of the expert-card record shape. */
export const QUALIFIED_EXPERT_VERSION = 1 as const;

/** Stable field list for the card (tests + contracts mirror it). */
export const QUALIFIED_EXPERT_FIELDS = Object.freeze([
  'cardVersion',
  'expertId',
  'tenant',
  'domainRefs',
  'jurisdictions',
  'availability',
  'digest',
] as const) as readonly string[];

/** The digest-free view — exactly what the card digest commits to. */
export interface QualifiedExpertCardView {
  readonly cardVersion: typeof QUALIFIED_EXPERT_VERSION;
  readonly expertId: NeutralExpertId;
  readonly tenant: TenantScope;
  /** The capability-graph DOMAIN nodes the expert's scope covers (0+). */
  readonly domainRefs: readonly CapabilityNodeRefView[];
  /** The typed jurisdictions the expert's scope covers (0+). */
  readonly jurisdictions: readonly JurisdictionView[];
  /** The typed availability windows (0+ — no availability declared). */
  readonly availability: readonly AvailabilityWindowView[];
}

/** A frozen, content-addressed expert card: view + digest. */
export interface QualifiedExpertCard extends QualifiedExpertCardView {
  readonly digest: ContentDigest;
}

export interface CreateQualifiedExpertCardInput {
  readonly expertId: string;
  readonly tenant: string;
  readonly domainRefs?: readonly {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  }[];
  readonly jurisdictions?: readonly { readonly country: string; readonly region?: string }[];
  readonly availability?: readonly {
    readonly recurrence: string;
    readonly dayOfWeek?: number;
    readonly startUtc: string;
    readonly endUtc: string;
    readonly date?: string;
  }[];
}

/** Structural (non-throwing) check for the digest-free view. */
export function isQualifiedExpertCardView(value: unknown): value is QualifiedExpertCardView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['cardVersion'] !== QUALIFIED_EXPERT_VERSION ||
    !isNeutralExpertId(candidate['expertId']) ||
    !isTenantScope(candidate['tenant'])
  ) {
    return false;
  }
  const domainRefs = candidate['domainRefs'];
  if (
    !Array.isArray(domainRefs) ||
    !domainRefs.every((ref) => isCapabilityNodeRefView(ref))
  ) {
    return false;
  }
  const jurisdictions = candidate['jurisdictions'];
  if (
    !Array.isArray(jurisdictions) ||
    !jurisdictions.every((entry) => isJurisdictionView(entry))
  ) {
    return false;
  }
  const availability = candidate['availability'];
  if (
    !Array.isArray(availability) ||
    !availability.every((window) => isAvailabilityWindowView(window))
  ) {
    return false;
  }
  return true;
}

/** Structural (non-throwing) check for the full card (view + digest). */
export function isQualifiedExpertCard(value: unknown): value is QualifiedExpertCard {
  if (!isQualifiedExpertCardView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed expert card.
 * Rejects non-domain domain refs, malformed jurisdictions/availability
 * windows and unknown fields — typed errors throughout.
 */
export async function createQualifiedExpertCard(
  input: CreateQualifiedExpertCardInput,
): Promise<QualifiedExpertCard> {
  const record = expectFields(
    input,
    ['expertId', 'tenant'],
    ['domainRefs', 'jurisdictions', 'availability'],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD,
    'qualified expert card',
  );

  const expertId = toNeutralExpertId(
    typeof record['expertId'] === 'string' ? record['expertId'] : '',
    'qualified expert card expertId',
  );
  const tenant = toTenantScope(
    typeof record['tenant'] === 'string' ? record['tenant'] : '',
    'qualified expert card tenant',
  );

  const domainRefs = Object.freeze(
    (Array.isArray(record['domainRefs'])
      ? (record['domainRefs'] as {
          kind: string;
          id: string;
          version: string;
          digest: string;
        }[])
      : []
    ).map((ref) => toCapabilityNodeRefView(ref, ['domain'])),
  );
  const jurisdictions = Object.freeze(
    (Array.isArray(record['jurisdictions'])
      ? (record['jurisdictions'] as { country: string; region?: string }[])
      : []
    ).map((entry) => toJurisdictionView(entry)),
  );
  const availability = Object.freeze(
    (Array.isArray(record['availability'])
      ? (record['availability'] as {
          recurrence: string;
          dayOfWeek?: number;
          startUtc: string;
          endUtc: string;
          date?: string;
        }[])
      : []
    ).map((window) => toAvailabilityWindowView(window)),
  );

  const view: QualifiedExpertCardView = {
    cardVersion: QUALIFIED_EXPERT_VERSION,
    expertId,
    tenant,
    domainRefs,
    jurisdictions,
    availability,
  };

  const digest = toContentDigest(
    await digestCanonical(view),
    'qualified expert card digest',
  );
  return deepFreeze({ ...view, digest }) as QualifiedExpertCard;
}

/** The digest-free view of a card (what the digest commits to). */
export function qualifiedExpertCardView(
  card: QualifiedExpertCard,
): QualifiedExpertCardView {
  const { digest: _digest, ...view } = card;
  return deepFreeze({ ...view }) as QualifiedExpertCardView;
}

/**
 * Recompute the card digest over the digest-free view and compare.
 * Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeQualifiedExpertCardDigest(
  card: QualifiedExpertCard,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isQualifiedExpertCard(card)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: 'card digest recomputation requires a structurally valid expert card',
    });
  }
  const actual = await digestCanonical(qualifiedExpertCardView(card));
  if (actual !== card.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `expert card digest mismatch: expected ${expectedDigest ?? card.digest}, got ${actual}`,
      details: {
        expertId: card.expertId,
        tenant: card.tenant,
        expected: expectedDigest ?? card.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed expert card digest');
}

/** The card identity key — "expertId@tenant" (registration discipline). */
export function qualifiedExpertCardIdentityKey(card: QualifiedExpertCard): string {
  return `${card.expertId}@${card.tenant}`;
}
