/**
 * Shared expert-qualification view types, guards and shape enforcement
 * (Work Order A007; requirements R7, R8; architecture-lock rules 6, 9, 11,
 * 23, 24; spec/quality-model.md expert-quality dimensions).
 *
 * @arena/expert-qualification is a DOMAIN package whose ONLY runtime
 * dependency is @arena/protocol-core (canonical JSON + sha256 digests,
 * envelopes, branded identifiers, correlation ids / idempotency keys,
 * SchemaRef, ProtocolError). Every cross-protocol object the qualification
 * protocol references is therefore defined HERE as a validated plain-string
 * VIEW type — the same pattern @arena/expert-registry uses (see its
 * shared.ts): the views are STRUCTURALLY COMPATIBLE with the owning
 * packages' types (plain strings accept branded strings), so a
 * capability-graph node ref from @arena/expert-registry's competency
 * records, an A013 VerificationRecord digest or an A012 EvaluationRecord
 * digest can be passed through these validators unchanged. Pattern
 * sources are duplicated from the owning packages' surfaces and mirrored
 * in the generated contracts, so the duplication cannot drift silently
 * (see contracts.parity.test.ts).
 *
 * A006 (@arena/expert-registry) is CONSUMED as profile DATA through these
 * views; this package never modifies it. A012/A013 records are referenced
 * by content digest — evidence carries the digest, never a live object.
 *
 * QUALIFICATION IS DATA, NEVER AUTHORIZATION (lock rule 9): nothing in
 * these shared types grants, implies or records a permission.
 */

import type { Brand } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import type { ExpertQualificationErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/expert-registry /
// @arena/protocol-core constants they mirror (character-for-character).
// Kept in sync with the generated contracts (contracts/expert-qualification)
// by contracts.parity.test.ts.
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) — identical constant across Arena packages. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const EXPERT_QUALIFICATION_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Neutral expert ids / locators (mirrors A006's expert-id charset). */
export const NEUTRAL_LOCATOR_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors A006/A010/A011/A012/A013)
 * — qualification ordering is total and timezone-free.
 */
