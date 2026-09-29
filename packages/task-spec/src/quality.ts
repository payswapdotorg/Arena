/**
 * Leakage/quality declarations (Work Order A008; spec/task-spec.md TS1.0
 * "Quality": "High-value tasks require realistic context, discriminative
 * difficulty, observable success/failure, reproducible evaluation, low
 * leakage, clear provenance and declared limitations.")
 *
 * Every one of the seven dimensions is an EXPLICIT DECLARED field on every
 * TaskSpec — a task cannot silently be silent about its quality posture:
 *
 *   - `realistic-context` — the task's context reflects real work, not a
 *     toy proxy;
 *   - `discriminative-difficulty` — the task separates capable from
 *     incapable attempts (it is not trivially satisfiable);
 *   - `observable-success` — success and failure are OBSERVABLE (TS1.0
 *     "observable success/failure");
 *   - `reproducible-evaluation` — evaluation of attempts is reproducible;
 *   - `low-leakage` — the task resists leakage (shortcut answers are not
 *     embedded in the statement or context);
 *   - `clear-provenance` — the task's origin and lineage are traceable;
 *   - `declared-limitations` — the task's known limitations are stated,
 *     never implied.
 *
 * Each declaration carries a satisfaction flag, a REQUIRED justification
 * (a `satisfied: false` declaration is the honest statement of a gap —
 * TS1.0 "declared limitations" — and is valid, not an error) and a
 * STRUCTURED provenance (who declares this and by what reference: a
 * closed source vocabulary + a non-empty ref). The TaskSpec guard
 * requires EXACTLY ONE declaration per dimension — all seven, no
 * duplicates, none missing.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import { expectFields, expectNonEmptyString } from './shared.js';

/** The CLOSED seven-dimension quality vocabulary (TS1.0 "Quality", verbatim). */
export const TASK_QUALITY_DIMENSIONS = Object.freeze([
  'realistic-context',
  'discriminative-difficulty',
  'observable-success',
  'reproducible-evaluation',
  'low-leakage',
  'clear-provenance',
  'declared-limitations',
] as const);

export type TaskQualityDimension = (typeof TASK_QUALITY_DIMENSIONS)[number];

export function isTaskQualityDimension(value: unknown): value is TaskQualityDimension {
  return (
    typeof value === 'string' &&
    (TASK_QUALITY_DIMENSIONS as readonly string[]).includes(value)
  );
}

/** The CLOSED provenance-source vocabulary for quality declarations. */
export const QUALITY_PROVENANCE_SOURCES = Object.freeze([
  'compilation-policy',
  'case-evidence',
  'expert-declaration',
] as const);

export type QualityProvenanceSource = (typeof QUALITY_PROVENANCE_SOURCES)[number];

export function isQualityProvenanceSource(
  value: unknown,
): value is QualityProvenanceSource {
  return (
    typeof value === 'string' &&
    (QUALITY_PROVENANCE_SOURCES as readonly string[]).includes(value)
  );
}

/** Structured provenance of one quality declaration. */
export interface QualityProvenance {
  readonly source: QualityProvenanceSource;
  /** Who/what to trace: a policy identity, a digest, an expert principal. */
  readonly ref: string;
}

export function isQualityProvenance(value: unknown): value is QualityProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isQualityProvenanceSource(candidate['source']) &&
    typeof candidate['ref'] === 'string' &&
    candidate['ref'].length > 0
  );
}

/** One declared quality dimension with its provenance. */
export interface QualityDeclaration {
  readonly dimension: TaskQualityDimension;
  readonly satisfied: boolean;
  readonly justification: string;
  readonly provenance: QualityProvenance;
}

/** Stable field list for one declaration (tests + contracts mirror it). */
export const QUALITY_DECLARATION_FIELDS = Object.freeze([
  'dimension',
  'satisfied',
  'justification',
  'provenance',
] as const) as readonly string[];

export function isQualityDeclaration(value: unknown): value is QualityDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTaskQualityDimension(candidate['dimension']) &&
    typeof candidate['satisfied'] === 'boolean' &&
    typeof candidate['justification'] === 'string' &&
    candidate['justification'].length > 0 &&
    isQualityProvenance(candidate['provenance'])
  );
}

function toQualityDeclaration(value: unknown): QualityDeclaration {
  const record = expectFields(
    value,
    ['dimension', 'satisfied', 'justification', 'provenance'],
    [],
    TASK_SPEC_ERROR_CODES.INVALID_QUALITY,
    'quality declaration',
  );
  const dimension = record['dimension'];
  if (!isTaskQualityDimension(dimension)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_QUALITY, {
      message: `unknown quality dimension: ${JSON.stringify(dimension)} (known: ${TASK_QUALITY_DIMENSIONS.join(', ')})`,
      details: { known: [...TASK_QUALITY_DIMENSIONS] },
    });
  }
  const provenance = record['provenance'];
  if (!isQualityProvenance(provenance)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_QUALITY, {
      message: `quality declaration for ${JSON.stringify(dimension)} requires a structured provenance {source, ref}`,
      details: { sources: [...QUALITY_PROVENANCE_SOURCES] },
    });
  }
  return Object.freeze({
    dimension,
    satisfied: record['satisfied'] === true,
    justification: expectNonEmptyString(
      record['justification'],
      'justification',
      TASK_SPEC_ERROR_CODES.INVALID_QUALITY,
      `quality declaration for ${JSON.stringify(dimension)}`,
    ),
    provenance: Object.freeze({ ...provenance }),
  });
}

/**
 * Validate the COMPLETE quality declaration set: EXACTLY one declaration
 * per dimension (all seven, no duplicates, none missing — a task cannot be
 * silent about any quality dimension). Returns the deep-frozen list in the
 * canonical dimension order.
 */
export function toQualityDeclarationSet(
  value: readonly {
    dimension: string;
    satisfied: boolean;
    justification: string;
    provenance: { source: string; ref: string };
  }[],
): readonly QualityDeclaration[] {
  if (!Array.isArray(value) || value.length !== TASK_QUALITY_DIMENSIONS.length) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_QUALITY, {
      message: `a TaskSpec requires EXACTLY one quality declaration per dimension (${TASK_QUALITY_DIMENSIONS.length} dimensions: ${TASK_QUALITY_DIMENSIONS.join(', ')}), got ${Array.isArray(value) ? value.length : 'non-array'}`,
      details: { required: [...TASK_QUALITY_DIMENSIONS] },
    });
  }
  const declarations = value.map(toQualityDeclaration);
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (seen.has(declaration.dimension)) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_QUALITY, {
        message: `duplicate quality declaration for dimension ${JSON.stringify(declaration.dimension)} — exactly one per dimension`,
        details: { dimension: declaration.dimension },
      });
    }
    seen.add(declaration.dimension);
  }
  for (const dimension of TASK_QUALITY_DIMENSIONS) {
    if (!seen.has(dimension)) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_QUALITY, {
        message: `missing quality declaration for dimension ${JSON.stringify(dimension)} — a task cannot be silent about any quality dimension`,
        details: { dimension, required: [...TASK_QUALITY_DIMENSIONS] },
      });
    }
  }
  const byDimension = new Map(declarations.map((d) => [d.dimension as string, d]));
  return Object.freeze(
    TASK_QUALITY_DIMENSIONS.map(
      (dimension) => byDimension.get(dimension) as QualityDeclaration,
    ),
  );
}
