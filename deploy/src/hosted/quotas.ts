/**
 * Free-tier quota ceilings for the hosted Arena preview (Work Order B015).
 *
 * NORMATIVE SOURCE: `docs/deployment/free-tier-architecture.md` (FT1.0
 * "Provider map" / "Budget guardrails") and `spec/free-tier-contract.md`
 * (FT2.0 fail-closed rules). The numbers below must match that document
 * EXACTLY; the matching unit test (`quotas.test.ts`) pins them so any drift
 * from the architecture document fails the deploy battery.
 *
 * Posture (product truth of B015):
 *   - free-tier-compatible BY CONSTRUCTION: the default deployed profile
 *     runs on provider free tiers;
 *   - the ceilings are DECLARED to the B002 hosted adapters as
 *     `declaredAllowances`, so they surface through the capacity probe /
 *     the B014 operations capacity panel (quota visibility — wiring, not a
 *     parallel dashboard);
 *   - wiring FAILS CLOSED when a quota is exhausted (see
 *     `./fail-closed.ts`): the operation is refused. There is NO paid
 *     fallback path anywhere in this surface (FT2.0: "Adapters never
 *     silently switch to a paid path");
 *   - usage/consumption metering is a B019 concern (cost/quota monitoring
 *     at the launch gate): declarations carry the LIMIT; `used`/`remaining`
 *     stay unknown (`null`) until a meter exists.
 */

/** Where these ceilings are documented (runbook pointer, never a URL with credentials). */
export const QUOTA_SOURCE_DOC = 'docs/deployment/free-tier-architecture.md';

/** 30-day recurring window (ms) — the monthly cadence providers bill on. */
export const THIRTY_DAY_WINDOW_MS = 2_592_000_000 as const;

/** 31-day window (ms) — Neon publish CU-hours per project per month. */
export const THIRTY_ONE_DAY_WINDOW_MS = 2_678_400_000 as const;

/** One declared free-tier ceiling for a provider dimension. */
export interface FreeTierDimensionCeiling {
  /** Logical dimension name (B014 operations capacity-panel vocabulary). */
  readonly dimension: string;
  /** The free-tier allowance (in `unit`). */
  readonly limit: number;
  /** Human unit of the allowance (documentation; readings are unit-less). */
  readonly unit: string;
  /** Recurring window in ms, or null for totals. */
  readonly windowMs: number | null;
}

/**
 * The shape the B002 hosted adapters accept as `declaredAllowances`
 * (NeonDeclaredAllowance / R2DeclaredAllowance / UpstashDeclaredAllowance
 * are structurally identical: `{ dimension, limit, windowMs? }`).
 */
export interface DeclaredAllowance {
  readonly dimension: string;
  readonly limit: number;
  readonly windowMs?: number;
}

function toDeclaredAllowances(
  ceilings: readonly FreeTierDimensionCeiling[],
): readonly DeclaredAllowance[] {
  return ceilings.map((ceiling) => ({
    dimension: ceiling.dimension,
    limit: ceiling.limit,
    ...(ceiling.windowMs !== null ? { windowMs: ceiling.windowMs } : {}),
  }));
}

/**
 * Neon Free ceilings (FT1.0, verbatim): "100 projects, 10
 * branches/project, 100 CU-hours/project/month, 0.5 GB storage/project and
 * 5 GB public network transfer/project/month".
 *
 * The account-level facts (projects, branches) are documented constants —
 * they are not per-request dimensions; the three operational dimensions are
 * declared to the control-plane adapter.
 */
export const NEON_FREE_TIER_QUOTAS = Object.freeze({
  providerId: 'control-plane-store',
  accountLevel: Object.freeze({
    projects: 100,
    branchesPerProject: 10,
  } as const),
  dimensions: Object.freeze([
    Object.freeze({
      dimension: 'storage',
      limit: 512,
      unit: 'MB (0.5 GB per project)',
      windowMs: null,
    }),
    Object.freeze({
      dimension: 'compute-hours',
      limit: 100,
      unit: 'CU-hours per project',
      windowMs: THIRTY_ONE_DAY_WINDOW_MS,
    }),
    Object.freeze({
      dimension: 'transfer',
      limit: 5,
      unit: 'GB public network transfer per project',
      windowMs: THIRTY_ONE_DAY_WINDOW_MS,
    }),
  ] as const),
} as const);

