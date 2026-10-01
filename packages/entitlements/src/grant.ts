/**
 * EntitlementGrant records — the entitlement core (Work Order A033;
 * requirements R31, R34, R48; architecture-lock rules 11, 16, 18).
 *
 * A grant is one tenant-scoped entitlement over ONE feature key, carrying
 * one of three closed kinds: a feature flag (enabled / disabled), a quota
 * (limit over a metered aggregation window) or a rate limit (event-count
 * limit over a fixed duration). Grants are immutable records with
 * APPEND-ONLY lineage (`granted → amended* → revoked?`): every mutation
 * returns a NEW deep-frozen record; history is never rewritten.
 *
 * Expiry semantics: a grant is active at time `at` iff its lineage has no
 * `revoked` tail, `validFrom <= at`, and (when `expiresAt` is present)
 * `at < expiresAt` — a grant is EXPIRED exactly at its expiry instant.
 */

import { ENTITLEMENT_ERROR_CODES, EntitlementError } from './errors.js';
import {
  ENTITLEMENT_GRANT_KINDS,
  isEntitlementGrantKind,
  isFeatureKey,
  isGrantId,
  isGrantLineageKind,
  isMeterNote,
  isMeterTimestamp,
  isMeterWindow,
  isPositiveInteger,
  isTenantId,
  deepFreeze,
  toFeatureKey,
  toGrantId,
  toMeterNote,
  toMeterTimestamp,
  toMeterWindow,
  toTenantId,
} from './shared.js';
import type {
  EntitlementGrantKind,
  FeatureKey,
  GrantId,
  GrantLineageKind,
  MeterTimestamp,
  MeterWindow,
  TenantId,
} from './shared.js';

/** Wire version of every entitlement grant record. */
export const ENTITLEMENT_GRANT_RECORD_VERSION = 1 as const;

/** Maximum rate-limit duration (seconds) — bounded so windows stay auditable. */
export const MAX_RATE_LIMIT_DURATION_SECONDS = 2_592_000;

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

/** One append-only lineage entry in a grant's lifecycle. */
export interface GrantLineageEvent {
  /** 1-based monotonic sequence within this grant's lineage. */
  readonly sequence: number;
  readonly kind: GrantLineageKind;
  /** Canonical ms-UTC timestamp (when the lineage event occurred). */
  readonly occurredAt: string;
  readonly note: string;
}

export function isGrantLineageEvent(value: unknown): value is GrantLineageEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isPositiveInteger(candidate['sequence']) &&
    isGrantLineageKind(candidate['kind']) &&
    isMeterTimestamp(candidate['occurredAt']) &&
    isMeterNote(candidate['note'])
  );
}

// ---------------------------------------------------------------------------
// Grant records (discriminated union)
// ---------------------------------------------------------------------------

interface EntitlementGrantCommon {
  readonly recordVersion: typeof ENTITLEMENT_GRANT_RECORD_VERSION;
  readonly grantId: string;
  readonly tenantId: string;
  readonly featureKey: string;
  readonly kind: EntitlementGrantKind;
  readonly issuedAt: string;
  readonly validFrom: string;
  readonly expiresAt?: string;
  readonly lineage: readonly GrantLineageEvent[];
}

export interface FeatureFlagGrant extends EntitlementGrantCommon {
  readonly kind: 'feature-flag';
  readonly enabled: boolean;
}

export interface QuotaGrant extends EntitlementGrantCommon {
  readonly kind: 'quota';
  readonly limit: number;
  readonly window: MeterWindow;
}

export interface RateLimitGrant extends EntitlementGrantCommon {
  readonly kind: 'rate-limit';
  readonly limit: number;
  readonly durationSeconds: number;
}

export type EntitlementGrant = FeatureFlagGrant | QuotaGrant | RateLimitGrant;

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

