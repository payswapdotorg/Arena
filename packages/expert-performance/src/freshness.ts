/**
 * The explicit, versioned FRESHNESS policy (Work Order C005 —
 * "Freshness/decay: explicit versioned policy fields (staleness windows
 * per dimension), never silent decay; stale evidence surfaces as stale
 * with reasons").
 *
 * Freshness is a READ-TIME assessment under a versioned policy: evidence
 * records are never mutated, decayed or dropped — a stale record remains
 * in the append-only log forever and simply surfaces as `stale` with the
 * reasons why. The policy carries one staleness window per dimension (the
 * quality-model dimensions may stale at different speeds: demonstrated
 * skill competency vs domain/jurisdiction fit vs declared conflicts).
 */

import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';
import { expectNonNegativeInteger, toPerformanceTimestamp } from './shared.js';
import type { PerformanceTimestamp } from './shared.js';
import { PERFORMANCE_DIMENSIONS, toPerformanceDimension } from './dimensions.js';
import type { PerformanceDimension } from './dimensions.js';

/** Wire version of the freshness policy shape. */
export const FRESHNESS_POLICY_VERSION = 1 as const;

/**
 * The default per-dimension staleness windows (milliseconds). DERIVED
 * defaults (no dedicated canonical spec — architecture question in the
 * PR): demonstrated competency/agreement/consistency stale fastest;
 * task-family and review outcomes carry engagement memory; domain fit and
 * declared conflicts/limitations are the slowest-decaying facts.
 */
export const DEFAULT_FRESHNESS_WINDOWS_MS: Readonly<Record<PerformanceDimension, number>> =
  Object.freeze({
    'skill-competency': 90 * 24 * 60 * 60 * 1000,
    'task-family-outcome': 180 * 24 * 60 * 60 * 1000,
    agreement: 90 * 24 * 60 * 60 * 1000,
    'review-outcome': 180 * 24 * 60 * 60 * 1000,
    consistency: 120 * 24 * 60 * 60 * 1000,
    'domain-jurisdiction-fit': 365 * 24 * 60 * 60 * 1000,
    recency: 30 * 24 * 60 * 60 * 1000,
    'conflict-limitation': 365 * 24 * 60 * 60 * 1000,
  } as const);

/** A versioned freshness policy: one staleness window per dimension. */
export interface FreshnessPolicy {
  readonly policyVersion: typeof FRESHNESS_POLICY_VERSION;
  readonly windowsMs: Readonly<Record<PerformanceDimension, number>>;
}

/** The default in-force freshness policy. */
export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = Object.freeze({
  policyVersion: FRESHNESS_POLICY_VERSION,
  windowsMs: DEFAULT_FRESHNESS_WINDOWS_MS,
} as const);

export interface CreateFreshnessPolicyInput {
  readonly windowsMs: Record<string, number>;
}

/** Build a validated freshness policy (all eight dimensions, positive windows). */
export function createFreshnessPolicy(input: CreateFreshnessPolicyInput): FreshnessPolicy {
  const windows: Partial<Record<PerformanceDimension, number>> = {};
  for (const dimension of PERFORMANCE_DIMENSIONS) {
    const value = input.windowsMs[dimension];
    if (value === undefined) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_POLICY, {
        message: `freshness policy: missing staleness window for dimension '${dimension}' (explicit per-dimension windows — never silent defaults for a custom policy)`,
        details: { dimension },
      });
    }
    windows[dimension] = expectNonNegativeInteger(
      value,
      `windowsMs.${dimension}`,
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_POLICY,
      'freshness policy',
    );
  }
  for (const key of Object.keys(input.windowsMs)) {
    toPerformanceDimension(key, 'freshness policy');
  }
  return Object.freeze({
    policyVersion: FRESHNESS_POLICY_VERSION,
    windowsMs: Object.freeze({ ...windows }) as Readonly<Record<PerformanceDimension, number>>,
  });
}

/** The read-time freshness status of one dimension's evidence. */
export type FreshnessStatus = 'fresh' | 'stale' | 'no-evidence';

export interface FreshnessAssessment {
  readonly status: FreshnessStatus;
  /** Why this status holds (empty only for fresh-by-window). */
  readonly reasons: readonly string[];
  /** The in-force staleness window the assessment ran under. */
  readonly windowMs: number;
}

/**
 * Assess the freshness of one dimension given its LAST observed time
 * (null when the dimension has no records). PURE — the time is injected,
 * never a clock read; records are never mutated (no silent decay).
 */
export function evaluateFreshness(
  dimension: PerformanceDimension,
  lastObservedAt: string | null,
  policy: FreshnessPolicy,
  asOf: string,
): FreshnessAssessment {
  const windowMs = policy.windowsMs[dimension];
  if (lastObservedAt === null) {
    return Object.freeze({
      status: 'no-evidence',
      reasons: Object.freeze(['no-records-in-dimension']),
      windowMs,
    });
  }
  const observed = toPerformanceTimestamp(lastObservedAt, 'freshness lastObservedAt');
  const projectionTime = toPerformanceTimestamp(asOf, 'freshness asOf');
  const ageMs = Date.parse(projectionTime) - Date.parse(observed);
  if (ageMs < 0) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `freshness: asOf (${projectionTime}) precedes the last observation (${observed}) — projection times cannot run backwards`,
      details: { asOf: projectionTime, lastObservedAt: observed },
    });
  }
  if (ageMs > windowMs) {
    return Object.freeze({
      status: 'stale',
      reasons: Object.freeze([
        `staleness-window-elapsed:${String(windowMs)}ms`,
        `age:${String(ageMs)}ms`,
      ]),
      windowMs,
    });
  }
  return Object.freeze({
    status: 'fresh',
    reasons: Object.freeze([`within-staleness-window:${String(windowMs)}ms`]),
    windowMs,
  });
}

/** Validate an injected projection time (determinism anchor). */
export function toProjectionTimestamp(value: string, field: string): PerformanceTimestamp {
  return toPerformanceTimestamp(value, field);
}
