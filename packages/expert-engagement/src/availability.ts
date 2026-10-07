/**
 * The availability + capacity model (Work Order C011; issue #117; spec/
 * expert-escalation-api.md ES1.0 Routing — "current availability" is a
 * routing input whose TRUTH this package owns; spec/escalation-
 * reference-flow.md step 3 — "finds qualified available experts").
 *
 *   - AvailabilityDeclaration — the expert-declared, VERSIONED record of
 *     availability windows (structurally compatible with the A006/A007
 *     AvailabilityWindowView so the C002 seam consumes them unchanged)
 *     plus per-window CAPACITY (slots). New versions SUPERSEDE prior
 *     ones (append-only supersession — prior declarations stay
 *     addressable); "current" resolves deterministically as the highest
 *     declared version.
 *   - Capacity accounting — commitments (accepted/active engagements)
 *     can NEVER overcommit a declared window: remaining slots are
 *     computed, not decremented; an offer that needs a slot from a
 *     zero-remaining window fails closed with CAPACITY_EXCEEDED.
 *   - Deterministic availability resolution at offer time — a bounded,
 *     clock-free day scan over [from, until] (the same arithmetic the
 *     C002 engine applies to candidate availability; derived from C002,
 *     recorded as an architecture note in the PR).
 *   - toRoutingAvailabilityInput — the typed READ projection feeding the
 *     ES1.0 "current availability" routing input consumed by the C002
 *     seam: the set of windows with remaining capacity, in the
 *     C002-compatible window shape. A PROJECTION the router reads —
 *     this package NEVER writes into routing.
 *
 * Tenant isolation at the domain level (lock rule 11); all timestamps
 * injected (lock rule 17); records are deep-frozen and content-addressed
 * (sha256 over canonical JSON; TAMPERED on digest mismatch).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isEngagementContentDigest,
  isEngagementTimestamp,
  toEngagementContentDigest,
  toEngagementExpertId,
  toEngagementId,
  toEngagementTenant,
  toEngagementTimestamp,
  toNonNegativeInteger,
  toPositiveInteger,
} from './shared.js';
import type {
  EngagementContentDigest,
  EngagementExpertId,
  EngagementId,
  EngagementTenant,
  EngagementTimestamp,
} from './shared.js';

/** Wire version of the availability-declaration record shape. */
export const AVAILABILITY_DECLARATION_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Availability windows (structurally compatible with A006/A007 views)
// ---------------------------------------------------------------------------

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One declared availability window — the same shape the C002
 * RoutingCandidateView consumes (recurrence | dayOfWeek | startUtc |
 * endUtc | date), so the routing seam reads this package's projection
 * without any translation layer.
 */
export interface AvailabilityWindow {
  readonly recurrence: 'weekly' | 'one-time';
  /** ISO day-of-week 1=Monday … 7=Sunday (weekly windows only). */
  readonly dayOfWeek?: number;
  /** UTC time-of-day HH:MM. */
  readonly startUtc: string;
  readonly endUtc: string;
  /** Calendar date YYYY-MM-DD (one-time windows only). */
  readonly date?: string;
}

export function isAvailabilityWindow(value: unknown): value is AvailabilityWindow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recurrence'] !== 'weekly' && candidate['recurrence'] !== 'one-time') {
    return false;
  }
  if (
    typeof candidate['startUtc'] !== 'string' ||
    !TIME_OF_DAY_PATTERN.test(candidate['startUtc'])
  ) {
    return false;
  }
  if (
    typeof candidate['endUtc'] !== 'string' ||
    !TIME_OF_DAY_PATTERN.test(candidate['endUtc'])
  ) {
    return false;
  }
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
  if (
    candidate['date'] !== undefined &&
    (typeof candidate['date'] !== 'string' || !CALENDAR_DATE_PATTERN.test(candidate['date']))
  ) {
    return false;
  }
  return true;
}

function toAvailabilityWindow(value: unknown, field: string): AvailabilityWindow {
  if (!isAvailabilityWindow(value)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_WINDOW, {
      message: `${field} requires a valid availability window (weekly|one-time, HH:MM start<end UTC, optional ISO dayOfWeek/date)`,
      details: { field },
    });
  }
  return deepFreeze({
    recurrence: value.recurrence,
    ...(value.dayOfWeek !== undefined ? { dayOfWeek: value.dayOfWeek } : {}),
    startUtc: value.startUtc,
    endUtc: value.endUtc,
    ...(value.date !== undefined ? { date: value.date } : {}),
  });
}

