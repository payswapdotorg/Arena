/**
 * The requalification policy + typed status-transition proposals (Work
 * Order C004; spec/evaluation.md EV1.0 "recertification policy";
 * spec/quality-model.md certification levels as LIFECYCLE STATES).
 *
 * Requalification declares freshness windows and CLOSED trigger
 * vocabulary (time, drift verdict, domain-pack change, dispute). When a
 * trigger fires, expiry produces a TYPED status-transition proposal in
 * the A007 qualification vocabulary:
 *
 *   - `time-window-elapsed`        → proposed status `expired`
 *     (the validity window lapsed — decay, nothing wrong);
 *   - `drift-verdict` (non-calibrated) → `stale` for decay-shaped
 *     verdicts (stale / insufficient-sample) and `revoked` for
 *     demonstrated-misjudgement verdicts (overconfident / underconfident);
 *   - `domain-pack-change`         → proposed status `expired`
 *     (the applicability context changed — prior evidence no longer
 *     applies; the expert must requalify under the new pack);
 *   - `dispute-raised`             → proposed status `stale`
 *     (evidence under dispute — not trusted until re-established).
 *
 * QUALITY-MODEL REVOKED LAW: revocation is a TRANSITION, history remains
 * auditable — proposals carry the prior qualification record digest they
 * transition FROM, and never rewrite it.
 *
 * PROPOSAL, NEVER A WRITE (spec/service-boundaries.md; lock rule 9):
 * enforcement of the transition belongs to the A007/routing consumers.
 * `deriveRequalificationProposal` is PURE: (state, trigger, at) → typed
 * proposal view — no clock reads (`at` is injected), no A007 state is
 * touched.
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  toCalibrationNeutralText,
  toCalibrationTimestamp,
} from './shared.js';
import type { CalibrationNeutralText, CalibrationTimestamp } from './shared.js';
import type { DriftVerdictKind } from './verdict.js';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The CLOSED requalification trigger vocabulary. */
export const REQUALIFICATION_TRIGGERS = Object.freeze([
  'time-window-elapsed',
  'drift-verdict',
  'domain-pack-change',
  'dispute-raised',
] as const);

export type RequalificationTrigger = (typeof REQUALIFICATION_TRIGGERS)[number];

export function isRequalificationTrigger(value: unknown): value is RequalificationTrigger {
  return (
    typeof value === 'string' &&
    (REQUALIFICATION_TRIGGERS as readonly string[]).includes(value)
  );
}

/**
 * The typed transition targets — a subset of the A007
 * QUALIFICATION_STATUSES vocabulary (data about the evidence lifecycle;
 * grants NOTHING — lock rule 9).
 */
export const REQUALIFICATION_TRANSITION_TARGETS = Object.freeze([
  'expired',
  'stale',
  'revoked',
] as const);

export type RequalificationTransitionTarget = (typeof REQUALIFICATION_TRANSITION_TARGETS)[number];

export function isRequalificationTransitionTarget(
  value: unknown,
): value is RequalificationTransitionTarget {
  return (
    typeof value === 'string' &&
    (REQUALIFICATION_TRANSITION_TARGETS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The policy (pure data — no behavior, no wall clocks)
// ---------------------------------------------------------------------------

/** Wire version of the requalification-policy shape. */
export const REQUALIFICATION_POLICY_VERSION = 1 as const;

/**
 * The requalification policy: freshness + validity windows and the armed
 * closed trigger set. Embedded BY VALUE in the content-addressed
 * CalibrationProgram (the program digest commits to it).
 */
export interface RequalificationPolicyView {
  readonly policyVersion: typeof REQUALIFICATION_POLICY_VERSION;
  /** How long observed calibration outcomes count as FRESH (days, >= 1). */
  readonly freshnessWindowDays: number;
  /** How long a qualification stays in force absent triggers (days, >= 1). */
  readonly validityWindowDays: number;
  /** The closed trigger set this policy arms (non-empty, deduplicated, sorted). */
  readonly triggers: readonly RequalificationTrigger[];
}

export interface CreateRequalificationPolicyInput {
  readonly freshnessWindowDays: number;
  readonly validityWindowDays: number;
  readonly triggers: readonly string[];
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Create a validated, deep-frozen requalification policy. Rejects
 * non-positive windows and unknown/duplicate-ignored triggers with typed
 * errors; the trigger list is deterministically sorted (seeded ordering
 * for reproducibility).
 */
export function createRequalificationPolicy(
  input: CreateRequalificationPolicyInput,
): RequalificationPolicyView {
  const record = expectFields(
    input,
    ['freshnessWindowDays', 'validityWindowDays', 'triggers'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY,
    'requalification policy',
  );
  if (!isPositiveInteger(record['freshnessWindowDays'])) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY, {
      message: `requalification policy: freshnessWindowDays must be an integer >= 1, got ${String(record['freshnessWindowDays'])}`,
    });
  }
  if (!isPositiveInteger(record['validityWindowDays'])) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY, {
      message: `requalification policy: validityWindowDays must be an integer >= 1, got ${String(record['validityWindowDays'])}`,
    });
  }
  const rawTriggers = record['triggers'];
  if (!Array.isArray(rawTriggers) || rawTriggers.length === 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY, {
      message: 'requalification policy: triggers must be a non-empty closed-trigger list',
    });
  }
  const triggers: RequalificationTrigger[] = [];
  for (const entry of rawTriggers) {
    if (!isRequalificationTrigger(entry)) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY, {
        message: `requalification policy: unknown trigger ${JSON.stringify(entry)} (closed vocabulary: ${REQUALIFICATION_TRIGGERS.join(', ')})`,
        details: { known: [...REQUALIFICATION_TRIGGERS] },
      });
    }
    if (!triggers.includes(entry)) triggers.push(entry);
  }
  // Deterministic order — the CANONICAL vocabulary order (seeded ordering
  // for reproducibility).
  triggers.sort(
    (a, b) => REQUALIFICATION_TRIGGERS.indexOf(a) - REQUALIFICATION_TRIGGERS.indexOf(b),
  );
  return deepFreeze({
    policyVersion: REQUALIFICATION_POLICY_VERSION,
    freshnessWindowDays: record['freshnessWindowDays'],
    validityWindowDays: record['validityWindowDays'],
    triggers: Object.freeze([...triggers]),
  });
}

