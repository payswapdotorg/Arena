/**
 * Economics policy surfaces (Work Order C016) — the versioned,
 * deterministic policy records that govern the economic VIEW.
 *
 * THE SCOPE LAW: fee-split FORMULAS stay C010-owned (@arena/payments
 * FeeSchedule — never redefined here); this surface models the
 * economics-side view parameters: which unit-economics metrics are
 * disclosable, the small-sample threshold that keeps sparse aggregates
 * explicitly flagged, and the disclosure note every aggregate carries.
 *
 * THE SUPERSESSION LAW: a policy change is a NEW version of the same
 * policy identity, produced only through `supersedeEconomicsPolicy`
 * (next.version MUST be current.version + 1) — never a silent
 * restatement of an existing version. Policies are deterministic given
 * identical inputs and deep-frozen.
 */

import { CAPABILITY_ECONOMICS_ERROR_CODES, CapabilityEconomicsError } from './errors.js';
import type { EconomicsPolicyId } from './shared.js';
import { isEconomicsPolicyId, toEconomicsPolicyId } from './shared.js';
import { rejectCollapsedScoreFields, rejectUnknownFields } from './shared.js';

/** Wire version of the economics-policy shape. */
export const ECONOMICS_POLICY_VERSION = 1 as const;

/** The closed metric vocabulary the view may disclose (single-metric aggregates only). */
export const ECONOMICS_METRICS = Object.freeze([
  'mean-net-cost-per-intervention',
  'cost-per-validated-result',
  'expert-payout-share-of-gross',
  'mean-effort-minutes-per-intervention',
  'verified-lift-per-effort-hour',
] as const);
export type EconomicsMetric = (typeof ECONOMICS_METRICS)[number];

export function isEconomicsMetric(value: unknown): value is EconomicsMetric {
  return typeof value === 'string' && (ECONOMICS_METRICS as readonly string[]).includes(value);
}

export interface EconomicsPolicy {
  readonly policyVersion: typeof ECONOMICS_POLICY_VERSION;
  readonly policyId: EconomicsPolicyId;
  /** Supersession version — 1-based, strictly increasing per policy identity. */
  readonly version: number;
  /** Aggregates with fewer observations than this are flagged small-sample. */
  readonly smallSampleMinimum: number;
  /** The metrics this policy allows to be disclosed (subset of the closed vocabulary). */
  readonly metricAllowList: readonly EconomicsMetric[];
  /** The disclosure note every aggregate generated under this policy carries. */
  readonly disclosureNote: string;
}

export const ECONOMICS_POLICY_FIELDS = Object.freeze([
  'policyVersion',
  'policyId',
  'version',
  'smallSampleMinimum',
  'metricAllowList',
  'disclosureNote',
] as const);

export function isEconomicsPolicy(value: unknown): value is EconomicsPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['policyVersion'] !== ECONOMICS_POLICY_VERSION) return false;
  if (!isEconomicsPolicyId(candidate['policyId'])) return false;
  if (
    typeof candidate['version'] !== 'number' ||
    !Number.isInteger(candidate['version']) ||
    candidate['version'] < 1
  ) {
    return false;
  }
  if (
    typeof candidate['smallSampleMinimum'] !== 'number' ||
    !Number.isInteger(candidate['smallSampleMinimum']) ||
    candidate['smallSampleMinimum'] < 1
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['metricAllowList']) ||
    candidate['metricAllowList'].length === 0 ||
    !candidate['metricAllowList'].every(isEconomicsMetric)
  ) {
    return false;
  }
  if (typeof candidate['disclosureNote'] !== 'string' || candidate['disclosureNote'].length < 1) {
    return false;
  }
  rejectUnknownFields(candidate, ECONOMICS_POLICY_FIELDS, 'EconomicsPolicy');
  rejectCollapsedScoreFields(candidate, 'EconomicsPolicy');
  return true;
}

/** Validate and freeze an economics policy (strict, fail-closed). */
export function toEconomicsPolicy(value: EconomicsPolicy): EconomicsPolicy {
  if (!isEconomicsPolicy(value)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_POLICY, {
      message: `not an EconomicsPolicy: ${JSON.stringify(value)} (policyId ${'[a-z][a-z0-9-]{1,62}'}, version >= 1, smallSampleMinimum >= 1, non-empty metricAllowList subset of the closed metric vocabulary, non-empty disclosureNote)`,
    });
  }
  return Object.freeze({
    ...value,
    policyId: toEconomicsPolicyId(value.policyId),
    metricAllowList: Object.freeze([...value.metricAllowList]),
  });
}

/**
 * The deterministic reference policy shipped with the domain. Hosts may
 * inject their own; production economics policy is a commercial decision
 * recorded at the composition root.
 */
export const ARENA_REFERENCE_ECONOMICS_POLICY: EconomicsPolicy = Object.freeze({
  policyVersion: ECONOMICS_POLICY_VERSION,
  policyId: toEconomicsPolicyId('arena-economics-reference'),
  version: 1,
  smallSampleMinimum: 30,
  metricAllowList: Object.freeze([...ECONOMICS_METRICS]),
  disclosureNote:
    'Deterministic dimensional unit-economics view over C010 commercial truth; single-metric aggregates with formula, sample size, small-sample status and known limitations; no collapsed ROI score (Q1.0: verified capability gain per unit of expert effort).',
} as EconomicsPolicy);

/**
 * Supersede a policy with its next version. The next version MUST carry
 * the same policy identity and version = current + 1; the current policy
 * is never mutated — supersession is by construction, never a silent
 * restatement.
 */
export function supersedeEconomicsPolicy(
  current: EconomicsPolicy,
  next: EconomicsPolicy,
): EconomicsPolicy {
  if (!isEconomicsPolicy(current) || !isEconomicsPolicy(next)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_POLICY, {
      message: 'policy supersession requires two structurally valid EconomicsPolicy records',
    });
  }
  if (next.policyId !== current.policyId) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.SUPERSESSION_VIOLATION, {
      message: `policy identity change is not a supersession: ${current.policyId} -> ${next.policyId} (a new identity is a NEW policy, not a version bump)`,
      details: { from: current.policyId, to: next.policyId },
    });
  }
  if (next.version !== current.version + 1) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.SUPERSESSION_VIOLATION, {
      message: `policy ${current.policyId} supersession must advance the version by exactly one: ${current.version} -> ${next.version} (never a silent restatement of an existing version)`,
      details: { from: current.version, to: next.version },
    });
  }
  return Object.freeze({ ...next });
}
