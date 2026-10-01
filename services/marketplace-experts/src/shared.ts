/**
 * Shared expert-marketplace view types, guards, closed vocabularies and
 * the INJECTED evidence-store contracts (Work Order A031; requirements
 * R7/R8 gate consumption, R29, R31, R32, R34, R48; architecture-lock
 * rules 6, 9, 11, 17, 18, 23).
 *
 * @arena/marketplace-experts-fabric is a SERVICE that references the REAL
 * sibling domain protocols by their PUBLIC types — @arena/expert-registry
 * (A006 ExpertProfile), @arena/expert-qualification (A007 cards, claims,
 * qualification records), @arena/certification (A023 CertificationRecord)
 * and @arena/body-registry (A024 ReleaseRecord) — and resolves every
 * cross-service reference through INJECTED, digest-addressed stores
 * (spec/service-boundaries.md: no service reaches into another service's
 * private storage; services communicate through immutable refs and typed
 * query APIs). The service therefore NEVER imports another service's
 * internals (boundary rule B2) and never mutates sibling state.
 *
 * COMMERCIAL LISTING IS DATA, NEVER AUTHORIZATION (lock rule 9): a
 * marketplace listing records commercial availability of a QUALIFIED
 * expert; it never grants, implies or records an authority claim, a license or
 * an entitlement (R46 — professional qualification inference is prevented
 * by gating on A007 qualification EVIDENCE, not on substrate properties).
 *
 * Determinism: every timestamp is an injected fixed constant; constructors
 * never read clocks; digests are sha256 over canonical JSON (protocol-core).
 */

import type { Brand } from '@arena/protocol-core';
import type { ExpertProfile } from '@arena/expert-registry';
import type {
  CompetencyClaim,
  QualificationRecord,
  QualifiedExpertCard,
} from '@arena/expert-qualification';
import type { CertificationRecord as CertificationRecordImpl } from '@arena/certification';
import type { ReleaseRecord as ReleaseRecordImpl } from '@arena/body-registry';
import { MARKETPLACE_EXPERTS_ERROR_CODES, MarketplaceExpertsError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the sibling packages' constants they
// mirror (character-for-character; A007/A006 house pattern).
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) — identical constant across Arena packages. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const MARKETPLACE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Canonical ms-precision UTC timestamps — ordering is total and timezone-free. */
export const MARKETPLACE_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
/** Tenant scopes (lock rule 11) — mirrors A006/A007's tenant pattern. */
export const TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
/** ISO 4217 alpha-3 currency codes (commercial metadata, R48). */
export const CURRENCY_PATTERN_SOURCE = '^[A-Z]{3}$';
/** ISO 3166-1 alpha-2 country codes — mirrors A006's jurisdiction pattern. */
export const COUNTRY_CODE_PATTERN_SOURCE = '^[A-Z]{2}$';
/** ISO 3166-2 subdivision codes. */
export const REGION_CODE_PATTERN_SOURCE = '^[A-Z0-9]{1,3}$';
/** UTC time-of-day for availability windows — mirrors A006/A007's pattern. */
export const TIME_OF_DAY_PATTERN_SOURCE = '^([01]\\d|2[0-3]):[0-5]\\d$';
/** Calendar dates for one-time availability windows. */
export const CALENDAR_DATE_PATTERN_SOURCE = '^\\d{4}-\\d{2}-\\d{2}$';
/** Capability-graph node ids — mirrors A006's view pattern. */
export const CAPABILITY_NODE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';
/** Neutral customer locators (PII-minimized marketplace participant ids). */
export const NEUTRAL_CUSTOMER_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,63}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const MARKETPLACE_ID_PATTERN = new RegExp(MARKETPLACE_ID_PATTERN_SOURCE);
const MARKETPLACE_TIMESTAMP_PATTERN = new RegExp(MARKETPLACE_TIMESTAMP_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);
const TENANT_PATTERN = new RegExp(TENANT_PATTERN_SOURCE);
const CURRENCY_PATTERN = new RegExp(CURRENCY_PATTERN_SOURCE);
const COUNTRY_CODE_PATTERN = new RegExp(COUNTRY_CODE_PATTERN_SOURCE);
const REGION_CODE_PATTERN = new RegExp(REGION_CODE_PATTERN_SOURCE);
const TIME_OF_DAY_PATTERN = new RegExp(TIME_OF_DAY_PATTERN_SOURCE);
const CALENDAR_DATE_PATTERN = new RegExp(CALENDAR_DATE_PATTERN_SOURCE);
const CAPABILITY_NODE_ID_PATTERN = new RegExp(CAPABILITY_NODE_ID_PATTERN_SOURCE);
const NEUTRAL_CUSTOMER_PATTERN = new RegExp(NEUTRAL_CUSTOMER_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'MarketplaceExpertsContentDigest'>;
export type MarketplaceId = Brand<string, 'MarketplaceExpertsId'>;
export type MarketplaceTimestamp = Brand<string, 'MarketplaceExpertsTimestamp'>;
export type NeutralText = Brand<string, 'MarketplaceExpertsNeutralText'>;
export type TenantScope = Brand<string, 'MarketplaceExpertsTenantScope'>;
export type CurrencyCode = Brand<string, 'MarketplaceExpertsCurrencyCode'>;
export type NeutralCustomerId = Brand<string, 'MarketplaceExpertsNeutralCustomerId'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isMarketplaceId(value: unknown): value is MarketplaceId {
  return typeof value === 'string' && MARKETPLACE_ID_PATTERN.test(value);
}

export function isMarketplaceTimestamp(value: unknown): value is MarketplaceTimestamp {
  return typeof value === 'string' && MARKETPLACE_TIMESTAMP_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function isTenantScope(value: unknown): value is TenantScope {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value);
}

export function isCountryCode(value: unknown): value is string {
  return typeof value === 'string' && COUNTRY_CODE_PATTERN.test(value);
}

export function isRegionCode(value: unknown): value is string {
  return typeof value === 'string' && REGION_CODE_PATTERN.test(value);
}

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && TIME_OF_DAY_PATTERN.test(value);
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && CALENDAR_DATE_PATTERN.test(value);
}

