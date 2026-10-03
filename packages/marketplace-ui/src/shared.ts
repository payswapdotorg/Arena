/**
 * @arena/marketplace-ui — shared constants, product-truth notes and honest
 * payload readers (Work Order B013; issue #88; packages/marketplace-ui).
 *
 * THE governing product truths (B013 brief §3 — violating any fails review):
 *   - a marketplace purchase is NOT a certification;
 *   - provenance/rights metadata renders under the evidence truth class,
 *     verification status under the verification class;
 *   - every user-visible state carries its truth class — never collapsed
 *     into "AI result";
 *   - entitlement state is explicit (granted/revoked/expired/pending) —
 *     visible, never implied by ownership;
 *   - demo marketplace state is not customer state.
 *
 * Every view model built by this package carries these notes as frozen data
 * so the UI cannot render the distinction away. Every payload reader is
 * HONEST: a missing/foreign-typed field yields `undefined` and is listed in
 * the projection's `unknownFields` — never guessed, never defaulted to a
 * fabricated value (pending/unknown render as pending/unknown).
 *
 * This module is pure data + pure functions: no randomness, no wall-clock,
 * no environment access, no framework imports.
 */

/** The @arena/marketplace-ui package version (contract surface marker). */
export const MARKETPLACE_UI_PACKAGE_VERSION = '1.0.0' as const;

/** Wire version of every marketplace-ui view model. */
export const MARKETPLACE_UI_VIEW_VERSION = 1 as const;

/**
 * The truth-class vocabulary this package projects (a structural subset of
 * the B003 canonical state kinds — the labels mirror the canonical
 * descriptors and are never re-transcribed here).
 */
export type MarketplaceTruthClass =
  | 'verified-fact'
  | 'evidence'
  | 'expert-judgment'
  | 'certification'
  | 'pending'
  | 'unknown';

/** Provenance and rights metadata render under the evidence truth class. */
export const PROVENANCE_TRUTH_CLASS = 'evidence' as const;

/** Rights metadata is evidence (a licence record, not a verified claim). */
export const RIGHTS_TRUTH_CLASS = 'evidence' as const;

/** A decided verification outcome renders as a verified fact. */
export const VERIFICATION_TRUTH_CLASS = 'verified-fact' as const;

/** A certification badge renders under the certification truth class. */
export const CERTIFICATION_TRUTH_CLASS = 'certification' as const;

/** A resolved entitlement state is a record-backed fact. */
export const ENTITLEMENT_TRUTH_CLASS = 'verified-fact' as const;

/** Marketplace reviews are expert judgments — never verified facts. */
export const REVIEW_TRUTH_CLASS = 'expert-judgment' as const;

/** The two honesty-critical kinds (no badge — their own distinct marks). */
export const PENDING_TRUTH_CLASS = 'pending' as const;
export const UNKNOWN_TRUTH_CLASS = 'unknown' as const;

// ---------------------------------------------------------------------------
// Product-truth notes (frozen data — carried on every relevant view model)
// ---------------------------------------------------------------------------

/** Product truth 1: a marketplace purchase is never a certification. */
export const PURCHASE_NOT_CERTIFICATION_NOTE =
  'A marketplace purchase grants access under the listing licence terms — it is NOT a certification. Certification renders only where a certification record exists, scoped to its composition tuple (Body Version × Substrate × Environment × Runtime × Suite).' as const;

/** Certification scope: composition-scoped, never implied by a listing. */
export const CERTIFICATION_COMPOSITION_SCOPE_NOTE =
  'Certification renders only where a certification record backs it, scoped to its composition tuple (Body Version × Substrate × Environment × Runtime × Suite). A listing without such a record is not certified — rendered explicitly, never as a blank.' as const;

/** Product truth: entitlement state is explicit, never implied by ownership. */
export const ENTITLEMENT_STATE_NOTE =
  'Entitlement state is explicit — granted, revoked, expired or pending, derived from the append-only grant record — never implied by listing ownership, visibility, or purchase intent.' as const;

/** Provenance renders as an evidence chain, never as a verified claim. */
export const PROVENANCE_EVIDENCE_NOTE =
  'Provenance and rights metadata render under the evidence truth class: an auditable record chain, not a verified claim and not a certification.' as const;

/** Verification status renders under its own class, decided only by records. */
export const VERIFICATION_CLASS_NOTE =
  'Verification status renders under the verification class — decided only by a recorded verification outcome, never by marketplace admission, ownership, or purchase.' as const;

/** An expert qualification is a distinct concept from certification. */
export const EXPERT_QUALIFICATION_NOT_CERTIFICATION_NOTE =
  'An expert qualification is not a certification: qualification evidence chains gate marketplace admission; certification is a distinct, composition-scoped record. Expert-service listings therefore render as not certified.' as const;

/** Demo marketplace state is not customer state. */
export const DEMO_MARKETPLACE_NOTE =
  'Demo marketplace state is not customer state: deterministic, visibly labelled, and never a real price or a real purchase.' as const;

// ---------------------------------------------------------------------------
// Honest payload readers (fail honest — unknown stays unknown)
// ---------------------------------------------------------------------------

/** Coerce unknown payload data to a record view; `{}` when not a record. */
export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

/** Read one string field, honestly (`undefined` when absent or not a string). */
export function readString(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read one boolean field, honestly. */
export function readBoolean(
  data: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const value = data[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** Read one non-negative integer field, honestly. */
export function readCount(
  data: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = data[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Read one finite numeric field (ratings, averages), honestly. */
export function readNumber(
  data: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Read one array-of-strings field, honestly (`undefined` when not one). */
export function readStringArray(
  data: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const value = data[key];
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) return undefined;
    items.push(item);
  }
  return Object.freeze(items);
}

/** Parse an ISO timestamp honestly (`undefined` when unparseable). */
export function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Deep-freeze a plain view value (read discipline; cycles are not expected in view models). */
export function deepFreezeView<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreezeView((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