function invalidGrant(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_GRANT, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function validateGrantCommon(
  candidate: Record<string, unknown>,
): { grantId: GrantId; tenantId: TenantId; featureKey: FeatureKey; issuedAt: MeterTimestamp; validFrom: MeterTimestamp; expiresAt?: MeterTimestamp; lineage: readonly GrantLineageEvent[] } {
  if (candidate['recordVersion'] !== ENTITLEMENT_GRANT_RECORD_VERSION) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `unsupported entitlement grant record version: ${String(candidate['recordVersion'])} (expected ${String(ENTITLEMENT_GRANT_RECORD_VERSION)})`,
    });
  }
  if (!isGrantId(candidate['grantId'])) invalidGrant(`invalid grant id: ${JSON.stringify(candidate['grantId'])}`);
  if (!isTenantId(candidate['tenantId'])) invalidGrant(`invalid grant tenant id: ${JSON.stringify(candidate['tenantId'])}`);
  if (!isFeatureKey(candidate['featureKey'])) invalidGrant(`invalid grant feature key: ${JSON.stringify(candidate['featureKey'])}`);
  if (!isMeterTimestamp(candidate['issuedAt'])) invalidGrant(`invalid grant issuedAt: ${JSON.stringify(candidate['issuedAt'])}`);
  if (!isMeterTimestamp(candidate['validFrom'])) invalidGrant(`invalid grant validFrom: ${JSON.stringify(candidate['validFrom'])}`);
  const expiresAt = candidate['expiresAt'];
  if (expiresAt !== undefined && !isMeterTimestamp(expiresAt)) {
    invalidGrant(`invalid grant expiresAt: ${JSON.stringify(expiresAt)}`);
  }
  const lineage = candidate['lineage'];
  if (!Array.isArray(lineage) || lineage.length === 0) {
    invalidGrant('grant lineage must be a non-empty array of lineage events');
  }
  let expected = 1;
  let lastAt = '';
  let first = true;
  for (const entry of lineage) {
    if (!isGrantLineageEvent(entry)) invalidGrant(`invalid grant lineage entry: ${JSON.stringify(entry)}`);
    if (entry.sequence !== expected) {
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
        message: `grant lineage sequence ${String(entry.sequence)} is not the expected next sequence ${String(expected)} (append-only lineage never rewrites history)`,
        details: { expected, actual: entry.sequence },
      });
    }
    if (first && entry.kind !== 'granted') {
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
        message: `grant lineage must start with 'granted', got ${String(entry.kind)}`,
        details: { attemptedKind: entry.kind },
      });
    }
    if (!first && entry.kind === 'granted') {
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
        message: "a 'granted' lineage event can never be appended after the first entry",
        details: { sequence: entry.sequence },
      });
    }
    if (entry.occurredAt < lastAt) {
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
        message: `grant lineage timestamps must be monotonically non-decreasing (last: ${lastAt}, attempted: ${entry.occurredAt})`,
        details: { last: lastAt, attempted: entry.occurredAt },
      });
    }
    if (entry.kind === 'revoked' && entry.sequence !== lineage.length) {
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
        message: `'revoked' must be the final lineage entry (nothing may follow a revocation)`,
        details: { sequence: entry.sequence, lineageLength: lineage.length },
      });
    }
    lastAt = entry.occurredAt;
    expected += 1;
    first = false;
  }
  return {
    grantId: candidate['grantId'],
    tenantId: candidate['tenantId'],
    featureKey: candidate['featureKey'],
    issuedAt: candidate['issuedAt'],
    validFrom: candidate['validFrom'],
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    lineage,
  };
}

/** Structural (non-throwing) check for any grant in the union. */
export function isEntitlementGrant(value: unknown): value is EntitlementGrant {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isEntitlementGrantKind(candidate['kind'])) return false;
  try {
    validateGrantCommon(candidate);
  } catch {
    return false;
  }
  switch (candidate['kind']) {
    case 'feature-flag':
      return typeof candidate['enabled'] === 'boolean';
    case 'quota':
      return isPositiveInteger(candidate['limit']) && isMeterWindow(candidate['window']);
    case 'rate-limit':
      return (
        isPositiveInteger(candidate['limit']) &&
        isPositiveInteger(candidate['durationSeconds']) &&
        candidate['durationSeconds'] <= MAX_RATE_LIMIT_DURATION_SECONDS
      );
    default:
      return false;
  }
}

