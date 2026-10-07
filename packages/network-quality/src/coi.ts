/**
 * The CONFLICT-OF-INTEREST REGISTRY (Work Order C020; issue #126).
 *
 * Declared + derived conflict-of-interest records (tenant overlap, prior
 * engagement, marketplace interest) + the typed COI-CHECK READ PORT the
 * C002/C009/C013 seams can consume:
 *
 *   - clear                    — no COI record implicates the pair;
 *   - conflicted-with-reasons  — one or more COI records implicate the
 *                                pair, each with its kind + machine-
 *                                readable reason;
 *   - unknown-insufficient-data — the registry holds no admissible record
 *                                covering the pair (the honest unknown —
 *                                never a silent pass).
 *
 * A PROPOSAL SURFACE, NEVER A WRITE INTO ROUTING OR ADJUDICATION: the
 * check returns data; the owning surfaces decide what to do with it.
 * COI records are append-only, content-addressed and tenant-scoped; the
 * registry never deletes (revocation is a status transition; records
 * stay auditable — spec/security.md).
 */

import { digestCanonical } from '@arena/protocol-core';
import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  expectNonNegativeInteger,
  screenFieldNames,
  toNetworkQualityNeutralText,
  toNetworkQualityParty,
  toNetworkQualityRecordId,
  toNetworkQualityTenant,
  toNetworkQualityTimestamp,
} from './shared.js';
import { isCoiKind, isCoiOrigin } from './vocabulary.js';
import type { CoiCheckVerdict, CoiKind, CoiOrigin } from './vocabulary.js';

/** Wire version of the COI record. */
export const COI_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The COI record (declared or derived)
// ---------------------------------------------------------------------------

export interface CoiRecordView {
  readonly coiVersion: typeof COI_RECORD_VERSION;
  readonly coiId: string;
  readonly tenant: string;
  /** The party the conflict is ABOUT (e.g. an expert). */
  readonly party: string;
  /**
   * The counterparty the conflict is with (another expert, a tenant
   * principal, a marketplace seller) — the COI axis is PAIRWISE.
   */
  readonly counterparty: string;
  readonly kind: CoiKind;
  readonly origin: CoiOrigin;
  /**
   * The scope the conflict applies in (domain / task family / free-text
   * neutral scope); 'network-wide' when unscoped.
   */
  readonly scope: string;
  /**
   * The owning-surface evidence this COI derives from (derived records) —
   * null on purely declared records.
   */
  readonly derivedFrom: { readonly surface: string; readonly refDigest: string } | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  /** ACTIVE records count in checks; RETRACTED records stay auditable. */
  readonly status: 'ACTIVE' | 'RETRACTED';
  readonly notes?: string;
}

/** A frozen, content-addressed COI record (+ digest). */
export interface CoiRecord extends CoiRecordView {
  readonly digest: string;
}

export interface CreateCoiRecordInput {
  readonly coiId: string;
  readonly tenant: string;
  readonly party: string;
  readonly counterparty: string;
  readonly kind: string;
  readonly origin: string;
  readonly scope?: string;
  readonly derivedFrom?: { readonly surface: string; readonly refDigest: string } | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly notes?: string;
}

/**
 * Create ONE append-only, content-addressed COI record (declared or
 * derived). A DERIVED record MUST cite the owning-surface evidence it
 * derives from (fail closed otherwise); a DECLARED record may not invent
 * one.
 */
