/**
 * Capacity view-models (Work Order B014; apps/web/src/operations).
 * Pure projection layer — no React, no I/O.
 *
 * Projects B002 capacity objects (`ProviderHealth` / capacity snapshots,
 * read through the persistence package's PUBLIC capacity contracts — never
 * by instantiating a provider client) into the renderable capacity board.
 * The B014 capacity truths enforced HERE, by construction:
 *
 *   - the posture vocabulary is the CLOSED FT2.0 set (AVAILABLE, DEGRADED,
 *     EXHAUSTED, DISABLED), projected verbatim — no string munging, no
 *     invented states — plus this surface's own `unknown` for unreadable
 *     postures, which renders FAIL-CLOSED (never usable);
 *   - exhaustion NEVER silently degrades to "unlimited": an EXHAUSTED or
 *     DISABLED provider renders `failClosed` with its structured reasons
 *     (closed reason codes), and an unknown limit renders as
 *     ceiling-unknown — never as unbounded;
 *   - the NO-BILLABLE-FALLBACK guarantee is carried on the board as data:
 *     `exhaustionPolicy: 'fail-closed'` (the type's single inhabitant) and
 *     `noBillableFallback: true` — rendered verbatim, never as a promise
 *     of an upgrade path;
 *   - ceilings are VISIBLE: every dimension renders used / limit /
 *     remaining as the provider reports them;
 *   - malformed postures degrade TRUTHFULLY: unknown status, fail-closed,
 *     named unknown fields — never a guessed healthy state, never a
 *     thrown render.
 */

import {
  CAPACITY_EXHAUSTION_POLICY,
  CAPACITY_STATUS_SEVERITY,
  isCapacityDimensionReading,
  isCapacityReason,
  isProviderCapacityStatus,
  isProviderId,
} from '../../../../packages/persistence/src/index.js';
import type { CapacityReason, ProviderCapacityStatus } from '../../../../packages/persistence/src/index.js';

/** Version of the capacity view surface (bump on breaking changes). */
export const CAPACITY_VIEW_VERSION = 1 as const;

/** The posture view: the closed FT2.0 vocabulary plus this surface's honest `unknown` (fail-closed). */
export type CapacityStatusView = ProviderCapacityStatus | 'unknown';

/** One dimension reading row: the visible ceiling (as reported — unknown is never rendered as unbounded). */
export interface CapacityDimensionView {
  readonly dimension: string | undefined;
  readonly used: number | undefined;
  readonly limit: number | undefined;
  readonly remaining: number | undefined;
  readonly windowMs: number | undefined;
  /** True when the provider reports NO ceiling for this dimension — rendered as unknown, never unlimited. */
  readonly ceilingUnknown: boolean;
}

/** The fail-closed guarantee, carried as data and rendered verbatim on every board. */
export const CAPACITY_GUARANTEE_NOTE =
  'Free-tier capacity fails closed: an exhausted or disabled provider blocks every operation with a typed error, never silently degrades to "unlimited", and never switches to a billable path — the exhaustion policy has exactly one inhabitant (fail-closed) and no alternate route is representable in the type system.';

/** One provider's capacity posture row. */
export interface ProviderCapacityView {
  readonly viewVersion: typeof CAPACITY_VIEW_VERSION;
  readonly providerId: string | undefined;
  /** What this provider carries (logical role, provider-neutral — hosted posture in parentheses). */
  readonly role: string;
  readonly note?: string;
  readonly status: CapacityStatusView;
  /** True when the posture blocks operations (EXHAUSTED / DISABLED / unknown — fail closed). */
  readonly failClosed: boolean;
  readonly checkedAt: number | undefined;
  readonly dimensions: readonly CapacityDimensionView[];
  readonly reasons: readonly { readonly code: string; readonly dimension?: string }[];
  readonly truthClass: 'verified-fact' | 'unknown';
  readonly readable: boolean;
  readonly unknownFields: readonly string[];
}

