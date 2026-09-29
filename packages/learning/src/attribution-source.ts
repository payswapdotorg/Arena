/**
 * The CLOSED LE1.0 attribution vocabulary (Work Order A020;
 * spec/learning.md "Attribution").
 *
 * LE1.0: "Distinguish: substrate improvement; Body improvement;
 * environment improvement; evaluator changes; verifier changes;
 * sampling/measurement variance. **A changed evaluator score is not
 * automatically a capability improvement.**"
 *
 * The six distinguishable improvement sources (wire tokens per the
 * Work Order): substrate | body | environment | evaluator-change |
 * verifier-change | sampling-measurement-variance.
 *
 * The KEY RULE is encoded in the CONFOUNDS vocabulary: when the
 * evaluator or verifier version digests DIFFER between the baseline
 * and intervention arms, the attribution MUST flag
 * `evaluator-version-confound` / `verifier-version-confound` and the
 * capability-lift verdict MUST be `inconclusive-unless-controlled`
 * (spec/quality-model.md Q1.0 condition 3; "Changing an evaluator
 * requires a new version and cannot be treated as a pure model
 * improvement"). Confounds are SURFACED, never silently absorbed.
 */

import { LEARNING_ERROR_CODES } from './errors.js';
import { expectEnumMember } from './shared.js';

/** The six distinguishable LE1.0 attribution sources - the closed vocabulary. */
export const ATTRIBUTION_SOURCES = Object.freeze([
  'substrate',
  'body',
  'environment',
  'evaluator-change',
  'verifier-change',
  'sampling-measurement-variance',
] as const);

export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

/** The closed finding-status vocabulary of an attribution source. */
export const ATTRIBUTION_FINDING_STATUSES = Object.freeze([
  /** The descriptor declares an intervention on a surface feeding this source. */
  'declared-intervention',
  /** The arm evidence carries a version difference on this source between arms. */
  'detected-version-difference',
  /** A reported variance band covers the observed delta (within noise). */
  'within-measurement-variance',
  /** Nothing declares or detects this source. */
  'not-indicated',
] as const);

export type AttributionFindingStatus = (typeof ATTRIBUTION_FINDING_STATUSES)[number];

/** The closed measurement-validity confound vocabulary. */
export const ATTRIBUTION_CONFOUNDS = Object.freeze([
  'evaluator-version-confound',
  'verifier-version-confound',
] as const);

export type AttributionConfound = (typeof ATTRIBUTION_CONFOUNDS)[number];

/** Structural (non-throwing) checks. */
export function isAttributionSource(value: unknown): value is AttributionSource {
  return (
    typeof value === 'string' &&
    (ATTRIBUTION_SOURCES as readonly string[]).includes(value)
  );
}

export function isAttributionFindingStatus(
  value: unknown,
): value is AttributionFindingStatus {
  return (
    typeof value === 'string' &&
    (ATTRIBUTION_FINDING_STATUSES as readonly string[]).includes(value)
  );
}

export function isAttributionConfound(value: unknown): value is AttributionConfound {
  return (
    typeof value === 'string' &&
    (ATTRIBUTION_CONFOUNDS as readonly string[]).includes(value)
  );
}

/** Validating constructors - unknown members are rejected loudly. */
export function toAttributionSource(value: string, context: string): AttributionSource {
  return expectEnumMember(
    value,
    ATTRIBUTION_SOURCES,
    'source',
    LEARNING_ERROR_CODES.INVALID_ATTRIBUTION,
    context,
  );
}

export function toAttributionFindingStatus(
  value: string,
  context: string,
): AttributionFindingStatus {
  return expectEnumMember(
    value,
    ATTRIBUTION_FINDING_STATUSES,
    'status',
    LEARNING_ERROR_CODES.INVALID_ATTRIBUTION,
    context,
  );
}

export function toAttributionConfound(
  value: string,
  context: string,
): AttributionConfound {
  return expectEnumMember(
    value,
    ATTRIBUTION_CONFOUNDS,
    'confound',
    LEARNING_ERROR_CODES.INVALID_ATTRIBUTION,
    context,
  );
}