export const EXPERT_QUALIFICATION_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Policy/claim/result version strings — semver without build metadata. */
export const EXPERT_QUALIFICATION_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
/** Tenant scopes (lock rule 11) — mirrors A006's tenant pattern. */
export const TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
/** Capability-graph node ids — mirrors A006's view pattern. */
export const CAPABILITY_NODE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';
/** ISO 3166-1 alpha-2 country codes — mirrors A006's jurisdiction pattern. */
export const COUNTRY_CODE_PATTERN_SOURCE = '^[A-Z]{2}$';
/** ISO 3166-2 subdivision codes — mirrors A006's region pattern. */
export const REGION_CODE_PATTERN_SOURCE = '^[A-Z0-9]{1,3}$';
/** UTC time-of-day for availability windows — mirrors A006's pattern. */
export const TIME_OF_DAY_PATTERN_SOURCE = '^([01]\\d|2[0-3]):[0-5]\\d$';
/** Calendar dates for one-time availability windows — mirrors A006's. */
export const CALENDAR_DATE_PATTERN_SOURCE = '^\\d{4}-\\d{2}-\\d{2}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const EXPERT_QUALIFICATION_ID_PATTERN = new RegExp(EXPERT_QUALIFICATION_ID_PATTERN_SOURCE);
const NEUTRAL_LOCATOR_PATTERN = new RegExp(NEUTRAL_LOCATOR_PATTERN_SOURCE);
const EXPERT_QUALIFICATION_TIMESTAMP_PATTERN = new RegExp(
  EXPERT_QUALIFICATION_TIMESTAMP_PATTERN_SOURCE,
);
const EXPERT_QUALIFICATION_VERSION_PATTERN = new RegExp(EXPERT_QUALIFICATION_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);
const TENANT_PATTERN = new RegExp(TENANT_PATTERN_SOURCE);
const CAPABILITY_NODE_ID_PATTERN = new RegExp(CAPABILITY_NODE_ID_PATTERN_SOURCE);
const COUNTRY_CODE_PATTERN = new RegExp(COUNTRY_CODE_PATTERN_SOURCE);
const REGION_CODE_PATTERN = new RegExp(REGION_CODE_PATTERN_SOURCE);
const TIME_OF_DAY_PATTERN = new RegExp(TIME_OF_DAY_PATTERN_SOURCE);
const CALENDAR_DATE_PATTERN = new RegExp(CALENDAR_DATE_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'ExpertQualificationContentDigest'>;
export type ExpertQualificationId = Brand<string, 'ExpertQualificationId'>;
export type ExpertQualificationTimestamp = Brand<string, 'ExpertQualificationTimestamp'>;
export type ExpertQualificationVersion = Brand<string, 'ExpertQualificationVersion'>;
export type NeutralText = Brand<string, 'ExpertQualificationNeutralText'>;
export type TenantScope = Brand<string, 'ExpertQualificationTenantScope'>;
export type NeutralExpertId = Brand<string, 'ExpertQualificationNeutralExpertId'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isExpertQualificationId(value: unknown): value is ExpertQualificationId {
  return typeof value === 'string' && EXPERT_QUALIFICATION_ID_PATTERN.test(value);
}

export function isNeutralExpertId(value: unknown): value is NeutralExpertId {
  return typeof value === 'string' && NEUTRAL_LOCATOR_PATTERN.test(value);
}

export function isExpertQualificationTimestamp(
  value: unknown,
): value is ExpertQualificationTimestamp {
  if (typeof value !== 'string' || !EXPERT_QUALIFICATION_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export function isExpertQualificationVersion(
  value: unknown,
): value is ExpertQualificationVersion {
  return typeof value === 'string' && EXPERT_QUALIFICATION_VERSION_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function isTenantScope(value: unknown): value is TenantScope {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toExpertQualificationId(
  value: string,
  context: string,
): ExpertQualificationId {
  if (!isExpertQualificationId(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid expert-qualification id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { field: context, pattern: EXPERT_QUALIFICATION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralExpertId(value: string, context: string): NeutralExpertId {
  if (!isNeutralExpertId(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid neutral expert id: ${JSON.stringify(value)} (neutral identifier charset — email/phone-shaped strings are rejected by construction)`,
      details: { field: context, pattern: NEUTRAL_LOCATOR_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toExpertQualificationTimestamp(
  value: string,
  field: string,
): ExpertQualificationTimestamp {
  if (!isExpertQualificationTimestamp(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid expert-qualification timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: EXPERT_QUALIFICATION_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toExpertQualificationVersion(
  value: string,
  field: string,
): ExpertQualificationVersion {
  if (!isExpertQualificationVersion(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid expert-qualification version: ${JSON.stringify(value)} (semver without build metadata required)`,
      details: { field, pattern: EXPERT_QUALIFICATION_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toTenantScope(value: string, field: string): TenantScope {
  if (!isTenantScope(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid tenant scope: ${JSON.stringify(value)} (lowercase kebab, 2-63 chars; the reserved global namespace is "public")`,
      details: { field, pattern: TENANT_PATTERN_SOURCE },
    });
  }
  return value;
}

/**
 * The reserved GLOBAL namespace for explicitly published tenant-independent
 * experts (mirrors A006's `public` convention — lock rule 11: the reserved
 * `public` namespace is the only globally readable scope).
 */
export const PUBLIC_TENANT = 'public' as const;

/**
 * True iff data owned by `ownerTenant` is visible to a reader acting in
 * `readerTenant` (lock rule 11; the same rule the A006 registry applies
 * to expert profiles — the matching fabric applies it to expert cards).
 */
export function isTenantVisible(ownerTenant: string, readerTenant: string): boolean {
  return ownerTenant === readerTenant || ownerTenant === PUBLIC_TENANT;
}

// ---------------------------------------------------------------------------
// Proficiency levels (mirror A006's closed vocabulary, EXACT parity)
// ---------------------------------------------------------------------------

/**
 * Typed proficiency levels (closed vocabulary, neutral wording). MUST equal
 * @arena/expert-registry's PROFICIENCY_LEVELS member-for-member — matching
 * thresholds are compared across the two surfaces. Mirrored in the
 * generated contracts so the duplication cannot drift (contracts.parity).
 */
export const PROFICIENCY_LEVELS = Object.freeze([
  'introductory',
  'working',
  'proficient',
  'advanced',
  'distinguished',
] as const);

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export function isProficiencyLevel(value: unknown): value is ProficiencyLevel {
  return (
    typeof value === 'string' &&
    (PROFICIENCY_LEVELS as readonly string[]).includes(value)
  );
}

/** Validate one proficiency level; throws INVALID_CLAIM otherwise. */
export function toProficiencyLevel(value: string, context: string): ProficiencyLevel {
  if (!isProficiencyLevel(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_CLAIM, {
      message: `${context}: unknown proficiency level: ${JSON.stringify(value)} (known: ${PROFICIENCY_LEVELS.join(', ')})`,
      details: { known: [...PROFICIENCY_LEVELS] },
    });
  }
  return value;
}

/**
 * Ordinal rank of a proficiency level (introductory=1 … distinguished=5).
 * The ONLY ordering in this package — used for threshold comparisons
 * (R8: proficiency thresholds). Pure data ordering, not a quality score.
 */
export const PROFICIENCY_RANK: Readonly<Record<ProficiencyLevel, number>> = Object.freeze({
  introductory: 1,
  working: 2,
  proficient: 3,
  advanced: 4,
  distinguished: 5,
});

/** True iff `level` meets or exceeds `threshold` (pure threshold check). */
export function proficiencyMeets(level: ProficiencyLevel, threshold: ProficiencyLevel): boolean {
  return (PROFICIENCY_RANK[level] ?? 0) >= (PROFICIENCY_RANK[threshold] ?? 0);
}

// ---------------------------------------------------------------------------
// CapabilityNodeRefView — a capability-graph node reference (A004 view)
// ---------------------------------------------------------------------------

/**
 * The node kinds a competency claim / match requirement may reference —
 * MUST equal @arena/expert-registry's COMPETENCY_NODE_KINDS endpoint subset
 * for competencies (§8 endpoint discipline). Mirrored in contracts.
 */
export const COMPETENCY_NODE_KINDS = Object.freeze([
  'capability',
  'sub-capability',
  'skill',
  'expert-competency',
] as const);

export type CompetencyNodeKind = (typeof COMPETENCY_NODE_KINDS)[number];

/** The graph's `domain` node kind — the endpoint for domain-scope refs. */
export const DOMAIN_NODE_KIND = 'domain' as const;

export function isCompetencyNodeKind(value: unknown): value is CompetencyNodeKind {
  return (
    typeof value === 'string' &&
    (COMPETENCY_NODE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A content-addressed reference to a Capability Graph node (structurally
 * @arena/capability-graph's CapabilityNodeRef and @arena/expert-registry's
 * CapabilityNodeRefView). Matching compares these refs EXACTLY
 * (kind:id@version#digest) — content-addressed matching, deterministic
 * by construction.
 */
export interface CapabilityNodeRefView {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export function isCapabilityNodeRefView(value: unknown): value is CapabilityNodeRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (isCompetencyNodeKind(candidate['kind']) || candidate['kind'] === DOMAIN_NODE_KIND) &&
    typeof candidate['id'] === 'string' &&
    CAPABILITY_NODE_ID_PATTERN.test(candidate['id']) &&
    isExpertQualificationVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Validate and freeze a capability-node reference, optionally constraining
 * the node kind to an allowed subset.
 */
export function toCapabilityNodeRefView(
  value: {
    kind: string;
    id: string;
    version: string;
    digest: string;
  },
  allowedKinds?: readonly string[],
): CapabilityNodeRefView {
  const kind = value.kind;
  const allowed = allowedKinds ?? [...COMPETENCY_NODE_KINDS, DOMAIN_NODE_KIND];
  if (!allowed.includes(kind)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REF, {
      message: `capability node kind ${JSON.stringify(kind)} is not allowed here (expected: ${allowed.join(', ')})`,
      details: { allowed: [...allowed] },
    });
  }
  if (typeof value.id !== 'string' || !CAPABILITY_NODE_ID_PATTERN.test(value.id)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REF, {
      message: `invalid capability node id: ${JSON.stringify(value.id)}`,
      details: { pattern: CAPABILITY_NODE_ID_PATTERN_SOURCE },
    });
  }
  if (!isExpertQualificationVersion(value.version)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REF, {
      message: `invalid capability node version: ${JSON.stringify(value.version)}`,
      details: { pattern: EXPERT_QUALIFICATION_VERSION_PATTERN_SOURCE },
    });
  }
  if (!isContentDigest(value.digest)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REF, {
      message: `invalid capability node digest: ${JSON.stringify(value.digest)}`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return Object.freeze({
    kind,
    id: value.id,
    version: value.version,
    digest: value.digest,
  });
}

/** Stable key for a capability node ref: `<kind>:<id>@<version>#<digest>`. */
export function capabilityNodeRefViewKey(ref: CapabilityNodeRefView): string {
  return `${ref.kind}:${ref.id}@${ref.version}#${ref.digest}`;
}

// ---------------------------------------------------------------------------
// CredentialRefView — professional credential reference (A006 view)
// ---------------------------------------------------------------------------

/**
 * Professional credential reference kinds — MUST equal
 * @arena/expert-registry's CREDENTIAL_KINDS member-for-member (credentials
 * referenced as qualification evidence stay structurally compatible with
 * A006 qualification records). Mirrored in the generated contracts.
 */
export const CREDENTIAL_KINDS = Object.freeze([
  'professional-license',
  'certification',
  'degree',
  'training-certificate',
  'credential-attestation',
  'external-credential',
] as const);

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export function isCredentialKind(value: unknown): value is CredentialKind {
  return (
    typeof value === 'string' &&
    (CREDENTIAL_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A credential reference: kind, neutral opaque reference and optional
 * issuing body (an organization, never a person) — structurally
 * @arena/expert-registry's CredentialRefView.
 */
export interface CredentialRefView {
  readonly kind: CredentialKind;
  readonly reference: string;
  readonly issuer?: string;
}

export function isCredentialRefView(value: unknown): value is CredentialRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCredentialKind(candidate['kind']) &&
    isNeutralExpertId(candidate['reference']) &&
    (candidate['issuer'] === undefined || typeof candidate['issuer'] === 'string')
  );
}

/** Validate and freeze a credential reference. */
export function toCredentialRefView(value: {
  kind: string;
  reference: string;
  issuer?: string;
}): CredentialRefView {
  if (!isCredentialKind(value.kind)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: `unknown credential kind: ${JSON.stringify(value.kind)} (known: ${CREDENTIAL_KINDS.join(', ')})`,
      details: { known: [...CREDENTIAL_KINDS] },
    });
  }
  if (!isNeutralExpertId(value.reference)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: `invalid credential reference: ${JSON.stringify(value.reference)} (neutral identifier charset — email/phone-shaped strings are rejected by construction)`,
      details: { pattern: NEUTRAL_LOCATOR_PATTERN_SOURCE },
    });
  }
  if (value.issuer !== undefined) {
    if (typeof value.issuer !== 'string' || value.issuer.length === 0) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
        message: `credential issuer, when present, must be a non-empty organization string: ${JSON.stringify(value.issuer)}`,
      });
    }
    if (value.issuer.length > 255) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
        message: 'credential issuer must be at most 255 characters',
      });
    }
  }
  return Object.freeze({
    kind: value.kind,
    reference: value.reference,
    ...(value.issuer !== undefined ? { issuer: value.issuer } : {}),
  });
}

// ---------------------------------------------------------------------------
// JurisdictionView — typed ISO 3166 jurisdiction (A006 view)
// ---------------------------------------------------------------------------

/**
 * A typed jurisdiction: an ISO 3166-1 alpha-2 country plus an OPTIONAL
 * ISO 3166-2 subdivision — structurally @arena/expert-registry's
 * JurisdictionView (with its wire version). Professional-scope metadata,
 * not personal location data (§8; lock rule 23).
 */
export interface JurisdictionView {
  readonly jurisdictionVersion: 1;
  readonly country: string;
  readonly region?: string;
}

export function isJurisdictionView(value: unknown): value is JurisdictionView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['jurisdictionVersion'] === 1 &&
    typeof candidate['country'] === 'string' &&
    COUNTRY_CODE_PATTERN.test(candidate['country']) &&
    (candidate['region'] === undefined ||
      (typeof candidate['region'] === 'string' && REGION_CODE_PATTERN.test(candidate['region'])))
  );
}

/** Validate and freeze a jurisdiction view. */
export function toJurisdictionView(value: {
  country: string;
  region?: string;
}): JurisdictionView {
  if (
    typeof value.country !== 'string' ||
    !COUNTRY_CODE_PATTERN.test(value.country)
  ) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: `invalid jurisdiction country: ${JSON.stringify(value.country)} (ISO 3166-1 alpha-2 required)`,
      details: { pattern: COUNTRY_CODE_PATTERN_SOURCE },
    });
  }
  if (
    value.region !== undefined &&
    (typeof value.region !== 'string' || !REGION_CODE_PATTERN.test(value.region))
  ) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: `invalid jurisdiction region: ${JSON.stringify(value.region)} (ISO 3166-2 subdivision required)`,
      details: { pattern: REGION_CODE_PATTERN_SOURCE },
    });
  }
  return Object.freeze({
    jurisdictionVersion: 1 as const,
    country: value.country,
    ...(value.region !== undefined ? { region: value.region } : {}),
  });
}