/** True iff a qualification validity window covers `at` (PURE). */
export function isValidityInForce(validFrom: string, validUntil: string, at: string): boolean {
  const atMs = Date.parse(at);
  const fromMs = Date.parse(validFrom);
  const untilMs = Date.parse(validUntil);
  if (Number.isNaN(atMs) || Number.isNaN(fromMs) || Number.isNaN(untilMs)) return false;
  return atMs >= fromMs && atMs < untilMs;
}

// ---------------------------------------------------------------------------
// The typed status-transition proposal
// ---------------------------------------------------------------------------

/** Wire version of the requalification-proposal shape. */
export const REQUALIFICATION_PROPOSAL_VERSION = 1 as const;

export interface RequalificationProposalView {
  readonly proposalVersion: typeof REQUALIFICATION_PROPOSAL_VERSION;
  readonly tenant: string;
  readonly expertId: string;
  /** The capability the qualification transition is proposed FOR. */
  readonly capability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  /** The closed trigger that fired. */
  readonly trigger: RequalificationTrigger;
  /** The typed A007-vocabulary status the proposal transitions TO. */
  readonly proposedStatus: RequalificationTransitionTarget;
  /** The prior qualification record digest this transitions FROM (auditable history). */
  readonly priorRecordDigest: string | null;
  /** The drift verdict digest when trigger === 'drift-verdict' (else null). */
  readonly verdictDigest: string | null;
  readonly rationale: CalibrationNeutralText;
  readonly proposedAt: CalibrationTimestamp;
}

/** A frozen, content-addressed requalification proposal: view + digest. */
export interface RequalificationProposal extends RequalificationProposalView {
  readonly digest: string;
}

export interface DeriveRequalificationProposalInput {
  readonly tenant: string;
  readonly expertId: string;
  readonly capability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  /** The qualification state the check evaluates (A007 read data). */
  readonly qualification: {
    readonly validFrom: string;
    readonly validUntil: string;
    readonly priorRecordDigest: string | null;
  };
  /** The closed trigger that fired. */
  readonly trigger: RequalificationTrigger;
  /** The drift verdict kind when trigger === 'drift-verdict' (else undefined). */
  readonly driftVerdict?: DriftVerdictKind;
  /** The drift verdict digest when trigger === 'drift-verdict' (else undefined). */
  readonly verdictDigest?: string;
  readonly proposedAt: string;
}

/**
 * Derive the TYPED status-transition proposal for one fired trigger.
 * PURE and deterministic: (state, trigger, at) → proposal view. Fails
 * closed when the trigger is unknown, when a drift-verdict trigger
 * carries no verdict, or when a time-window trigger fires while the
 * qualification is still in force.
 *
 * Enforcement belongs to the A007/routing consumers — this is a PROPOSAL,
 * never a write.
 */
