/**
 * @arena/body-ui — shared constants, product-truth notes and honest payload
 * readers (Work Order B010; issue #82; packages/body-ui).
 *
 * THE governing product truths (architecture-lock A2.0 rules 1-5; B010
 * brief §6 — violating any fails review):
 *   - Body ≠ model; Substrate ≠ Body;
 *   - Possession = a VERSIONED COMPOSITION BINDING, never an alias for the
 *     model ("the body runs model X" is a forbidden shape);
 *   - certification claims apply to the tested composition;
 *   - Body Versions are immutable and content-addressed.
 *
 * Every view model built by this package carries these notes as frozen data
 * so the UI cannot render the distinction away. Every payload reader is
 * HONEST: a missing/foreign-typed field yields `undefined` and is listed
 * in the projection's `unknownFields` — never guessed, never defaulted to
 * a fabricated value (pending/unknown render as pending/unknown).
 *
 * This module is pure data + pure functions: no randomness, no wall-clock,
 * no environment access, no framework imports.
 */

/** The @arena/body-ui package version (contract surface marker). */
export const BODY_UI_PACKAGE_VERSION = '1.0.0' as const;

/** Wire version of every body-ui view model. */
export const BODY_UI_VIEW_VERSION = 1 as const;

/** The core distinction of this surface: a body is never just a model. */
export const BODY_NOT_MODEL_NOTE =
  'A body is never just a model: it composes skills, knowledge, tools, procedures and policies around a mission.' as const;

/** Lock rule 2: the Cognitive Substrate is distinct from the Agent Body. */
export const SUBSTRATE_DISTINCT_FROM_BODY_NOTE =
  'The Cognitive Substrate is distinct from the Agent Body: a substrate is one component a possession binds, never the body itself.' as const;

/** Lock rule 3: a Possession is a versioned binding, not an alias for the model. */
export const POSSESSION_BINDING_NOTE =
  'A Possession is a versioned composition binding — Body Version × Cognitive Substrate × Runtime × Environment × Policy — never an alias for the model.' as const;

/** Lock rule 4: certification claims apply to the tested composition. */
export const CERTIFICATION_SCOPE_NOTE =
  'A certification claim applies to the tested composition (Body Version × Substrate × Environment × Runtime × Suite), never the bare model.' as const;

/** Lock rule 5: Body Versions are immutable and content-addressed. */
export const BODY_VERSION_IMMUTABILITY_NOTE =
  'Body Versions are immutable and content-addressed: improvement creates a NEW version; a version is never edited in place.' as const;

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

/** Deep-freeze a plain view value (read discipline; cycles are not expected in view models). */
export function deepFreezeView<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreezeView((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
