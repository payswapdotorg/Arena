/**
 * Data-rights metadata (Work Order A034; spec/security.md S1.0 "Data
 * rights"; requirements R24, R47, R48).
 *
 * Artifacts retain SIX mandatory rights fields — owner, source,
 * permitted use, contract/license reference, retention, publication
 * status. Every field is REQUIRED (an artifact without a rights record
 * cannot pass validation — fail closed); the record is a FROZEN
 * immutable type; permitted use and publication status are CLOSED
 * vocabularies; retention is a structured policy, never a bare number.
 *
 * Enforcement helpers:
 *
 *   - checkDataRightsForAction — pure closed decision covering the read/
 *     export/publish/use-for-learning verbs against publication status,
 *     permitted use and retention expiry (an expired record denies every
 *     data action — 'retention-expired');
 *   - assertPublicationTransition — publication status moves along a
 *     CLOSED transition graph (private → tenant-internal → public is
 *     one-way per record version; public → withdrawn is the only
 *     backward edge, and withdrawal never re-publishes);
 *   - a missing rights record is NEVER an allow.
 */

import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { deepFreeze, expectEnumMember, expectFields, isEnumMember } from './shared.js';
import { toNeutralId, toTenantId } from './shared.js';
import type { NeutralId, NeutralText, TenantId } from './shared.js';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * The closed permitted-use vocabulary. 'cross-tenant-learning' is the
 * ONLY value that can ever authorize cross-tenant learning consumption —
 * and even then the learning gate requires an explicit, unexpired,
 * unrevoked grant (learning-authorization.ts). Everything else denies.
 */
export const PERMITTED_USES = Object.freeze([
  'tenant-internal',
  'evaluation',
  'learning-in-tenant',
  'cross-tenant-learning',
  'public-display',
  'certification',
] as const);

export type PermittedUse = (typeof PERMITTED_USES)[number];

export function isPermittedUse(value: unknown): value is PermittedUse {
  return isEnumMember(value, PERMITTED_USES);
}

/** The closed publication-status vocabulary. */
export const PUBLICATION_STATUSES = Object.freeze([
  'private',
  'tenant-internal',
  'public',
  'withdrawn',
] as const);

export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export function isPublicationStatus(value: unknown): value is PublicationStatus {
  return isEnumMember(value, PUBLICATION_STATUSES);
}

/** The closed retention-mode vocabulary. */
export const RETENTION_MODES = Object.freeze(['none', 'fixed-days', 'until-date'] as const);
export type RetentionMode = (typeof RETENTION_MODES)[number];

// ---------------------------------------------------------------------------
// Retention policy
// ---------------------------------------------------------------------------

/** Wire version of the retention policy shape. */
export const RETENTION_POLICY_VERSION = 1 as const;

/**
 * Structured retention: 'none' (no retention — data action denies after
 * first use window), 'fixed-days' (retentionDays from recordedAt),
 * 'until-date' (absolute expiry timestamp). Retention is enforced by
 * checkDataRightsForAction with an explicit as-of timestamp — pure, no
 * ambient clock.
 */
export interface RetentionPolicy {
  readonly recordVersion: typeof RETENTION_POLICY_VERSION;
  readonly mode: RetentionMode;
  readonly retentionDays: number | null;
  readonly expiresAt: string | null;
}

const RETENTION_CONTEXT = 'RetentionPolicy';

export function isRetentionPolicy(value: unknown): value is RetentionPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== RETENTION_POLICY_VERSION) return false;
  if (!isEnumMember(record['mode'], RETENTION_MODES)) return false;
  if (record['retentionDays'] !== null && typeof record['retentionDays'] !== 'number') {
    return false;
  }
  if (record['expiresAt'] !== null && typeof record['expiresAt'] !== 'string') return false;
  return true;
}