export function isCapabilityNodeId(value: unknown): value is string {
  return typeof value === 'string' && CAPABILITY_NODE_ID_PATTERN.test(value);
}

export function isNeutralCustomerId(value: unknown): value is NeutralCustomerId {
  return typeof value === 'string' && NEUTRAL_CUSTOMER_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Strict parsers (throwing) — the house discipline of typed construction
// ---------------------------------------------------------------------------

export function toContentDigest(value: unknown, field: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_DIGEST, {
      message: `${field} requires a 64-hex sha256 content digest`,
      details: { field, pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toMarketplaceId(value: unknown, field: string): MarketplaceId {
  if (!isMarketplaceId(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field} must match ${MARKETPLACE_ID_PATTERN_SOURCE}`,
      details: { field, pattern: MARKETPLACE_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toMarketplaceTimestamp(value: unknown, field: string): MarketplaceTimestamp {
  if (!isMarketplaceTimestamp(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field} requires an ms-precision UTC timestamp (YYYY-MM-DDTHH:MM:SS.sssZ)`,
      details: { field, pattern: MARKETPLACE_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: unknown, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TEXT, {
      message: `${field} requires neutral text (printable ASCII, 1-4096 chars)`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toTenantScope(value: unknown, field: string): TenantScope {
  if (!isTenantScope(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field} requires a tenant scope matching ${TENANT_PATTERN_SOURCE}`,
      details: { field, pattern: TENANT_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCurrencyCode(value: unknown, field: string): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS, {
      message: `${field} requires an ISO 4217 alpha-3 currency code`,
      details: { field, pattern: CURRENCY_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralCustomerId(value: unknown, field: string): NeutralCustomerId {
  if (!isNeutralCustomerId(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field} must match ${NEUTRAL_CUSTOMER_PATTERN_SOURCE}`,
      details: { field, pattern: NEUTRAL_CUSTOMER_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Require a non-negative safe integer (minor-unit money amounts). */
export function toNonNegativeInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS, {
      message: `${field} requires a non-negative safe integer`,
      details: { field },
    });
  }
  return value;
}

/** Require a POSITIVE safe integer (durations, notice windows). */
export function toPositiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS, {
      message: `${field} requires a positive safe integer`,
      details: { field },
    });
  }
  return value;
}

/** Deep-freeze helper (the A006/A007 house discipline — records are frozen). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Closed commercial vocabularies (R48 — versioned commercial metadata)
// ---------------------------------------------------------------------------

/** Listing lifecycle: DRAFT → LISTED → UNLISTED → LISTED → DELISTED (terminal). */
export const LISTING_STATUSES = Object.freeze([
  'draft',
  'listed',
  'unlisted',
  'delisted',
] as const);
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export const LISTING_TERMINAL_STATUSES = Object.freeze(['delisted'] as const);
export type TerminalListingStatus = (typeof LISTING_TERMINAL_STATUSES)[number];

/** The closed listing-transition vocabulary (append-only status events). */
export const LISTING_TRANSITIONS = Object.freeze([
  'publish',
  'unlist',
  'relist',
  'delist',
] as const);
export type ListingTransition = (typeof LISTING_TRANSITIONS)[number];

export function isListingStatus(value: unknown): value is ListingStatus {
  return (
    typeof value === 'string' && (LISTING_STATUSES as readonly string[]).includes(value)
  );
}

export function isListingTransition(value: unknown): value is ListingTransition {
  return (
    typeof value === 'string' && (LISTING_TRANSITIONS as readonly string[]).includes(value)
  );
}

/** Commercial offer kinds (closed vocabulary — R31 expert-side products). */
export const OFFER_KINDS = Object.freeze([
  'consulting-session',
  'code-review',
  'expert-observation',
  'capability-development',
  'body-backed-service',
] as const);
export type OfferKind = (typeof OFFER_KINDS)[number];

/** Rate units (closed vocabulary). */
export const RATE_UNITS = Object.freeze([
  'per-hour',
  'per-session',
  'per-task',
  'per-day',
  'fixed',
] as const);
export type RateUnit = (typeof RATE_UNITS)[number];

/** Offer lifecycle: ACTIVE → WITHDRAWN (terminal). */
export const OFFER_STATUSES = Object.freeze(['active', 'withdrawn'] as const);
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export function isOfferKind(value: unknown): value is OfferKind {
  return typeof value === 'string' && (OFFER_KINDS as readonly string[]).includes(value);
}

export function isRateUnit(value: unknown): value is RateUnit {
  return typeof value === 'string' && (RATE_UNITS as readonly string[]).includes(value);
}

export function isOfferStatus(value: unknown): value is OfferStatus {
  return typeof value === 'string' && (OFFER_STATUSES as readonly string[]).includes(value);
}

/** Engagement lifecycle (append-only transitions; three terminal states). */
export const ENGAGEMENT_STATUSES = Object.freeze([
  'requested',
  'accepted',
  'declined',
  'cancelled',
  'completed',
] as const);
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];
export const ENGAGEMENT_TERMINAL_STATUSES = Object.freeze([
  'declined',
  'cancelled',
  'completed',
] as const);
export type TerminalEngagementStatus = (typeof ENGAGEMENT_TERMINAL_STATUSES)[number];

/** The closed engagement-transition vocabulary. */
export const ENGAGEMENT_TRANSITIONS = Object.freeze([
  'accept',
  'decline',
  'cancel',
  'complete',
] as const);
export type EngagementTransition = (typeof ENGAGEMENT_TRANSITIONS)[number];

export function isEngagementStatus(value: unknown): value is EngagementStatus {
  return (
    typeof value === 'string' && (ENGAGEMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function isEngagementTransition(value: unknown): value is EngagementTransition {
  return (
    typeof value === 'string' &&
    (ENGAGEMENT_TRANSITIONS as readonly string[]).includes(value)
  );
}

/** Review ratings — a CLOSED integer vocabulary (R32 measurement discipline). */
export const REVIEW_RATINGS = Object.freeze([1, 2, 3, 4, 5] as const);
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/** Review verdicts derived from ratings (closed vocabulary). */
export const REVIEW_VERDICTS = Object.freeze(['positive', 'neutral', 'negative'] as const);
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export function isReviewRating(value: unknown): value is ReviewRating {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (REVIEW_RATINGS as readonly number[]).includes(value)
  );
}

export function isReviewVerdict(value: unknown): value is ReviewVerdict {
  return (
    typeof value === 'string' && (REVIEW_VERDICTS as readonly string[]).includes(value)
  );
}

/** The derived verdict for one rating (ratings 1-2 negative, 3 neutral, 4-5 positive). */
export function verdictForRating(rating: ReviewRating): ReviewVerdict {
  return rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';
}

// ---------------------------------------------------------------------------
// Money + terms views (R48 — versioned commercial metadata)
// ---------------------------------------------------------------------------

/** A commercial rate: integer minor units in an ISO 4217 currency, per unit. */
export interface RateView {
  readonly currency: CurrencyCode;
  /** Non-negative integer amount in MINOR units (cents etc.). */
  readonly amountMinor: number;
  readonly unit: RateUnit;
}

/** Availability windows (structurally compatible with A006/A007 views). */
export interface AvailabilityWindowView {
  readonly recurrence: string;
  readonly dayOfWeek?: number;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly date?: string;
}

export function isAvailabilityWindow(value: unknown): value is AvailabilityWindowView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['recurrence'] !== 'string') return false;
  if (!isTimeOfDay(candidate['startUtc']) || !isTimeOfDay(candidate['endUtc'])) return false;
  if (candidate['startUtc'] === candidate['endUtc']) return false;
  if (candidate['startUtc'] > candidate['endUtc']) return false;
  if (candidate['dayOfWeek'] !== undefined) {
    if (
      typeof candidate['dayOfWeek'] !== 'number' ||
      !Number.isInteger(candidate['dayOfWeek']) ||
      candidate['dayOfWeek'] < 1 ||
      candidate['dayOfWeek'] > 7
    ) {
      return false;
    }
  }
  if (candidate['date'] !== undefined && !isCalendarDate(candidate['date'])) return false;
  return true;
}

/** Jurisdictions (structurally compatible with A006/A007 views). */
export interface JurisdictionView {
  readonly country: string;
  readonly region?: string;
}

export function isJurisdiction(value: unknown): value is JurisdictionView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isCountryCode(candidate['country'])) return false;
  if (candidate['region'] !== undefined && !isRegionCode(candidate['region'])) return false;
  return true;
}

/** A capability-graph node reference (structurally compatible with A007 views). */
export interface CapabilityNodeRefView {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export function isCapabilityNodeRef(value: unknown): value is CapabilityNodeRefView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['kind'] === 'string' &&
    isCapabilityNodeId(candidate['id']) &&
    typeof candidate['version'] === 'string' &&
    isContentDigest(candidate['digest'])
  );
}

// ---------------------------------------------------------------------------
// INJECTED evidence stores (service-boundary law: immutable refs, typed
// query APIs — never another service's private storage)
// ---------------------------------------------------------------------------

/**
 * The digest-addressed read surface over expert records owned by the
 * sibling protocols. The marketplace NEVER constructs or mutates these
 * records; it resolves and verifies them (fail-closed on absence).
 */
export interface MarketplaceExpertRecordStore {
  /** Resolve an @arena/expert-registry ExpertProfile by content digest. */
  getExpertProfile(digest: string): Promise<ExpertProfile | undefined>;
  /** Resolve an @arena/expert-qualification QualifiedExpertCard by digest. */
  getQualifiedExpertCard(digest: string): Promise<QualifiedExpertCard | undefined>;
  /** Resolve an @arena/expert-qualification CompetencyClaim by digest. */
  getCompetencyClaim(digest: string): Promise<CompetencyClaim | undefined>;
  /** Resolve an @arena/expert-qualification QualificationRecord by digest. */
  getQualificationRecord(digest: string): Promise<QualificationRecord | undefined>;
}

/**
 * The A023 certification-record VIEW (cross-protocol reference — the
 * A007 shared.ts pattern: a validated plain-string view STRUCTURALLY
 * COMPATIBLE with @arena/certification's CertificationRecord, so real
 * records pass through unchanged; the marketplace reads only the
 * digest/verdict/grantedLevel projection its gate needs).
 */
export interface CertificationRecordView {
  readonly digest: string;
  readonly verdict: string;
  readonly grantedLevel: string | null;
}

/**
 * The A024 release-gate-evidence VIEW (structurally compatible with
 * @arena/body-registry's ReleaseGateEvidence — see above).
 */
export interface ReleaseGateEvidenceView {
  readonly certificationRefs: readonly string[];
}

/**
 * The A024 release-record VIEW (structurally compatible with
 * @arena/body-registry's ReleaseRecord — see above).
 */
export interface ReleaseRecordView {
  readonly digest: string;
  readonly kind: string;
  readonly channel: string | null;
  readonly gate: ReleaseGateEvidenceView | null;
}

// Compile-time structural-compatibility anchors (type-only imports —
// erased at runtime; they PROVE real A023/A024 records satisfy the views
// and keep this package's dependency on the merged A023/A024 surfaces
// machine-checked):
export type CertificationRecordSatisfiesView = CertificationRecordImpl extends CertificationRecordView
  ? true
  : never;
export type ReleaseRecordSatisfiesView = ReleaseRecordImpl extends ReleaseRecordView
  ? true
  : never;

/** The digest-addressed read surface over A024 release records. */
export interface MarketplaceReleaseRecordStore {
  /** Resolve an A024 release record (view) by content digest. */
  getReleaseRecord(digest: string): Promise<ReleaseRecordView | undefined>;
}

/** The digest-addressed read surface over A023 certification records. */
export interface MarketplaceCertificationRecordStore {
  /** Resolve an A023 certification record (view) by content digest. */
  getCertificationRecord(digest: string): Promise<CertificationRecordView | undefined>;
}

/** The fail-closed NULL store: every resolution is absent (R41 discipline). */
export class AbsentExpertRecordStore implements MarketplaceExpertRecordStore {
  async getExpertProfile(_digest?: string): Promise<ExpertProfile | undefined> {
    return undefined;
  }
  async getQualifiedExpertCard(_digest?: string): Promise<QualifiedExpertCard | undefined> {
    return undefined;
  }
  async getCompetencyClaim(_digest?: string): Promise<CompetencyClaim | undefined> {
    return undefined;
  }
  async getQualificationRecord(_digest?: string): Promise<QualificationRecord | undefined> {
    return undefined;
  }
}

/** The fail-closed NULL release store. */
export class AbsentReleaseRecordStore implements MarketplaceReleaseRecordStore {
  async getReleaseRecord(_digest?: string): Promise<ReleaseRecordView | undefined> {
    return undefined;
  }
}

/** The fail-closed NULL certification store. */
export class AbsentCertificationRecordStore implements MarketplaceCertificationRecordStore {
  async getCertificationRecord(_digest?: string): Promise<CertificationRecordView | undefined> {
    return undefined;
  }
}