/**
 * Cloudflare R2 Standard free-tier ceilings (FT1.0, verbatim): "10 GB-month
 * storage, 1M Class A operations and 10M Class B operations/month, with
 * free Internet egress" (egress is free — not a declared dimension).
 */
export const R2_FREE_TIER_QUOTAS = Object.freeze({
  providerId: 'object-store',
  dimensions: Object.freeze([
    Object.freeze({
      dimension: 'storage',
      limit: 10,
      unit: 'GB-month',
      windowMs: THIRTY_DAY_WINDOW_MS,
    }),
    Object.freeze({
      dimension: 'class-a-operations',
      limit: 1_000_000,
      unit: 'operations per month',
      windowMs: THIRTY_DAY_WINDOW_MS,
    }),
    Object.freeze({
      dimension: 'class-b-operations',
      limit: 10_000_000,
      unit: 'operations per month',
      windowMs: THIRTY_DAY_WINDOW_MS,
    }),
  ] as const),
} as const);

/**
 * Upstash Redis Free ceilings (FT1.0, verbatim): "256 MB data, 10 GB
 * monthly bandwidth and 500K monthly commands".
 */
export const UPSTASH_FREE_TIER_QUOTAS = Object.freeze({
  providerId: 'coordination-store',
  dimensions: Object.freeze([
    Object.freeze({
      dimension: 'commands',
      limit: 500_000,
      unit: 'commands per month',
      windowMs: THIRTY_DAY_WINDOW_MS,
    }),
    Object.freeze({
      dimension: 'storage',
      limit: 256,
      unit: 'MB data',
      windowMs: null,
    }),
    Object.freeze({
      dimension: 'bandwidth',
      limit: 10,
      unit: 'GB per month',
      windowMs: THIRTY_DAY_WINDOW_MS,
    }),
  ] as const),
} as const);

/**
 * Apify Free ceiling (FT1.0, verbatim): "$5 of platform spend and blocks
 * further platform usage after the allowance is exhausted until the next
 * cycle" — the provider itself fails closed; the declaration mirrors that
 * ceiling. Apify is OPTIONAL and "must never be required for the primary
 * capability-development lifecycle" (spec/free-tier-contract.md).
 */
export const APIFY_FREE_TIER_QUOTAS = Object.freeze({
  providerId: 'data-acquisition',
  optional: true,
  dimensions: Object.freeze([
    Object.freeze({
      dimension: 'monthly-spend-usd',
      limit: 5,
      unit: 'USD platform spend per month',
      windowMs: THIRTY_DAY_WINDOW_MS,
    }),
  ] as const),
} as const);

/**
 * Vercel Hobby constraints (FT1.0, verbatim): "$0/month. Vercel Functions
 * on Hobby have a 300-second maximum duration, so long-running Arena jobs
 * must not depend on one request" — a request-shape constraint, not a
 * recurring allowance; it bounds the deployment profile (see ./vercel.ts)
 * and the job-compute posture.
 */
export const VERCEL_HOBBY_CONSTRAINTS = Object.freeze({
  priceUsdPerMonth: 0,
  functionsMaxDurationSeconds: 300,
} as const);

/** Declared allowances for the Neon (control-plane) adapter. */
export function neonDeclaredAllowances(): readonly DeclaredAllowance[] {
  return toDeclaredAllowances(NEON_FREE_TIER_QUOTAS.dimensions);
}

/** Declared allowances for the R2 (object-store) adapter. */
export function r2DeclaredAllowances(): readonly DeclaredAllowance[] {
  return toDeclaredAllowances(R2_FREE_TIER_QUOTAS.dimensions);
}

/** Declared allowances for the Upstash (coordination) adapter. */
export function upstashDeclaredAllowances(): readonly DeclaredAllowance[] {
  return toDeclaredAllowances(UPSTASH_FREE_TIER_QUOTAS.dimensions);
}

/** Declared allowances for the optional Apify wiring. */
export function apifyDeclaredAllowances(): readonly DeclaredAllowance[] {
  return toDeclaredAllowances(APIFY_FREE_TIER_QUOTAS.dimensions);
}