export function deriveRequalificationProposal(
  input: DeriveRequalificationProposalInput,
): RequalificationProposalView {
  const record = expectFields(
    input,
    ['tenant', 'expertId', 'capability', 'qualification', 'trigger', 'proposedAt'],
    ['driftVerdict', 'verdictDigest'],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL,
    'requalification proposal',
  );
  if (typeof record['tenant'] !== 'string' || record['tenant'].length === 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'requalification proposal requires a tenant',
    });
  }
  if (typeof record['expertId'] !== 'string' || record['expertId'].length === 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'requalification proposal requires an expertId',
    });
  }
  const trigger = record['trigger'];
  if (!isRequalificationTrigger(trigger)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
      message: `requalification proposal: unknown trigger ${JSON.stringify(trigger)}`,
      details: { known: [...REQUALIFICATION_TRIGGERS] },
    });
  }
  const proposedAt = toCalibrationTimestamp(
    typeof record['proposedAt'] === 'string' ? record['proposedAt'] : '',
    'requalification proposal proposedAt',
  );
  const qualification = expectFields(
    record['qualification'],
    ['validFrom', 'validUntil', 'priorRecordDigest'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL,
    'requalification proposal qualification',
  );
  const validFrom = qualification['validFrom'];
  const validUntil = qualification['validUntil'];
  if (typeof validFrom !== 'string' || typeof validUntil !== 'string') {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'requalification proposal qualification requires validFrom/validUntil timestamps',
    });
  }

  let proposedStatus: RequalificationTransitionTarget;
  let rationale: string;
  let verdictDigest: string | null = null;

  switch (trigger) {
    case 'time-window-elapsed': {
      if (isValidityInForce(validFrom, validUntil, proposedAt)) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT, {
          message: `time-window-elapsed trigger fired but the qualification is still in force at ${JSON.stringify(proposedAt)} (valid until ${JSON.stringify(validUntil)}) — nothing has decayed`,
          details: { proposedAt, validUntil },
        });
      }
      proposedStatus = 'expired';
      rationale =
        'qualification validity window elapsed - decay transition proposed (requalification required; history remains auditable)';
      break;
    }
    case 'drift-verdict': {
      const driftVerdict = record['driftVerdict'];
      const verdictKinds: readonly string[] = [
        'calibrated',
        'overconfident',
        'underconfident',
        'insufficient-sample',
        'stale',
      ];
      if (typeof driftVerdict !== 'string' || !verdictKinds.includes(driftVerdict)) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
          message: `drift-verdict trigger requires a valid drift verdict kind, got: ${String(driftVerdict)}`,
          details: { known: verdictKinds },
        });
      }
      const rawVerdictDigest = record['verdictDigest'];
      if (typeof rawVerdictDigest !== 'string' || !/^[0-9a-f]{64}$/.test(rawVerdictDigest)) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
          message: 'drift-verdict trigger requires the drift verdict digest it fired on',
        });
      }
      verdictDigest = rawVerdictDigest;
      if (driftVerdict === 'overconfident' || driftVerdict === 'underconfident') {
        proposedStatus = 'revoked';
        rationale = `drift verdict ${driftVerdict}: demonstrated prediction-vs-outcome misjudgement - revocation transition proposed (a transition, history remains auditable)`;
      } else {
        proposedStatus = 'stale';
        rationale = `drift verdict ${driftVerdict}: calibration evidence decayed below the declared sample/freshness floor - staleness transition proposed`;
      }
      break;
    }
    case 'domain-pack-change': {
      proposedStatus = 'expired';
      rationale =
        'domain-pack change: applicability context moved - prior qualification evidence no longer applies (requalification under the new pack required)';
      break;
    }
    case 'dispute-raised': {
      proposedStatus = 'stale';
      rationale =
        'dispute raised against qualification evidence: not trusted until re-established by requalification (staleness transition proposed)';
      break;
    }
  }

  const priorRecordDigestRaw = qualification['priorRecordDigest'];
  const priorRecordDigest =
    typeof priorRecordDigestRaw === 'string' && /^[0-9a-f]{64}$/.test(priorRecordDigestRaw)
      ? priorRecordDigestRaw
      : null;

  return deepFreeze({
    proposalVersion: REQUALIFICATION_PROPOSAL_VERSION,
    tenant: record['tenant'],
    expertId: record['expertId'],
    capability: deepFreeze({ ...(record['capability'] as Record<string, unknown>) }) as RequalificationProposalView['capability'],
    trigger,
    proposedStatus,
    priorRecordDigest,
    verdictDigest,
    rationale: toCalibrationNeutralText(rationale, 'requalification proposal rationale'),
    proposedAt,
  });
}

/**
 * Content-address a derived requalification proposal: computes the sha256
 * digest over the digest-free view and returns the frozen proposal.
 */
export async function createRequalificationProposal(
  view: RequalificationProposalView,
): Promise<RequalificationProposal> {
  const digest = await digestCanonical(requalificationProposalViewOf(view));
  return deepFreeze({ ...view, digest }) as RequalificationProposal;
}

/** The digest-free view of a proposal (what the digest commits to). */
export function requalificationProposalViewOf(
  proposal: RequalificationProposalView,
): Record<string, unknown> {
  const { ...view } = proposal;
  return { ...view } as unknown as Record<string, unknown>;
}

/** The digest-free view of a full proposal (digest stripped). */
export function requalificationProposalView(
  proposal: RequalificationProposal,
): RequalificationProposalView {
  const { digest: _digest, ...view } = proposal;
  return deepFreeze({ ...view }) as RequalificationProposalView;
}