export function toRetentionPolicy(value: unknown): RetentionPolicy {
  const record = expectFields(
    value,
    ['recordVersion', 'mode', 'retentionDays', 'expiresAt'],
    [],
    SECURITY_ERROR_CODES.INVALID_RETENTION,
    RETENTION_CONTEXT,
  );
  if (record['recordVersion'] !== RETENTION_POLICY_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${RETENTION_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const mode = expectEnumMember(
    record['mode'],
    RETENTION_MODES,
    'mode',
    SECURITY_ERROR_CODES.INVALID_RETENTION,
    RETENTION_CONTEXT,
  );
  let retentionDays: number | null = null;
  if (record['retentionDays'] !== null && record['retentionDays'] !== undefined) {
    retentionDays = Number(record['retentionDays']);
    if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 36500) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RETENTION, {
        message: `${RETENTION_CONTEXT}.retentionDays: must be an integer 0..36500`,
        details: { received: JSON.stringify(record['retentionDays']) },
      });
    }
  }
  let expiresAt: string | null = null;
  if (record['expiresAt'] !== null && record['expiresAt'] !== undefined) {
    expiresAt = String(record['expiresAt']);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt) ||
      Number.isNaN(Date.parse(expiresAt))
    ) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RETENTION, {
        message: `${RETENTION_CONTEXT}.expiresAt: must be a ms-precision UTC RFC 3339 timestamp`,
        details: { received: expiresAt },
      });
    }
  }
  if (mode === 'fixed-days' && retentionDays === null) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RETENTION, {
      message: `${RETENTION_CONTEXT}: mode 'fixed-days' requires retentionDays`,
    });
  }
  if (mode === 'until-date' && expiresAt === null) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RETENTION, {
      message: `${RETENTION_CONTEXT}: mode 'until-date' requires expiresAt`,
    });
  }
  if (mode === 'none' && (retentionDays !== null || expiresAt !== null)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RETENTION, {
      message: `${RETENTION_CONTEXT}: mode 'none' must carry retentionDays=null and expiresAt=null (no silent defaults)`,
    });
  }
  return deepFreeze({
    recordVersion: RETENTION_POLICY_VERSION,
    mode,
    retentionDays,
    expiresAt,
  });
}

/** Compute the absolute expiry instant of a retention policy. */
export function retentionExpiry(
  policy: RetentionPolicy,
  recordedAt: string,
): string | null {
  if (policy.mode === 'until-date') return policy.expiresAt;
  if (policy.mode === 'fixed-days' && policy.retentionDays !== null) {
    const base = Date.parse(recordedAt);
    if (Number.isNaN(base)) return null;
    return new Date(base + policy.retentionDays * 86_400_000).toISOString();
  }
  return null;
}

// ---------------------------------------------------------------------------
// The data-rights record
// ---------------------------------------------------------------------------

/** Wire version of the data-rights record shape. */
export const DATA_RIGHTS_VERSION = 1 as const;

/**
 * The SIX mandatory S1.0 rights fields as one frozen record type:
 * owner (tenant), source, permitted use, contract/license reference,
 * retention, publication status. Every artifact that carries one is
 * governable; an artifact that cannot present a VALID one is denied
 * every data action (checkDataRightsForAction fails closed on a null
 * record).
 */
export interface DataRightsRecord {
  readonly recordVersion: typeof DATA_RIGHTS_VERSION;
  readonly owner: TenantId;
  readonly source: NeutralText;
  readonly permittedUse: PermittedUse;
  readonly contractRef: NeutralText;
  readonly retention: RetentionPolicy;
  readonly publicationStatus: PublicationStatus;
  readonly recordedAt: string;
}

const RIGHTS_CONTEXT = 'DataRightsRecord';

export function isDataRightsRecord(value: unknown): value is DataRightsRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== DATA_RIGHTS_VERSION) return false;
  if (typeof record['owner'] !== 'string') return false;
  if (typeof record['source'] !== 'string') return false;
  if (!isPermittedUse(record['permittedUse'])) return false;
  if (typeof record['contractRef'] !== 'string') return false;
  if (!isRetentionPolicy(record['retention'])) return false;
  if (!isPublicationStatus(record['publicationStatus'])) return false;
  if (typeof record['recordedAt'] !== 'string') return false;
  return true;
}

