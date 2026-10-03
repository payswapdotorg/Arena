/**
 * Demo-mode shared constants + THE labelling contract (Work Order B006;
 * issue #73).
 *
 * THE governing product truth: demo state is NOT customer state
 * (spec/product-requirements.md "Demo-first requirement": "Demo state is
 * clearly marked and cannot be mistaken for customer-authoritative
 * state"). The labelling contract below is the SINGLE source of the
 * banner/badge/reset texts every demo surface must display — the UI layer
 * consumes these constants so labelling cannot drift.
 *
 * This module is pure data: no randomness, no wall-clock, no
 * environment access, no Next.js imports.
 */

/** The @arena/demo package version (contract surface marker). */
export const DEMO_PACKAGE_VERSION = '1.0.0' as const;

/**
 * The reserved demo tenant id. Every demo record carries this tenant;
 * demo reads are scoped to it, and any demo-state request outside this
 * tenant surface fails with the typed DEMO_SCOPE_VIOLATION error.
 */
export const DEMO_TENANT_ID = 'arena-demo' as const;

/** True iff the value is the reserved demo tenant id. */
export function isDemoTenant(tenantId: unknown): boolean {
  return tenantId === DEMO_TENANT_ID;
}

/**
 * The fixed narrative time — the single "clock" of the demo story.
 * NO wall-clock reads exist anywhere in the corpus or render paths: a
 * demo "when" is always this constant (the A028 reference-body forge
 * epoch convention), so two builds/renders are byte-identical.
 */
export const DEMO_NARRATIVE_TIME_ISO = '2026-10-01T08:00:00.000Z' as const;

/** The narrative time as an epoch-ms integer (provenance stamps only). */
export const DEMO_NARRATIVE_EPOCH_MS = Date.parse(DEMO_NARRATIVE_TIME_ISO) as number;

// ---------------------------------------------------------------------------
// THE labelling contract (frozen; consumed by every demo surface)
// ---------------------------------------------------------------------------

/** Wire version of the labelling contract. */
export const DEMO_LABELLING_VERSION = '1.0.0' as const;

/** The always-visible demo banner title. */
export const DEMO_BANNER_TITLE = 'Demo mode' as const;

/** The always-visible demo banner text (the governing product truth). */
export const DEMO_BANNER_TEXT =
  'Demo state is not customer state. Everything here is a deterministic, resettable replay.' as const;

/** The short badge label pinned next to every demo-rendered datum. */
export const DEMO_BADGE_TEXT = 'Demo data' as const;

/** The badge note explaining WHY it is safe to show. */
export const DEMO_BADGE_NOTE = 'deterministic seed' as const;

/** The reset control label. */
export const DEMO_RESET_LABEL = 'Reset demo' as const;

/** The reset control explanation. (B017 intake: narrowed to the product's
 * actual semantics — store.reset() reseeds the corpus records; guided-walk
 * writes persist until the app process restarts, which is the total reset.) */
export const DEMO_RESET_HINT =
  'Reset reseeds the demo corpus to the identical hash; anything you wrote in the guided walk persists until the app restarts.' as const;

/** The frozen labelling contract itself (one object, one truth). */
export const DEMO_LABELLING = Object.freeze({
  version: DEMO_LABELLING_VERSION,
  bannerTitle: DEMO_BANNER_TITLE,
  bannerText: DEMO_BANNER_TEXT,
  badgeText: DEMO_BADGE_TEXT,
  badgeNote: DEMO_BADGE_NOTE,
  resetLabel: DEMO_RESET_LABEL,
  resetHint: DEMO_RESET_HINT,
} as const);

// ---------------------------------------------------------------------------
// Product-truth label vocabulary (spec/product-requirements.md
// "Product truth hierarchy": UI labels must distinguish these and must
// not display them with identical visual semantics)
// ---------------------------------------------------------------------------

/**
 * The closed product-truth label vocabulary demo narrative steps and
 * demo-rendered data may assert. Every label maps to a distinct
 * @arena/ui-platform truth treatment in the web layer (the mapping lives
 * presentation-side; the VOCABULARY is owned here).
 */
export const PRODUCT_TRUTH_LABELS = Object.freeze([
  'verified-fact',
  'evidence',
  'expert-judgment',
  'model-output',
  'simulation-replay',
  'evaluation-result',
  'certification',
  'suggestion',
] as const);

/** One product-truth label (closed vocabulary above). */
export type ProductTruthLabel = (typeof PRODUCT_TRUTH_LABELS)[number];

/** True iff the value is one of the closed product-truth labels. */
export function isProductTruthLabel(value: unknown): value is ProductTruthLabel {
  return (
    typeof value === 'string' &&
    (PRODUCT_TRUTH_LABELS as readonly string[]).includes(value)
  );
}