/** The stable identity of one window inside a declaration (capacity key). */
export function availabilityWindowKey(window: AvailabilityWindow): string {
  const parts = [window.recurrence, window.startUtc, window.endUtc];
  if (window.dayOfWeek !== undefined) parts.push(String(window.dayOfWeek));
  if (window.date !== undefined) parts.push(window.date);
  return parts.join('|');
}

// ---------------------------------------------------------------------------
// The versioned declaration (windows + capacity; supersession by append)
// ---------------------------------------------------------------------------

/** One declared window with its capacity (concurrent engagement slots). */
export interface DeclaredWindow {
  readonly window: AvailabilityWindow;
  /** How many concurrent engagements this window supports (>= 1). */
  readonly capacitySlots: number;
}

/** Digest-free view of an availability declaration. */
export interface AvailabilityDeclarationView {
  readonly recordVersion: typeof AVAILABILITY_DECLARATION_VERSION;
  readonly declarationId: string;
  readonly tenant: string;
  readonly expertId: string;
  /** Monotonic declaration version — higher supersedes lower. */
  readonly version: number;
  readonly windows: readonly DeclaredWindow[];
  readonly declaredAt: string;
}

/** A frozen, content-addressed availability declaration: view + digest. */
export interface AvailabilityDeclaration extends AvailabilityDeclarationView {
  readonly digest: EngagementContentDigest;
}

export interface CreateAvailabilityDeclarationInput {
  readonly declarationId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly version: number;
  readonly windows: readonly {
    readonly window: {
      readonly recurrence: string;
      readonly dayOfWeek?: number;
      readonly startUtc: string;
      readonly endUtc: string;
      readonly date?: string;
    };
    readonly capacitySlots: number;
  }[];
  readonly declaredAt: string;
}

export function isAvailabilityDeclaration(
  value: unknown,
): value is AvailabilityDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== AVAILABILITY_DECLARATION_VERSION) return false;
  if (typeof candidate['declarationId'] !== 'string') return false;
  if (typeof candidate['tenant'] !== 'string') return false;
  if (typeof candidate['expertId'] !== 'string') return false;
  if (
    typeof candidate['version'] !== 'number' ||
    !Number.isInteger(candidate['version']) ||
    candidate['version'] < 1
  ) {
    return false;
  }
  if (!Array.isArray(candidate['windows'])) return false;
  if (!isEngagementTimestamp(candidate['declaredAt'])) return false;
  return isEngagementContentDigest(candidate['digest']);
}

/** Construct + validate + digest + freeze one availability declaration. */
export async function createAvailabilityDeclaration(
  input: CreateAvailabilityDeclarationInput,
): Promise<AvailabilityDeclaration> {
  if (!Array.isArray(input.windows) || input.windows.length === 0) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_WINDOW, {
      message: 'an availability declaration requires at least one window',
    });
  }
  const seen = new Set<string>();
  const windows = input.windows.map((entry, index) => {
    const record = expectFields(
      entry,
      ['window', 'capacitySlots'],
      [],
      `windows[${index}]`,
    );
    const window = toAvailabilityWindow(record['window'], `windows[${index}].window`);
    const capacitySlots = toPositiveInteger(
      record['capacitySlots'],
      `windows[${index}].capacitySlots`,
    );
    const key = availabilityWindowKey(window);
    if (seen.has(key)) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_WINDOW, {
        message: `duplicate availability window '${key}' — one capacity per window`,
        details: { key },
      });
    }
    seen.add(key);
    return deepFreeze({ window, capacitySlots }) as DeclaredWindow;
  });
  const view: AvailabilityDeclarationView = {
    recordVersion: AVAILABILITY_DECLARATION_VERSION,
    declarationId: requireDeclarationId(input.declarationId),
    tenant: toEngagementTenant(input.tenant, 'tenant'),
    expertId: toEngagementExpertId(input.expertId, 'expertId'),
    version: toPositiveInteger(input.version, 'version'),
    windows: Object.freeze([...windows]),
    declaredAt: toEngagementTimestamp(input.declaredAt, 'declaredAt'),
  };
  const digest = (await digestCanonical(view)) as EngagementContentDigest;
  return deepFreeze({ ...view, digest });
}