export async function createCoiRecord(input: CreateCoiRecordInput): Promise<CoiRecord> {
  const record = expectFields(
    input,
    [
      'coiId',
      'tenant',
      'party',
      'counterparty',
      'kind',
      'origin',
      'observedAt',
      'recordedAt',
    ],
    ['scope', 'derivedFrom', 'notes'],
    NETWORK_QUALITY_ERROR_CODES.INVALID_COI,
    'coi record',
  );
  if (!isCoiKind(record['kind'])) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message: `coi record: unknown COI kind: ${JSON.stringify(String(record['kind']))}`,
    });
  }
  if (!isCoiOrigin(record['origin'])) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message: `coi record: unknown COI origin: ${JSON.stringify(String(record['origin']))} (declared | derived)`,
    });
  }
  const observedAt = toNetworkQualityTimestamp(
    record['observedAt'] as string,
    'coi record observedAt',
  );
  const recordedAt = toNetworkQualityTimestamp(
    record['recordedAt'] as string,
    'coi record recordedAt',
  );
  if (Date.parse(recordedAt) < Date.parse(observedAt)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.BACKDATED_RECORD, {
      message: `coi record: recordedAt (${recordedAt}) precedes observedAt (${observedAt}) -- backdated recording fails closed`,
    });
  }
  const party = toNetworkQualityParty(record['party'] as string, 'coi record party');
  const counterparty = toNetworkQualityParty(
    record['counterparty'] as string,
    'coi record counterparty',
  );
  if (party === counterparty) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message: 'coi record: party and counterparty must be distinct -- a self-conflict is inadmissible',
    });
  }
  const derivedFromRaw = record['derivedFrom'] ?? null;
  let derivedFrom: CoiRecordView['derivedFrom'] = null;
  if (derivedFromRaw !== null && derivedFromRaw !== undefined) {
    const derived = expectFields(
      derivedFromRaw,
      ['surface', 'refDigest'],
      [],
      NETWORK_QUALITY_ERROR_CODES.INVALID_COI,
      'coi record derivedFrom',
    );
    derivedFrom = deepFreeze({
      surface: expectNonEmptyString(
        derived['surface'],
        'surface',
        NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE,
        'coi record derivedFrom',
      ),
      refDigest: expectNonEmptyString(
        derived['refDigest'],
        'refDigest',
        NETWORK_QUALITY_ERROR_CODES.INVALID_REF,
        'coi record derivedFrom',
      ),
    });
  }
  if ((record['origin'] as CoiOrigin) === 'derived' && derivedFrom === null) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message:
        'coi record: a DERIVED conflict must cite the owning-surface evidence it derives from (derivedFrom is required) -- an underived "derived" record is not admissible',
    });
  }
  if ((record['origin'] as CoiOrigin) === 'declared' && derivedFrom !== null) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message:
        'coi record: a DECLARED conflict cites no derived evidence -- use origin "derived" for evidence-backed conflicts',
    });
  }
  const view: CoiRecordView = {
    coiVersion: COI_RECORD_VERSION,
    coiId: toNetworkQualityRecordId(record['coiId'] as string, 'coi record coiId'),
    tenant: toNetworkQualityTenant(record['tenant'] as string, 'coi record tenant'),
    party,
    counterparty,
    kind: record['kind'] as CoiKind,
    origin: record['origin'] as CoiOrigin,
    scope:
      record['scope'] === undefined
        ? 'network-wide'
        : toNetworkQualityNeutralText(record['scope'] as string, 'coi record scope'),
    derivedFrom,
    observedAt,
    recordedAt,
    status: 'ACTIVE',
    ...(record['notes'] === undefined
      ? {}
      : { notes: toNetworkQualityNeutralText(record['notes'] as string, 'coi record notes') }),
  };
  screenFieldNames(view, 'coiRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as CoiRecord;
}

/**
 * Retract ONE COI record: a STATUS TRANSITION (ACTIVE -> RETRACTED) — the
 * record stays in the registry, auditable forever (spec/security.md
 * revocation law). Returns the retracted record (new digest, new
 * recordedAt-superseding time).
 */
export async function retractCoiRecord(
  record: CoiRecord,
  at: string,
  reason: string,
): Promise<CoiRecord> {
  const when = toNetworkQualityTimestamp(at, 'retract coi at');
  const why = toNetworkQualityNeutralText(reason, 'retract coi reason');
  if (Date.parse(when) < Date.parse(record.recordedAt)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.BACKDATED_RECORD, {
      message: 'retract coi: retraction time precedes the record time -- backdated retraction fails closed',
    });
  }
  if (record.status === 'RETRACTED') {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: 'retract coi: record is already RETRACTED -- revocation is one transition, records stay auditable',
    });
  }
  const { digest: _priorDigest, ...priorView } = record;
  const view: CoiRecordView = {
    ...priorView,
    status: 'RETRACTED',
    notes: `${record.notes ?? ''}${record.notes === undefined ? '' : ' '}[RETRACTED at ${when}: ${why}]`.slice(0, 2048),
  };
  screenFieldNames(view, 'coiRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as CoiRecord;
}