/** Validate and deep-freeze a grant record (for loads from stores). */
export function toEntitlementGrant(value: unknown): EntitlementGrant {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_GRANT, {
      message: `an entitlement grant must be a plain object, got ${typeof value}`,
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isEntitlementGrantKind(candidate['kind'])) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_GRANT, {
      message: `unknown entitlement grant kind: ${String(candidate['kind'])} (kinds: ${ENTITLEMENT_GRANT_KINDS.join(', ')})`,
      details: { kinds: [...ENTITLEMENT_GRANT_KINDS] },
    });
  }
  // Granular, code-distinguished validation (UNSUPPORTED_RECORD_VERSION /
  // INVALID_GRANT / INVALID_LINEAGE), shared with the constructor path.
  const common = validateGrantCommon(candidate);
  switch (candidate['kind']) {
    case 'feature-flag': {
      const enabled = candidate['enabled'];
      if (typeof enabled !== 'boolean') {
        invalidGrant(`feature-flag grant requires a boolean enabled, got ${JSON.stringify(enabled)}`);
      }
      return deepFreeze({
        recordVersion: ENTITLEMENT_GRANT_RECORD_VERSION,
        grantId: common.grantId,
        tenantId: common.tenantId,
        featureKey: common.featureKey,
        kind: 'feature-flag',
        enabled,
        issuedAt: common.issuedAt,
        validFrom: common.validFrom,
        ...(common.expiresAt !== undefined ? { expiresAt: common.expiresAt } : {}),
        lineage: common.lineage,
      } satisfies FeatureFlagGrant);
    }
    case 'quota': {
      const limit = candidate['limit'];
      const window = candidate['window'];
      if (!isPositiveInteger(limit)) {
        invalidGrant(`quota grant limit must be a positive integer, got ${JSON.stringify(limit)}`);
      }
      if (!isMeterWindow(window)) {
        invalidGrant(`quota grant window must be 'day' or 'month', got ${JSON.stringify(window)}`);
      }
      return deepFreeze({
        recordVersion: ENTITLEMENT_GRANT_RECORD_VERSION,
        grantId: common.grantId,
        tenantId: common.tenantId,
        featureKey: common.featureKey,
        kind: 'quota',
        limit,
        window,
        issuedAt: common.issuedAt,
        validFrom: common.validFrom,
        ...(common.expiresAt !== undefined ? { expiresAt: common.expiresAt } : {}),
        lineage: common.lineage,
      } satisfies QuotaGrant);
    }
    case 'rate-limit': {
      const limit = candidate['limit'];
      const durationSeconds = candidate['durationSeconds'];
      if (!isPositiveInteger(limit)) {
        invalidGrant(`rate-limit grant limit must be a positive integer, got ${JSON.stringify(limit)}`);
      }
      if (
        !isPositiveInteger(durationSeconds) ||
        durationSeconds > MAX_RATE_LIMIT_DURATION_SECONDS
      ) {
        invalidGrant(
          `rate-limit grant durationSeconds must be a positive integer <= ${String(MAX_RATE_LIMIT_DURATION_SECONDS)}, got ${JSON.stringify(durationSeconds)}`,
        );
      }
      return deepFreeze({
        recordVersion: ENTITLEMENT_GRANT_RECORD_VERSION,
        grantId: common.grantId,
        tenantId: common.tenantId,
        featureKey: common.featureKey,
        kind: 'rate-limit',
        limit,
        durationSeconds,
        issuedAt: common.issuedAt,
        validFrom: common.validFrom,
        ...(common.expiresAt !== undefined ? { expiresAt: common.expiresAt } : {}),
        lineage: common.lineage,
      } satisfies RateLimitGrant);
    }
    default:
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_GRANT, {
        message: `unknown entitlement grant kind: ${String(candidate['kind'])}`,
      });
  }
}

// ---------------------------------------------------------------------------
// Constructors (append the 'granted' lineage root)
// ---------------------------------------------------------------------------

export interface CreateGrantCommonInput {
  readonly grantId: string;
  readonly tenantId: string;
  readonly featureKey: string;
  readonly issuedAt: string;
  readonly validFrom: string;
  readonly expiresAt?: string;
  readonly note?: string;
}

function grantedLineage(issuedAt: string, note: string): readonly GrantLineageEvent[] {
  return Object.freeze([
    Object.freeze({ sequence: 1, kind: 'granted', occurredAt: issuedAt, note }),
  ]);
}

function validateCommonInput(input: CreateGrantCommonInput): CreateGrantCommonInput {
  const grantId = toGrantId(input.grantId);
  const tenantId = toTenantId(input.tenantId);
  const featureKey = toFeatureKey(input.featureKey);
  const issuedAt = toMeterTimestamp(input.issuedAt);
  const validFrom = toMeterTimestamp(input.validFrom);
  const expiresAt = input.expiresAt !== undefined ? toMeterTimestamp(input.expiresAt) : undefined;
  if (expiresAt !== undefined && expiresAt <= validFrom) {
    invalidGrant(
      `grant expiresAt must be after validFrom (validFrom: ${validFrom}, expiresAt: ${expiresAt})`,
      { validFrom, expiresAt },
    );
  }
  const note = toMeterNote(input.note ?? 'entitlement grant created');
  return {
    grantId,
    tenantId,
    featureKey,
    issuedAt,
    validFrom,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    note,
  };
}