// ---------------------------------------------------------------------------
// AvailabilityWindowView — typed availability (A006 view)
// ---------------------------------------------------------------------------

/** Closed recurrence vocabulary — MUST equal A006's. */
export const AVAILABILITY_RECURRENCES = Object.freeze(['daily', 'weekly', 'one-time'] as const);

export type AvailabilityRecurrence = (typeof AVAILABILITY_RECURRENCES)[number];

export function isAvailabilityRecurrence(value: unknown): value is AvailabilityRecurrence {
  return (
    typeof value === 'string' &&
    (AVAILABILITY_RECURRENCES as readonly string[]).includes(value)
  );
}

/**
 * One typed availability window (structurally @arena/expert-registry's
 * AvailabilityWindow): recurrence ∈ {daily, weekly, one-time}, an
 * HH:MM–HH:MM UTC interval, plus the ISO day number (weekly) or the exact
 * calendar date (one-time). Pure data for the matching engine — this
 * module never interprets them into commitments.
 */
export interface AvailabilityWindowView {
  readonly windowVersion: 1;
  readonly recurrence: AvailabilityRecurrence;
  /** ISO day number, 1 (Monday) … 7 (Sunday) — weekly windows only. */
  readonly dayOfWeek?: number;
  /** Window opening, UTC HH:MM. */
  readonly startUtc: string;
  /** Window closing, UTC HH:MM (strictly after the opening). */
  readonly endUtc: string;
  /** Exact calendar date — one-time windows only. */
  readonly date?: string;
}