/** The capacity board: per-provider postures + the worst-of overall + the fail-closed guarantee. */
export interface CapacityBoardView {
  readonly viewVersion: typeof CAPACITY_VIEW_VERSION;
  readonly overall: CapacityStatusView;
  readonly checkedAt: number | undefined;
  readonly providers: readonly ProviderCapacityView[];
  /** The one and only exhaustion policy (single inhabitant — rendered verbatim). */
  readonly exhaustionPolicy: typeof CAPACITY_EXHAUSTION_POLICY;
  /** No billable fallback exists — carried as data, rendered explicitly. */
  readonly noBillableFallback: true;
  readonly guaranteeNote: string;
  readonly boardNote?: string;
  readonly truthClass: 'verified-fact' | 'unknown';
  readonly readable: boolean;
  readonly unknownFields: readonly string[];
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Severity of a posture view for worst-of aggregation (`unknown` is the most severe — fail closed). */
function severityOf(status: CapacityStatusView): number {
  return status === 'unknown' ? Number.MAX_SAFE_INTEGER : CAPACITY_STATUS_SEVERITY[status];
}

/** True when a posture permits operations (AVAILABLE or DEGRADED — everything else fails closed). */
function isUsableView(status: CapacityStatusView): boolean {
  return status === 'AVAILABLE' || status === 'DEGRADED';
}

function readDimensionViews(
  value: unknown,
  unknownFields: string[],
): CapacityDimensionView[] {
  if (!Array.isArray(value)) {
    unknownFields.push('capacity dimensions');
    return [];
  }
  const views: CapacityDimensionView[] = [];
  value.forEach((entry, index) => {
    if (!isCapacityDimensionReading(entry)) {
      unknownFields.push(`capacity dimension #${String(index + 1)} (unreadable)`);
      return;
    }
    views.push(
      Object.freeze({
        dimension: entry.dimension,
        used: entry.used ?? undefined,
        limit: entry.limit ?? undefined,
        remaining: entry.remaining ?? undefined,
        windowMs: entry.windowMs ?? undefined,
        ceilingUnknown: entry.limit === null,
      } satisfies CapacityDimensionView),
    );
  });
  return views;
}

function readReasons(value: unknown): { code: string; dimension?: string }[] {
  if (!Array.isArray(value)) return [];
  const reasons: { code: string; dimension?: string }[] = [];
  for (const entry of value) {
    if (!isCapacityReason(entry)) continue;
    reasons.push(
      Object.freeze({
        code: entry.code,
        ...(entry.dimension !== undefined ? { dimension: entry.dimension } : {}),
      }),
    );
  }
  return reasons;
}

/** The projection input for one provider: the B002 health entry (or a malformed stand-in) + its logical role. */
export interface ProviderCapacityProjectionInput {
  readonly health: unknown;
  /** What this provider carries (provider-neutral role text). */
  readonly role: string;
  readonly note?: string;
}

/**
 * Project one B002 provider health entry into the capacity row. The
 * posture is guarded structurally: a malformed entry yields an `unknown`
 * posture that renders FAIL-CLOSED with named unknown fields — never a
 * guessed healthy state, never unlimited, never a thrown render.
 */
export function toProviderCapacityView(
  input: ProviderCapacityProjectionInput,
): ProviderCapacityView {
  const unknownFields: string[] = [];
  const raw: Record<string, unknown> =
    typeof input.health === 'object' && input.health !== null && !Array.isArray(input.health)
      ? (input.health as Record<string, unknown>)
      : {};
  const recordReadable = typeof input.health === 'object' && input.health !== null;
  if (!recordReadable) unknownFields.push('provider health (structurally unreadable)');

  const providerId =
    typeof raw['providerId'] === 'string' && isProviderId(raw['providerId'])
      ? raw['providerId']
      : undefined;
  unknownIf(providerId === undefined, 'providerId', unknownFields);
  const statusRaw = raw['status'];
  const status: CapacityStatusView = isProviderCapacityStatus(statusRaw) ? statusRaw : 'unknown';
  if (!isProviderCapacityStatus(statusRaw)) {
    unknownFields.push(`capacity status ${JSON.stringify(statusRaw)}`);
  }
  const checkedAt = readNonNegativeNumber(raw['checkedAt']);
  unknownIf(checkedAt === undefined, 'checkedAt', unknownFields);
  const dimensions = readDimensionViews(raw['dimensions'], unknownFields);
  const reasons = readReasons(raw['reasons']);
  const readable = isProviderCapacityStatus(statusRaw) && providerId !== undefined;

  return Object.freeze({
    viewVersion: CAPACITY_VIEW_VERSION,
    providerId,
    role: input.role,
    ...(input.note !== undefined ? { note: input.note } : {}),
    status,
    failClosed: !isUsableView(status),
    checkedAt,
    dimensions: Object.freeze(dimensions),
    reasons: Object.freeze(reasons),
    truthClass: readable ? ('verified-fact' as const) : ('unknown' as const),
    readable,
    unknownFields: Object.freeze([...new Set(unknownFields)]),
  } satisfies ProviderCapacityView);
}

function unknownIf(condition: boolean, field: string, sink: string[]): void {
  if (condition) sink.push(field);
}

/** The projection input for the board: the already-projected provider rows. */
export interface CapacityBoardProjectionInput {
  readonly providers: readonly ProviderCapacityView[];
  readonly checkedAt?: number;
  readonly note?: string;
}

/**
 * Project the capacity board: worst-of overall across providers (`unknown`
 * dominates — fail closed), the visible ceilings per provider, and the
 * fail-closed / no-billable-fallback guarantee carried as data. An empty
 * provider list renders overall `unknown` — never a fabricated healthy
 * board.
 */
export function toCapacityBoardView(input: CapacityBoardProjectionInput): CapacityBoardView {
  const unknownFields: string[] = [];
  if (input.providers.length === 0) {
    unknownFields.push('capacity board (no provider postures)');
  }
  let overall: CapacityStatusView = input.providers[0]?.status ?? 'unknown';
  for (const provider of input.providers) {
    if (severityOf(provider.status) > severityOf(overall)) {
      overall = provider.status;
    }
  }
  const checkedAt =
    input.checkedAt ??
    input.providers.reduce<number | undefined>((latest, provider) => {
      if (provider.checkedAt === undefined) return latest;
      return latest === undefined ? provider.checkedAt : Math.max(latest, provider.checkedAt);
    }, undefined);
  const anyReadable = input.providers.some((provider) => provider.readable);

  return Object.freeze({
    viewVersion: CAPACITY_VIEW_VERSION,
    overall,
    checkedAt,
    providers: Object.freeze([...input.providers]),
    exhaustionPolicy: CAPACITY_EXHAUSTION_POLICY,
    noBillableFallback: true,
    guaranteeNote: CAPACITY_GUARANTEE_NOTE,
    ...(input.note !== undefined ? { boardNote: input.note } : {}),
    truthClass: anyReadable ? ('verified-fact' as const) : ('unknown' as const),
    readable: anyReadable,
    unknownFields: Object.freeze([...new Set(unknownFields)]),
  } satisfies CapacityBoardView);
}

/** Re-export the reason type the rows carry (kept for view-layer typing). */
export type { CapacityReason };
