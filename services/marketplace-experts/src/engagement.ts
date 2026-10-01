/**
 * EngagementRecord — the booking record between one marketplace customer
 * and one expert's commercial offer (Work Order A031; requirements R31,
 * R34; architecture-lock rules 6, 11, 17).
 *
 * An engagement is tenant-scoped: its tenant MUST equal the listing's
 * tenant (cross-tenant engagement is denied loudly with TENANT_VIOLATION,
 * never silently matched). The lifecycle is append-only: the record is
 * created in the implicit 'requested' state and every subsequent state
 * change is an APPENDED EngagementTransitionRecord validated against a
 * closed transition table with terminal finality on declined/cancelled/
 * completed.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  MARKETPLACE_EXPERTS_ERROR_CODES,
  MarketplaceExpertsError,
} from './errors.js';
import {
  deepFreeze,
  isContentDigest,
  isEngagementTransition,
  isMarketplaceId,
  isMarketplaceTimestamp,
  isNeutralCustomerId,
  isNeutralText,
  isTenantScope,
  toContentDigest,
  toMarketplaceId,
  toMarketplaceTimestamp,
  toNeutralCustomerId,
  toNeutralText,
  toTenantScope,
} from './shared.js';
import type {
  ContentDigest,
  EngagementStatus,
  EngagementTransition,
  MarketplaceId,
  MarketplaceTimestamp,
  NeutralCustomerId,
  NeutralText,
  TenantScope,
} from './shared.js';

/** Wire version of the engagement record shape. */
export const ENGAGEMENT_RECORD_VERSION = 1 as const;

/** Wire version of the engagement-transition record shape. */
export const ENGAGEMENT_TRANSITION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The engagement record
// ---------------------------------------------------------------------------

/** Digest-free view of an engagement — exactly what the digest covers. */
export interface EngagementContentView {
  readonly recordVersion: typeof ENGAGEMENT_RECORD_VERSION;
  readonly engagementId: MarketplaceId;
  /** The tenant of the LISTING (scope lock — rule 11). */
  readonly tenant: TenantScope;
  /** The engaged listing (content digest). */
  readonly listingRef: string;
  /** The engaged offer (content digest). */
  readonly offerRef: string;
  readonly expertId: string;
  /** The PII-minimized customer locator (never a legal identity). */
  readonly customer: NeutralCustomerId;
  /** What the customer asked for (neutral text). */
  readonly scopeNote: NeutralText;
  /** When the engagement is scheduled to start (fixed, injected). */
  readonly scheduledFor: MarketplaceTimestamp;
  /** When the request was made (fixed, injected). */
  readonly requestedAt: MarketplaceTimestamp;
}

/** A frozen engagement record: the content view plus its sha256 digest. */
export interface EngagementRecord extends EngagementContentView {
  readonly digest: ContentDigest;
}

export interface CreateEngagementInput {
  readonly engagementId: string;
  readonly tenant: string;
  readonly listingRef: string;
  readonly offerRef: string;
  readonly expertId: string;
  readonly customer: string;
  readonly scopeNote: string;
  readonly scheduledFor: string;
  readonly requestedAt: string;
}

/** The engagement identity key — (tenant, engagementId). */
export function engagementIdentityKey(
  source: Pick<EngagementContentView, 'tenant' | 'engagementId'>,
): string {
  return `${source.tenant}/${source.engagementId}`;
}

export function isEngagement(value: unknown): value is EngagementRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== ENGAGEMENT_RECORD_VERSION) return false;
  if (!isMarketplaceId(candidate['engagementId'])) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (!isContentDigest(candidate['listingRef'])) return false;
  if (!isContentDigest(candidate['offerRef'])) return false;
  if (typeof candidate['expertId'] !== 'string' || candidate['expertId'].length === 0) {
    return false;
  }
  if (!isNeutralCustomerId(candidate['customer'])) return false;
  if (!isNeutralText(candidate['scopeNote'])) return false;
  if (!isMarketplaceTimestamp(candidate['scheduledFor'])) return false;
  if (!isMarketplaceTimestamp(candidate['requestedAt'])) return false;
  return isContentDigest(candidate['digest']);
}

