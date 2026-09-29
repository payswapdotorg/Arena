/**
 * The CLOSED LE1.0 intervention-surface vocabulary (Work Order A020;
 * spec/learning.md "Interventions").
 *
 * LE1.0: "An intervention may change: skills; procedures;
 * retrieval/knowledge; tool configuration; memory policy;
 * evaluator/verifier; substrate; model-specific adaptation; body
 * composition. **The changed surface must be explicit.**"
 *
 * The wire tokens use the hyphenated forms of the spec's nine surfaces
 * (retrieval-knowledge, tool-configuration, memory-policy,
 * evaluator-verifier, model-specific-adaptation, body-composition).
 * An intervention artifact carrying an UNDECLARED or AMBIGUOUS surface
 * (any string outside this closed set) is REJECTED at descriptor
 * construction with LEARNING_INVALID_INTERVENTION - the explicitness
 * rule is enforced by the type system AND at runtime (negative tests
 * prove unknown, empty and near-miss surfaces are refused).
 */

import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import { expectEnumMember } from './shared.js';

/** The nine changeable surfaces of LE1.0 - the closed vocabulary. */
export const INTERVENTION_SURFACES = Object.freeze([
  'skills',
  'procedures',
  'retrieval-knowledge',
  'tool-configuration',
  'memory-policy',
  'evaluator-verifier',
  'substrate',
  'model-specific-adaptation',
  'body-composition',
] as const);

export type InterventionSurface = (typeof INTERVENTION_SURFACES)[number];

/** Structural (non-throwing) check for a member of the closed vocabulary. */
export function isInterventionSurface(value: unknown): value is InterventionSurface {
  return (
    typeof value === 'string' &&
    (INTERVENTION_SURFACES as readonly string[]).includes(value)
  );
}

/** Validating constructor - unknown members are rejected loudly. */
export function toInterventionSurface(value: string, context: string): InterventionSurface {
  return expectEnumMember(
    value,
    INTERVENTION_SURFACES,
    'changedSurface',
    LEARNING_ERROR_CODES.INVALID_INTERVENTION,
    context,
  );
}

/**
 * The LE1.0 attribution mapping: which IMPROVEMENT SOURCE a declared
 * intervention surface plausibly feeds (used by attributeExperiment to
 * classify the observed delta; see attribution.ts). This mapping is a
 * DISCLOSED DESIGN DECISION:
 *
 *   - substrate, model-specific-adaptation      → substrate improvement
 *   - body-composition, skills, procedures,
 *     retrieval-knowledge, memory-policy        → body improvement
 *   - tool-configuration                        → environment improvement
 *   - evaluator-verifier                        → evaluator/verifier
 *                                                  changes (confound class)
 *
 * It classifies where a DECLARED change would plausibly show up; it
 * never decides capability (that is the verdict's closed job).
 */
export const SURFACE_TO_ATTRIBUTION_SOURCES: Readonly<
  Record<InterventionSurface, readonly ('substrate' | 'body' | 'environment' | 'evaluator-change' | 'verifier-change')[]>
> = Object.freeze({
  skills: Object.freeze(['body'] as const),
  procedures: Object.freeze(['body'] as const),
  'retrieval-knowledge': Object.freeze(['body'] as const),
  'tool-configuration': Object.freeze(['environment'] as const),
  'memory-policy': Object.freeze(['body'] as const),
  'evaluator-verifier': Object.freeze(['evaluator-change', 'verifier-change'] as const),
  substrate: Object.freeze(['substrate'] as const),
  'model-specific-adaptation': Object.freeze(['substrate'] as const),
  'body-composition': Object.freeze(['body'] as const),
});

/** Assert the internal consistency of the surface mapping (test-facing). */
export function surfaceFeedsSources(
  surface: InterventionSurface,
): readonly ('substrate' | 'body' | 'environment' | 'evaluator-change' | 'verifier-change')[] {
  const sources = SURFACE_TO_ATTRIBUTION_SOURCES[surface];
  if (sources === undefined || sources.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_INTERVENTION, {
      message: `internal invariant violated: intervention surface ${JSON.stringify(surface)} maps to no attribution source`,
      details: { surface },
    });
  }
  return sources;
}