export function isAvailabilityWindowView(value: unknown): value is AvailabilityWindowView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['windowVersion'] !== 1 ||
    !isAvailabilityRecurrence(candidate['recurrence']) ||
    typeof candidate['startUtc'] !== 'string' ||
    !TIME_OF_DAY_PATTERN.test(candidate['startUtc']) ||
    typeof candidate['endUtc'] !== 'string' ||
    !TIME_OF_DAY_PATTERN.test(candidate['endUtc']) ||
    candidate['startUtc'] >= candidate['endUtc']
  ) {
    return false;
  }
  if (candidate['recurrence'] === 'weekly') {
    if (
      typeof candidate['dayOfWeek'] !== 'number' ||
      !Number.isInteger(candidate['dayOfWeek']) ||
      candidate['dayOfWeek'] < 1 ||
      candidate['dayOfWeek'] > 7
    ) {
      return false;
    }
  } else if (candidate['dayOfWeek'] !== undefined) {
    return false;
  }
  if (candidate['recurrence'] === 'one-time') {
    if (
      typeof candidate['date'] !== 'string' ||
      !CALENDAR_DATE_PATTERN.test(candidate['date']) ||
      !isValidCalendarDate(candidate['date'])
    ) {
      return false;
    }
  } else if (candidate['date'] !== undefined) {
    return false;
  }
  return true;
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number.parseInt(match[1] ?? '0', 10);
  const month = Number.parseInt(match[2] ?? '0', 10);
  const day = Number.parseInt(match[3] ?? '0', 10);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Validate and freeze an availability window view. */