export function createFeatureFlagGrant(
  input: CreateGrantCommonInput & { readonly enabled: boolean },
): FeatureFlagGrant {
  const common = validateCommonInput(input);
  return deepFreeze({
    recordVersion: ENTITLEMENT_GRANT_RECORD_VERSION,
    grantId: common.grantId,
    tenantId: common.tenantId,
    featureKey: common.featureKey,
    kind: 'feature-flag',
    enabled: input.enabled,
    issuedAt: common.issuedAt,
    validFrom: common.validFrom,
    ...(common.expiresAt !== undefined ? { expiresAt: common.expiresAt } : {}),
    lineage: grantedLineage(common.issuedAt, common.note ?? 'entitlement grant created'),
  });
}

export function createQuotaGrant(
  input: CreateGrantCommonInput & { readonly limit: number; readonly window: string },
): QuotaGrant {
  if (!isPositiveInteger(input.limit)) {
    invalidGrant(`quota grant limit must be a positive integer, got ${JSON.stringify(input.limit)}`);
  }
  const window = toMeterWindow(input.window);
  const common = validateCommonInput(input);
  return deepFreeze({
    recordVersion: ENTITLEMENT_GRANT_RECORD_VERSION,
    grantId: common.grantId,
    tenantId: common.tenantId,
    featureKey: common.featureKey,
    kind: 'quota',
    limit: input.limit,
    window,
    issuedAt: common.issuedAt,
    validFrom: common.validFrom,
    ...(common.expiresAt !== undefined ? { expiresAt: common.expiresAt } : {}),
    lineage: grantedLineage(common.issuedAt, common.note ?? 'entitlement grant created'),
  });
}

export function createRateLimitGrant(
  input: CreateGrantCommonInput & { readonly limit: number; readonly durationSeconds: number },
): RateLimitGrant {
  if (!isPositiveInteger(input.limit)) {
    invalidGrant(`rate-limit grant limit must be a positive integer, got ${JSON.stringify(input.limit)}`);
  }
  if (
    !isPositiveInteger(input.durationSeconds) ||
    input.durationSeconds > MAX_RATE_LIMIT_DURATION_SECONDS
  ) {
    invalidGrant(
      `rate-limit grant durationSeconds must be a positive integer <= ${String(MAX_RATE_LIMIT_DURATION_SECONDS)}, got ${JSON.stringify(input.durationSeconds)}`,
    );
  }
  const common = validateCommonInput(input);
  return deepFreeze({
    recordVersion: ENTITLEMENT_GRANT_RECORD_VERSION,
    grantId: common.grantId,
    tenantId: common.tenantId,
    featureKey: common.featureKey,
    kind: 'rate-limit',
    limit: input.limit,
    durationSeconds: input.durationSeconds,
    issuedAt: common.issuedAt,
    validFrom: common.validFrom,
    ...(common.expiresAt !== undefined ? { expiresAt: common.expiresAt } : {}),
    lineage: grantedLineage(common.issuedAt, common.note ?? 'entitlement grant created'),
  });
}

// ---------------------------------------------------------------------------
// Append-only mutations (return NEW frozen records)
// ---------------------------------------------------------------------------

export interface AmendGrantInput {
  readonly expiresAt?: string;
  readonly limit?: number;
  readonly enabled?: boolean;
  readonly note?: string;
}

/**
 * Amend a grant: appends an 'amended' lineage event and returns a NEW frozen
 * record. Revoked grants are never amended; lineage timestamps are monotonic;
 * kind-specific fields may only be patched on grants of the matching kind.
 */