// ---------------------------------------------------------------------------
// The typed COI-check read port (closure over the registry)
// ---------------------------------------------------------------------------

/** One machine-readable reason a COI check cites. */
export interface CoiCheckReason {
  readonly coiId: string;
  readonly kind: CoiKind;
  readonly origin: CoiOrigin;
  readonly scope: string;
  readonly reason: string;
}

/** The typed COI-check verdict (the read port's return shape). */
export interface CoiCheckResult {
  readonly checkVersion: 1;
  readonly verdict: CoiCheckVerdict;
  /**
   * The machine-readable reasons (populated iff verdict is
   * conflicted-with-reasons; empty otherwise).
   */
  readonly reasons: readonly CoiCheckReason[];
  /** The number of registry records the closure examined (auditability). */
  readonly examined: number;
  readonly at: string;
}

/** The minimum-registry-size policy knob (below it: unknown-insufficient-data). */
export const COI_CHECK_MINIMUM_REGISTRY_SIZE = 1 as const;

/**
 * THE COI-CHECK CLOSURE: check one (party, counterparty) pair against the
 * registry (tenant-scoped). CLOSURE LAW:
 *
 *   - any ACTIVE record implicating the pair (in either direction) =>
 *     conflicted-with-reasons (all matching records cited);
 *   - no record AND registry size >= minimum =>
 *     clear (an evidence-backed clear, with the examined count);
 *   - no record AND registry size < minimum =>
 *     unknown-insufficient-data (the honest unknown -- NEVER a silent
 *     pass; the caller must treat it as unproven).
 *
 * RETRACTED records do not implicate the pair but remain examinable
 * (they count toward `examined` -- the audit trail).
 */
export function checkConflictOfInterest(
  registry: readonly CoiRecord[],
  input: {
    readonly tenant: string;
    readonly party: string;
    readonly counterparty: string;
    readonly at: string;
  },
): CoiCheckResult {
  const tenant = toNetworkQualityTenant(input.tenant, 'coi check tenant');
  const party = toNetworkQualityParty(input.party, 'coi check party');
  const counterparty = toNetworkQualityParty(input.counterparty, 'coi check counterparty');
  const at = toNetworkQualityTimestamp(input.at, 'coi check at');
  if (party === counterparty) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message: 'coi check: party and counterparty must be distinct — self-check is inadmissible',
    });
  }
  // Tenant closure: only the tenant's own records are examined (tenancy
  // law — a cross-tenant record never leaks into another tenant's check).
  const scoped = registry.filter((record) => record.tenant === tenant);
  const examined = scoped.length;
  const reasons: CoiCheckReason[] = [];
  for (const record of scoped) {
    if (record.status !== 'ACTIVE') continue;
    const implicates =
      (record.party === party && record.counterparty === counterparty) ||
      (record.party === counterparty && record.counterparty === party);
    if (!implicates) continue;
    reasons.push({
      coiId: record.coiId,
      kind: record.kind,
      origin: record.origin,
      scope: record.scope,
      reason: `party ${party} has an ${record.origin} ${record.kind} conflict with ${counterparty} in scope '${record.scope}' (recorded ${record.recordedAt})`,
    });
  }
  const verdict: CoiCheckVerdict =
    reasons.length > 0
      ? 'conflicted-with-reasons'
      : examined >= COI_CHECK_MINIMUM_REGISTRY_SIZE
        ? 'clear'
        : 'unknown-insufficient-data';
  return deepFreeze({
    checkVersion: 1 as const,
    verdict,
    reasons: Object.freeze(reasons),
    examined: expectNonNegativeInteger(
      examined,
      'examined',
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      'coi check',
    ),
    at,
  }) as CoiCheckResult;
}

/** Verify the content digest of a stored COI record (tamper check). */
export async function verifyCoiRecordDigest(record: CoiRecord): Promise<boolean> {
  const { digest: _digest, ...view } = record;
  return (await digestCanonical({ ...(view as CoiRecordView) })) === record.digest;
}

/** Recompute the content digest of a stored COI record. */
export async function recomputeCoiRecordDigest(record: CoiRecord): Promise<string> {
  const { digest: _digest, ...view } = record;
  return digestCanonical({ ...(view as CoiRecordView) });
}