export function toAvailabilityWindowView(value: {
  recurrence: string;
  dayOfWeek?: number;
  startUtc: string;
  endUtc: string;
  date?: string;
}): AvailabilityWindowView {
  if (!isAvailabilityRecurrence(value.recurrence)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: `unknown availability recurrence: ${JSON.stringify(value.recurrence)} (known: ${AVAILABILITY_RECURRENCES.join(', ')})`,
      details: { known: [...AVAILABILITY_RECURRENCES] },
    });
  }
  if (typeof value.startUtc !== 'string' || !TIME_OF_DAY_PATTERN.test(value.startUtc)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: `invalid availability startUtc: ${JSON.stringify(value.startUtc)} (UTC HH:MM required)`,
      details: { pattern: TIME_OF_DAY_PATTERN_SOURCE },
    });
  }
  if (typeof value.endUtc !== 'string' || !TIME_OF_DAY_PATTERN.test(value.endUtc)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: `invalid availability endUtc: ${JSON.stringify(value.endUtc)} (UTC HH:MM required)`,
      details: { pattern: TIME_OF_DAY_PATTERN_SOURCE },
    });
  }
  if (value.startUtc >= value.endUtc) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: `availability window is empty: endUtc ${JSON.stringify(value.endUtc)} must be after startUtc ${JSON.stringify(value.startUtc)}`,
      details: { startUtc: value.startUtc, endUtc: value.endUtc },
    });
  }
  let dayOfWeek: number | undefined;
  if (value.recurrence === 'weekly') {
    if (
      typeof value.dayOfWeek !== 'number' ||
      !Number.isInteger(value.dayOfWeek) ||
      value.dayOfWeek < 1 ||
      value.dayOfWeek > 7
    ) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
        message: `weekly availability windows require an ISO day number 1-7: ${JSON.stringify(value.dayOfWeek)}`,
        details: { field: 'dayOfWeek' },
      });
    }
    dayOfWeek = value.dayOfWeek;
  } else if (value.dayOfWeek !== undefined) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: `dayOfWeek is only valid on weekly windows (got recurrence ${JSON.stringify(value.recurrence)})`,
    });
  }
  let date: string | undefined;
  if (value.recurrence === 'one-time') {
    if (
      typeof value.date !== 'string' ||
      !CALENDAR_DATE_PATTERN.test(value.date) ||
      !isValidCalendarDate(value.date)
    ) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
        message: `one-time availability windows require a valid calendar date: ${JSON.stringify(value.date)}`,
        details: { pattern: CALENDAR_DATE_PATTERN_SOURCE },
      });
    }
    date = value.date;
  } else if (value.date !== undefined) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EXPERT_CARD, {
      message: `date is only valid on one-time windows (got recurrence ${JSON.stringify(value.recurrence)})`,
    });
  }
  return Object.freeze({
    windowVersion: 1 as const,
    recurrence: value.recurrence,
    ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
    startUtc: value.startUtc,
    endUtc: value.endUtc,
    ...(date !== undefined ? { date } : {}),
  });
}