function requireDeclarationId(value: string): string {
  if (typeof value !== 'string' || !/^avail-[a-z0-9][a-z0-9-]{0,62}$/.test(value)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `declarationId must match ^avail-[a-z0-9][a-z0-9-]{0,62}$: ${JSON.stringify(value)}`,
    });
  }
  return value;
}

/** Does `later` supersede `earlier`? (same tenant+expert, strictly higher version) */
export function supersedes(
  later: AvailabilityDeclaration,
  earlier: AvailabilityDeclaration,
): boolean {
  return (
    later.tenant === earlier.tenant &&
    later.expertId === earlier.expertId &&
    later.version > earlier.version
  );
}

/**
 * The CURRENT declaration among a set: the highest version for the
 * (tenant, expert). Deterministic — ties on version are impossible by
 * construction (version is the supersession key; a same-version re-declare
 * fails closed with VERSION_CONFLICT).
 */
export function resolveCurrentDeclaration(
  declarations: readonly AvailabilityDeclaration[],
  tenant: string,
  expertId: string,
): AvailabilityDeclaration | null {
  let current: AvailabilityDeclaration | null = null;
  for (const declaration of declarations) {
    if (declaration.tenant !== tenant || declaration.expertId !== expertId) continue;
    if (current === null || declaration.version > current.version) {
      current = declaration;
    } else if (declaration.version === current.version) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.VERSION_CONFLICT, {
        message: `two declarations share version ${declaration.version} for (${tenant}, ${expertId}) — versions are the supersession key`,
        details: { tenant, expertId, version: declaration.version },
      });
    }
  }
  return current;
}

/** Tamper detection — recompute the declaration digest (TAMPERED on mismatch). */
export async function verifyAvailabilityDeclarationDigest(
  declaration: AvailabilityDeclaration,
): Promise<EngagementContentDigest> {
  const { digest: _digest, ...view } = declaration;
  const recomputed = (await digestCanonical(view)) as EngagementContentDigest;
  if (recomputed !== declaration.digest) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.TAMPERED, {
      message: 'availability declaration digest mismatch — the committed record was mutated',
      details: { declarationId: declaration.declarationId },
    });
  }
  return recomputed;
}

// ---------------------------------------------------------------------------
// Capacity accounting (cannot overcommit a declared window)
// ---------------------------------------------------------------------------

/**
 * One capacity commitment: an engagement that consumes one slot of one
 * declared window. Commitments are FACTS recorded by the service layer
 * (accepted/active engagements); releasing happens by the engagement
 * leaving the consuming states — the accounting here is always RECOMPUTED
 * from the commitment set, never a mutable counter (no drift, no
 * double-decrement).
 */
export interface CapacityCommitment {
  readonly engagementId: string;
  readonly tenant: string;
  readonly expertId: string;
  /** The availability-window key the engagement occupies. */
  readonly windowKey: string;
}

const ACTIVE_COMMITMENT_STATUSES = Object.freeze(['accepted', 'active'] as const);

/** Does an engagement status occupy a capacity slot? (offered holds nothing) */
export function occupiesCapacity(status: string): boolean {
  return (ACTIVE_COMMITMENT_STATUSES as readonly string[]).includes(status);
}

/** Recompute the per-window committed-slot counts from a commitment set. */
export function committedSlotsByWindow(
  tenant: string,
  expertId: string,
  commitments: readonly CapacityCommitment[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const commitment of commitments) {
    if (commitment.tenant !== tenant || commitment.expertId !== expertId) continue;
    counts.set(commitment.windowKey, (counts.get(commitment.windowKey) ?? 0) + 1);
  }
  return counts;
}

/** The machine-readable capacity verdict (closed reasons — never a boolean). */
export const CAPACITY_REASONS = Object.freeze([
  'capacity-available',
  'capacity-window-unknown',
  'capacity-exceeded',
] as const);
export type CapacityReason = (typeof CAPACITY_REASONS)[number];

export interface CapacityCheck {
  readonly allowed: boolean;
  readonly reason: CapacityReason;
  readonly windowKey: string;
  readonly capacitySlots: number;
  readonly committed: number;
  readonly remaining: number;
}

/**
 * Can ONE more engagement occupy `window`? Fails closed when the window
 * is not part of the CURRENT declaration (capacity-window-unknown) or
 * the committed count already equals the declared capacity
 * (capacity-exceeded). PURE — recomputed from the declaration and the
 * commitment set every time.
 */