export function amendEntitlementGrant(
  grant: EntitlementGrant,
  input: AmendGrantInput,
  occurredAt: string,
): EntitlementGrant {
  const at = toMeterTimestamp(occurredAt);
  const last = grant.lineage[grant.lineage.length - 1];
  if (last === undefined) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
      message: 'grant lineage is empty (malformed record)',
    });
  }
  if (last.kind === 'revoked') {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.GRANT_REVOKED, {
      message: `grant ${grant.grantId} is revoked; revoked grants are never amended`,
      details: { grantId: grant.grantId },
    });
  }
  if (at < last.occurredAt) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
      message: `amendment occurredAt must not precede the last lineage event (last: ${last.occurredAt}, attempted: ${at})`,
      details: { last: last.occurredAt, attempted: at },
    });
  }
  if (input.limit !== undefined && grant.kind !== 'quota' && grant.kind !== 'rate-limit') {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_GRANT, {
      message: `a limit amendment requires a quota or rate-limit grant, got ${grant.kind}`,
      details: { grantId: grant.grantId, kind: grant.kind },
    });
  }
  if (input.limit !== undefined && !isPositiveInteger(input.limit)) {
    invalidGrant(`amended limit must be a positive integer, got ${JSON.stringify(input.limit)}`);
  }
  if (input.enabled !== undefined && grant.kind !== 'feature-flag') {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_GRANT, {
      message: `an enabled amendment requires a feature-flag grant, got ${grant.kind}`,
      details: { grantId: grant.grantId, kind: grant.kind },
    });
  }
  const expiresAt = input.expiresAt !== undefined ? toMeterTimestamp(input.expiresAt) : undefined;
  if (expiresAt !== undefined && expiresAt <= grant.validFrom) {
    invalidGrant(
      `amended expiresAt must be after validFrom (validFrom: ${grant.validFrom}, expiresAt: ${expiresAt})`,
    );
  }
  const note = toMeterNote(input.note ?? 'entitlement grant amended');
  const amended: EntitlementGrant = deepFreeze({
    ...grant,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    lineage: Object.freeze([
      ...grant.lineage,
      Object.freeze({
        sequence: grant.lineage.length + 1,
        kind: 'amended',
        occurredAt: at,
        note,
      } satisfies GrantLineageEvent),
    ]),
  });
  return amended;
}

/**
 * Revoke a grant: appends a FINAL 'revoked' lineage event and returns a NEW
 * frozen record. Revoking a revoked grant is rejected.
 */
export function revokeEntitlementGrant(
  grant: EntitlementGrant,
  occurredAt: string,
  note?: string,
): EntitlementGrant {
  const at = toMeterTimestamp(occurredAt);
  const last = grant.lineage[grant.lineage.length - 1];
  if (last === undefined) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
      message: 'grant lineage is empty (malformed record)',
    });
  }
  if (last.kind === 'revoked') {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.GRANT_REVOKED, {
      message: `grant ${grant.grantId} is already revoked; revocation is final`,
      details: { grantId: grant.grantId },
    });
  }
  if (at < last.occurredAt) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE, {
      message: `revocation occurredAt must not precede the last lineage event (last: ${last.occurredAt}, attempted: ${at})`,
      details: { last: last.occurredAt, attempted: at },
    });
  }
  return deepFreeze({
    ...grant,
    lineage: Object.freeze([
      ...grant.lineage,
      Object.freeze({
        sequence: grant.lineage.length + 1,
        kind: 'revoked',
        occurredAt: at,
        note: toMeterNote(note ?? 'entitlement grant revoked'),
      } satisfies GrantLineageEvent),
    ]),
  });
}

// ---------------------------------------------------------------------------
// Activity / expiry semantics
// ---------------------------------------------------------------------------

/** True iff the grant is active at `at`: not revoked, started, not expired. */
export function isGrantActive(grant: EntitlementGrant, at: string): boolean {
  const when = toMeterTimestamp(at);
  const last = grant.lineage[grant.lineage.length - 1];
  if (last === undefined || last.kind === 'revoked') return false;
  if (when < grant.validFrom) return false;
  if (grant.expiresAt !== undefined && when >= grant.expiresAt) return false;
  return true;
}

/** Why a grant is inactive at `at` (closed vocabulary; 'active' when active). */
export type GrantInactivityReason = 'active' | 'revoked' | 'expired' | 'not-yet-active';

export function grantInactivityReason(grant: EntitlementGrant, at: string): GrantInactivityReason {
  const when = toMeterTimestamp(at);
  const last = grant.lineage[grant.lineage.length - 1];
  if (last !== undefined && last.kind === 'revoked') return 'revoked';
  if (grant.expiresAt !== undefined && when >= grant.expiresAt) return 'expired';
  if (when < grant.validFrom) return 'not-yet-active';
  return 'active';
}

/** Stable key for a grant: `<tenantId>:<featureKey>:<grantId>`. */
export function entitlementGrantKey(grant: EntitlementGrant): string {
  return `${grant.tenantId}:${grant.featureKey}:${grant.grantId}`;
}