// ---------------------------------------------------------------------------
// Strict shape enforcement (additionalProperties: false semantics)
// ---------------------------------------------------------------------------

/**
 * Assert that `value` is a plain object carrying every REQUIRED field and
 * no field outside required ∪ optional. Missing required fields and
 * unknown fields are both rejected with the given error code — the runtime
 * twin of the generated contracts' additionalProperties: false.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: ExpertQualificationErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExpertQualificationError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new ExpertQualificationError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new ExpertQualificationError(code, {
        message: `${context}: unknown field '${key}' (strict shape; additionalProperties are rejected)`,
        details: { field: key, allowed },
      });
    }
  }
  return record;
}

/** Validate a required positive integer field already read from a record. */
export function expectPositiveInteger(
  value: unknown,
  field: string,
  code: ExpertQualificationErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ExpertQualificationError(code, {
      message: `${context}: ${field} must be a positive integer, got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

/** Validate a non-negative integer field already read from a record. */
export function expectNonNegativeInteger(
  value: unknown,
  field: string,
  code: ExpertQualificationErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ExpertQualificationError(code, {
      message: `${context}: ${field} must be a non-negative integer, got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

/** Validate a member of a closed enum (string union). */
export function expectEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
  code: ExpertQualificationErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new ExpertQualificationError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Deep freeze (convention of every Arena domain package)
// ---------------------------------------------------------------------------

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