export function checkCapacity(
  declaration: AvailabilityDeclaration,
  window: AvailabilityWindow,
  commitments: readonly CapacityCommitment[],
): CapacityCheck {
  const windowKey = availabilityWindowKey(window);
  const declared = declaration.windows.find(
    (entry) => availabilityWindowKey(entry.window) === windowKey,
  );
  if (declared === undefined) {
    return {
      allowed: false,
      reason: 'capacity-window-unknown',
      windowKey,
      capacitySlots: 0,
      committed: 0,
      remaining: 0,
    };
  }
  const counts = committedSlotsByWindow(declaration.tenant, declaration.expertId, commitments);
  const committed = toNonNegativeInteger(counts.get(windowKey) ?? 0, 'committed');
  const remaining = Math.max(0, declared.capacitySlots - committed);
  return {
    allowed: remaining > 0,
    reason: remaining > 0 ? 'capacity-available' : 'capacity-exceeded',
    windowKey,
    capacitySlots: declared.capacitySlots,
    committed,
    remaining,
  };
}

// ---------------------------------------------------------------------------
// Deterministic availability resolution (offer time) — bounded day scan
// ---------------------------------------------------------------------------

const MINUTES_PER_DAY = 24 * 60;
const MAX_SCAN_DAYS = 400;

function parseTimeOfDay(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10);
}

function isoDayOfWeek(ms: number): number {
  const jsDay = new Date(ms).getUTCDay(); // 0=Sunday … 6=Saturday
  return ((jsDay + 6) % 7) + 1; // ISO 1=Monday … 7=Sunday
}

function dayStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * True iff `window` intersects the demand interval [fromMs, untilMs)
 * (derived from the C002 engine's windowCovers arithmetic — same
 * deterministic bounded day scan; recorded as an architecture note).
 */
export function windowIntersectsInterval(
  window: AvailabilityWindow,
  fromMs: number,
  untilMs: number,
): boolean {
  if (untilMs <= fromMs) return false;
  const startMinutes = parseTimeOfDay(window.startUtc);
  const endMinutes = parseTimeOfDay(window.endUtc);
  const scanDays = Math.min(
    Math.ceil((untilMs - dayStart(fromMs)) / (MINUTES_PER_DAY * 60000)) + 1,
    MAX_SCAN_DAYS,
  );
  for (let dayOffset = 0; dayOffset < scanDays; dayOffset += 1) {
    const dayMs = dayStart(fromMs) + dayOffset * MINUTES_PER_DAY * 60000;
    if (window.recurrence === 'weekly') {
      if (window.dayOfWeek !== undefined && isoDayOfWeek(dayMs) !== window.dayOfWeek) {
        continue;
      }
    } else if (window.recurrence === 'one-time') {
      if (window.date === undefined) continue;
      const dateMs = Date.parse(`${window.date}T00:00:00.000Z`);
      if (dayMs !== dateMs) continue;
    }
    const windowStart = dayMs + startMinutes * 60000;
    const windowEnd = dayMs + endMinutes * 60000;
    if (Math.max(windowStart, fromMs) < Math.min(windowEnd, untilMs)) return true;
  }
  return false;
}

/** The machine-readable offer-time availability verdict (closed reasons). */
export const AVAILABILITY_REASONS = Object.freeze([
  'availability-ok',
  'availability-no-declaration',
  'availability-no-window-in-interval',
  'availability-no-remaining-capacity',
] as const);
export type AvailabilityReason = (typeof AVAILABILITY_REASONS)[number];

export interface AvailabilityResolution {
  readonly available: boolean;
  readonly reason: AvailabilityReason;
  readonly windowKey: string | null;
  readonly remaining: number;
  /** The window that satisfied the interval (when available). */
  readonly window: AvailabilityWindow | null;
}

/**
 * Resolve, deterministically and without any clock read, whether the
 * expert is available for the demand interval [offerAt, deadline]:
 * a window must INTERSECT the interval AND have remaining capacity ≥ 1
 * (capacity accounting that cannot overcommit a declared window).
 */