export function toDataRightsRecord(value: unknown): DataRightsRecord {
  const record = expectFields(
    value,
    [
      'recordVersion',
      'owner',
      'source',
      'permittedUse',
      'contractRef',
      'retention',
      'publicationStatus',
      'recordedAt',
    ],
    [],
    SECURITY_ERROR_CODES.INVALID_DATA_RIGHTS,
    RIGHTS_CONTEXT,
  );
  if (record['recordVersion'] !== DATA_RIGHTS_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${RIGHTS_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const owner = toTenantId(String(record['owner']), `${RIGHTS_CONTEXT}.owner`);
  for (const field of ['source', 'contractRef'] as const) {
    const raw = record[field];
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_DATA_RIGHTS, {
        message: `${RIGHTS_CONTEXT}.${field}: must be 1..4096 characters`,
        details: { field },
      });
    }
  }
  const permittedUse = expectEnumMember(
    record['permittedUse'],
    PERMITTED_USES,
    'permittedUse',
    SECURITY_ERROR_CODES.INVALID_PERMITTED_USE,
    RIGHTS_CONTEXT,
  );
  const retention = toRetentionPolicy(record['retention']);
  const publicationStatus = expectEnumMember(
    record['publicationStatus'],
    PUBLICATION_STATUSES,
    'publicationStatus',
    SECURITY_ERROR_CODES.INVALID_PUBLICATION,
    RIGHTS_CONTEXT,
  );
  const recordedAt = String(record['recordedAt']);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recordedAt)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${RIGHTS_CONTEXT}.recordedAt: must be a ms-precision UTC RFC 3339 timestamp`,
      details: { received: recordedAt },
    });
  }
  return deepFreeze({
    recordVersion: DATA_RIGHTS_VERSION,
    owner,
    source: record['source'] as NeutralText,
    permittedUse,
    contractRef: record['contractRef'] as NeutralText,
    retention,
    publicationStatus,
    recordedAt,
  });
}

// ---------------------------------------------------------------------------
// Publication transitions (closed graph)
// ---------------------------------------------------------------------------

/** The closed publication transition graph (from → allowed targets). */
export const PUBLICATION_TRANSITIONS: Readonly<Record<PublicationStatus, readonly PublicationStatus[]>> =
  Object.freeze({
    private: ['tenant-internal', 'public'],
    'tenant-internal': ['public'],
    public: ['withdrawn'],
    withdrawn: [],
  });

/**
 * Assert a publication status transition is legal per the closed graph.
 * Withdrawn is terminal — a withdrawn artifact can never be re-published
 * (re-publication requires a NEW record version, by construction).
 */
export function assertPublicationTransition(
  from: PublicationStatus,
  to: PublicationStatus,
): void {
  const allowed = PUBLICATION_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new SecurityError(SECURITY_ERROR_CODES.PUBLICATION_FORBIDDEN, {
      message: `illegal publication transition: '${from}' → '${to}' (allowed: [${allowed.join(', ')}])`,
      details: { from, to, allowed: [...allowed] },
    });
  }
}

// ---------------------------------------------------------------------------
// Data-rights enforcement (closed decisions)
// ---------------------------------------------------------------------------

/** The closed data-rights decision reason vocabulary. */
export const DATA_RIGHTS_DECISION_REASONS = Object.freeze([
  'permitted',
  'rights-missing',
  'retention-expired',
  'publication-forbidden',
  'use-not-permitted',
] as const);

export type DataRightsDecisionReason = (typeof DATA_RIGHTS_DECISION_REASONS)[number];

/** Machine-readable data-rights decision. */
export interface DataRightsDecision {
  readonly allowed: boolean;
  readonly reason: DataRightsDecisionReason;
  readonly owner: TenantId | 'unknown';
  readonly publicationStatus: PublicationStatus | 'unknown';
}

/**
 * PURE data-rights check for a data action against a rights record:
 *
 *   - null/invalid rights record ⇒ denied ('rights-missing') — an
 *     ungoverned artifact is NEVER consumable;
 *   - retention expired as of `asOf` ⇒ denied ('retention-expired');
 *   - 'publish' on anything not private/tenant-internal ⇒ denied
 *     ('publication-forbidden');
 *   - 'export'/'use-for-learning' require an explicit permitted use that
 *     covers them ⇒ otherwise denied ('use-not-permitted');
 *   - cross-tenant consumption additionally requires permittedUse
 *     'cross-tenant-learning' AND the learning grant (see
 *     learning-authorization.ts — this function is the rights half).
 */
export function checkDataRightsForAction(
  rights: DataRightsRecord | null | undefined,
  action: 'read' | 'export' | 'publish' | 'use-for-learning',
  asOf: string,
  options: { crossTenant?: boolean } = {},
): DataRightsDecision {
  const crossTenant = options.crossTenant ?? false;
  if (rights === null || rights === undefined || !isDataRightsRecord(rights)) {
    return deepFreeze({
      allowed: false,
      reason: 'rights-missing',
      owner: 'unknown',
      publicationStatus: 'unknown',
    });
  }
  const expiry = retentionExpiry(rights.retention, rights.recordedAt);
  if (expiry !== null && Date.parse(asOf) >= Date.parse(expiry)) {
    return deepFreeze({
      allowed: false,
      reason: 'retention-expired',
      owner: rights.owner,
      publicationStatus: rights.publicationStatus,
    });
  }
  if (rights.publicationStatus === 'withdrawn') {
    return deepFreeze({
      allowed: false,
      reason: 'publication-forbidden',
      owner: rights.owner,
      publicationStatus: rights.publicationStatus,
    });
  }
  if (action === 'publish' && rights.publicationStatus === 'public') {
    return deepFreeze({
      allowed: false,
      reason: 'publication-forbidden',
      owner: rights.owner,
      publicationStatus: rights.publicationStatus,
    });
  }
  if (action === 'read') {
    if (crossTenant && rights.publicationStatus !== 'public') {
      return deepFreeze({
        allowed: false,
        reason: 'publication-forbidden',
        owner: rights.owner,
        publicationStatus: rights.publicationStatus,
      });
    }
    return deepFreeze({
      allowed: true,
      reason: 'permitted',
      owner: rights.owner,
      publicationStatus: rights.publicationStatus,
    });
  }
  if (action === 'export' || action === 'use-for-learning') {
    if (crossTenant && rights.permittedUse !== 'cross-tenant-learning') {
      return deepFreeze({
        allowed: false,
        reason: 'use-not-permitted',
        owner: rights.owner,
        publicationStatus: rights.publicationStatus,
      });
    }
    if (!crossTenant && action === 'use-for-learning' && rights.permittedUse === 'tenant-internal') {
      return deepFreeze({
        allowed: false,
        reason: 'use-not-permitted',
        owner: rights.owner,
        publicationStatus: rights.publicationStatus,
      });
    }
    return deepFreeze({
      allowed: true,
      reason: 'permitted',
      owner: rights.owner,
      publicationStatus: rights.publicationStatus,
    });
  }
  return deepFreeze({
    allowed: false,
    reason: 'use-not-permitted',
    owner: rights.owner,
    publicationStatus: rights.publicationStatus,
  });
}

/** Guard form: throws typed SECURITY_DATA_RIGHTS_FORBIDDEN on denial. */
export function assertDataRightsForAction(
  rights: DataRightsRecord | null | undefined,
  action: 'read' | 'export' | 'publish' | 'use-for-learning',
  asOf: string,
  options: { crossTenant?: boolean } = {},
): void {
  const decision = checkDataRightsForAction(rights, action, asOf, options);
  if (!decision.allowed) {
    throw new SecurityError(SECURITY_ERROR_CODES.DATA_RIGHTS_FORBIDDEN, {
      message: `data-rights violation: ${decision.reason} (action=${action}, owner=${String(decision.owner)}, publication=${String(decision.publicationStatus)})`,
      details: { reason: decision.reason, action, crossTenant: options.crossTenant ?? false },
    });
  }
}

/** Owner-extraction helper (tenant of the rights record). */
export function dataRightsOwner(rights: DataRightsRecord): TenantId {
  return toTenantId(rights.owner, 'DataRightsRecord.owner');
}

/** Neutral reference builder for rights records (audit payload field). */
export function dataRightsRef(rights: DataRightsRecord): NeutralId {
  return toNeutralId(
    `rights-${String(rights.owner)}`,
    'dataRightsRef',
  );
}