/** Construct + validate + digest + freeze one engagement request. */
export async function createEngagement(
  input: CreateEngagementInput,
): Promise<EngagementRecord> {
  const engagementId = toMarketplaceId(input.engagementId, 'engagementId');
  const tenant = toTenantScope(input.tenant, 'tenant');
  const listingRef = toContentDigest(input.listingRef, 'listingRef');
  const offerRef = toContentDigest(input.offerRef, 'offerRef');
  if (typeof input.expertId !== 'string' || input.expertId.length === 0) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_IDENTITY, {
      message: 'expertId requires a non-empty string',
      details: { field: 'expertId' },
    });
  }
  const customer = toNeutralCustomerId(input.customer, 'customer');
  const scopeNote = toNeutralText(input.scopeNote, 'scopeNote');
  const scheduledFor = toMarketplaceTimestamp(input.scheduledFor, 'scheduledFor');
  const requestedAt = toMarketplaceTimestamp(input.requestedAt, 'requestedAt');
  if (scheduledFor < requestedAt) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
      message: 'engagement cannot be scheduled before it is requested',
      details: { scheduledFor, requestedAt },
    });
  }
  const view: EngagementContentView = {
    recordVersion: ENGAGEMENT_RECORD_VERSION,
    engagementId,
    tenant,
    listingRef,
    offerRef,
    expertId: input.expertId,
    customer,
    scopeNote,
    scheduledFor,
    requestedAt,
  };
  const digest = (await digestCanonical(view)) as ContentDigest;
  return deepFreeze({ ...view, digest });
}

// ---------------------------------------------------------------------------
// The closed transition table (terminal finality on three states)
// ---------------------------------------------------------------------------

/** The closed engagement transition table (from-statuses → to-status). */
export const ENGAGEMENT_TRANSITION_TABLE = {
  accept: { from: ['requested'], to: 'accepted' },
  decline: { from: ['requested'], to: 'declined' },
  cancel: { from: ['requested', 'accepted'], to: 'cancelled' },
  complete: { from: ['accepted'], to: 'completed' },
} as const satisfies Record<
  EngagementTransition,
  { readonly from: readonly EngagementStatus[]; readonly to: EngagementStatus }
>;

// ---------------------------------------------------------------------------
// EngagementTransitionRecord — the append-only lifecycle record
// ---------------------------------------------------------------------------

/** Digest-free view of one appended engagement transition. */
export interface EngagementTransitionRecordView {
  readonly recordVersion: typeof ENGAGEMENT_TRANSITION_RECORD_VERSION;
  /** The engagement this transition applies to (content digest). */
  readonly engagementRef: string;
  /** The tenant of the engagement (scope lock — rule 11). */
  readonly tenant: TenantScope;
  readonly transition: EngagementTransition;
  readonly at: MarketplaceTimestamp;
  readonly note?: NeutralText;
}

/** A frozen engagement-transition record: the view plus its sha256 digest. */
export interface EngagementTransitionRecord extends EngagementTransitionRecordView {
  readonly digest: ContentDigest;
}

export interface CreateEngagementTransitionInput {
  readonly engagementRef: string;
  readonly tenant: string;
  readonly transition: EngagementTransition;
  readonly at: string;
  readonly note?: string;
}

export function isEngagementTransitionRecord(value: unknown): value is EngagementTransitionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== ENGAGEMENT_TRANSITION_RECORD_VERSION) return false;
  if (!isContentDigest(candidate['engagementRef'])) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (!isEngagementTransition(candidate['transition'])) return false;
  if (typeof candidate['at'] !== 'string' || !isMarketplaceTimestamp(candidate['at'])) {
    return false;
  }
  if (candidate['note'] !== undefined && !isNeutralText(candidate['note'])) return false;
  return isContentDigest(candidate['digest']);
}

/** Construct + validate + digest + freeze one engagement transition. */
export async function createEngagementTransition(
  input: CreateEngagementTransitionInput,
): Promise<EngagementTransitionRecord> {
  const engagementRef = toContentDigest(input.engagementRef, 'engagementRef');
  const tenant = toTenantScope(input.tenant, 'tenant');
  if (!isEngagementTransition(input.transition)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
      message: 'transition must be one of accept|decline|cancel|complete',
      details: { transition: input.transition },
    });
  }
  const at = toMarketplaceTimestamp(input.at, 'at');
  const note = input.note === undefined ? undefined : toNeutralText(input.note, 'note');
  const view: EngagementTransitionRecordView = {
    recordVersion: ENGAGEMENT_TRANSITION_RECORD_VERSION,
    engagementRef,
    tenant,
    transition: input.transition,
    ...(note !== undefined ? { note } : {}),
    at,
  };
  const digest = (await digestCanonical(view)) as ContentDigest;
  return deepFreeze({ ...view, digest });
}