export function resolveAvailabilityAtOfferTime(
  declaration: AvailabilityDeclaration | null,
  offerAt: string,
  requestDeadline: string,
  commitments: readonly CapacityCommitment[],
): AvailabilityResolution {
  if (declaration === null) {
    return {
      available: false,
      reason: 'availability-no-declaration',
      windowKey: null,
      remaining: 0,
      window: null,
    };
  }
  const fromMs = Date.parse(toEngagementTimestamp(offerAt, 'offerAt'));
  const untilMs = Date.parse(toEngagementTimestamp(requestDeadline, 'requestDeadline'));
  const counts = committedSlotsByWindow(declaration.tenant, declaration.expertId, commitments);
  let sawWindowInInterval = false;
  for (const entry of declaration.windows) {
    if (!windowIntersectsInterval(entry.window, fromMs, untilMs)) continue;
    sawWindowInInterval = true;
    const committed = counts.get(availabilityWindowKey(entry.window)) ?? 0;
    if (entry.capacitySlots - committed >= 1) {
      return {
        available: true,
        reason: 'availability-ok',
        windowKey: availabilityWindowKey(entry.window),
        remaining: entry.capacitySlots - committed,
        window: entry.window,
      };
    }
  }
  return {
    available: false,
    reason: sawWindowInInterval
      ? 'availability-no-remaining-capacity'
      : 'availability-no-window-in-interval',
    windowKey: null,
    remaining: 0,
    window: null,
  };
}

// ---------------------------------------------------------------------------
// The ES1.0 "current availability" routing input (READ projection only)
// ---------------------------------------------------------------------------

/** One window's routing-side availability entry. */
export interface RoutingAvailabilityWindow {
  readonly window: AvailabilityWindow;
  readonly remainingSlots: number;
}

/**
 * The typed availability read surface the C002 seam consumes as the
 * "current availability" routing input. A PROJECTION: the router reads
 * it; this package never writes into routing (service-boundary law).
 */
export interface RoutingAvailabilityInput {
  readonly tenant: string;
  readonly expertId: string;
  readonly asOf: string;
  readonly declarationDigest: string | null;
  readonly declarationVersion: number | null;
  /** Windows with remaining capacity ≥ 1 (C002-compatible window shapes). */
  readonly availableWindows: readonly RoutingAvailabilityWindow[];
  /** Count of declared windows fully committed (the negative space). */
  readonly fullyCommittedWindows: number;
}

/**
 * Project the CURRENT declaration into the ES1.0 routing input.
 * Deterministic given (declaration, commitments, asOf) — no clock reads.
 */
export function toRoutingAvailabilityInput(
  declaration: AvailabilityDeclaration | null,
  commitments: readonly CapacityCommitment[],
  asOf: string,
): RoutingAvailabilityInput {
  const projectionTime = toEngagementTimestamp(asOf, 'asOf');
  if (declaration === null) {
    return deepFreeze({
      tenant: '',
      expertId: '',
      asOf: projectionTime,
      declarationDigest: null,
      declarationVersion: null,
      availableWindows: Object.freeze([] as readonly RoutingAvailabilityWindow[]),
      fullyCommittedWindows: 0,
    });
  }
  const counts = committedSlotsByWindow(declaration.tenant, declaration.expertId, commitments);
  const availableWindows: RoutingAvailabilityWindow[] = [];
  let fullyCommitted = 0;
  for (const entry of declaration.windows) {
    const committed = counts.get(availabilityWindowKey(entry.window)) ?? 0;
    const remaining = Math.max(0, entry.capacitySlots - committed);
    if (remaining >= 1) {
      availableWindows.push(
        deepFreeze({ window: entry.window, remainingSlots: remaining }),
      );
    } else {
      fullyCommitted += 1;
    }
  }
  return deepFreeze({
    tenant: declaration.tenant,
    expertId: declaration.expertId,
    asOf: projectionTime,
    declarationDigest: declaration.digest,
    declarationVersion: declaration.version,
    availableWindows: Object.freeze([...availableWindows]),
    fullyCommittedWindows: fullyCommitted,
  });
}

/** The engagement-side ref an offer records (the declaration digest). */
export function availabilityRefOf(declaration: AvailabilityDeclaration): string {
  return declaration.digest;
}

/** Resolve the window key an engagement occupies, given its offer context. */
export function engagementWindowKey(
  declaration: AvailabilityDeclaration,
  offerAt: string,
  requestDeadline: string,
): string {
  const resolution = resolveAvailabilityAtOfferTime(
    declaration,
    offerAt,
    requestDeadline,
    [],
  );
  if (!resolution.available || resolution.window === null) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_WINDOW, {
      message: 'the declaration has no available window intersecting the demand interval',
      details: { reason: resolution.reason },
    });
  }
  return resolution.windowKey as string;
}
