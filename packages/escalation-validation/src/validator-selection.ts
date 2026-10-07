/**
 * Validator selection (Work Order C009; issue #116; C005 seam).
 *
 * Adjudication needs a VALIDATOR (the expert who judges the submission
 * when the plan's evaluation stage is expert-driven, and/or reviews the
 * evidence on expert-review verification). Selection CONSULTS the C005
 * dimensional evidence profile — competency by skill and agreement
 * patterns — through host-wired validator candidates that carry the C005
 * routing-lens projections (same discipline as C002's
 * RoutingCandidateDirectory: the service never imports a service).
 *
 * DEMONSTRATED PERFORMANCE IS INPUT TO SELECTION, NEVER AUTHORIZATION
 * (architecture-lock rule 35): the selection result is DATA — a record
 * of who was selected and why — and there is no code path through
 * which a selection grants access, authority or certification.
 *
 * CONFLICT-OF-INTEREST EXCLUSION IS AN EXPLICIT TESTED FILTER: the
 * submitting expert and any listed COI expert can NEVER be selected,
 * and every exclusion is reported with a machine-readable reason.
 *
 * Selection is DETERMINISTIC given identical inputs: candidates rank
 * by (fresh competency evidence volume for the required skills, then
 * total sample size, then expert ref — a stable total order).
 */

import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from './errors.js';
import { deepFreeze } from './shared.js';
import { requireBoundedString } from './shared.js';

/** Wire version of the validator-selection shapes. */
export const VALIDATOR_SELECTION_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Validator candidates (C005 dimensional evidence projections)
// ---------------------------------------------------------------------------

/** One skill-competency dimensional summary (the C005 projection). */
export interface ValidatorCompetency {
  readonly skill: string;
  /** Evidence records folded into the dimension (>= 0). */
  readonly evidenceRecords: number;
  readonly totalSampleSize: number;
  /** The dimension's latest outcome (C005 outcome vocabulary string). */
  readonly latestOutcome: string | null;
  /** Freshness flag (stale evidence must not outrank fresh). */
  readonly stale: boolean;
}

/** The agreement-pattern dimensional summary (the C005 projection). */
export interface ValidatorAgreement {
  readonly agreements: number;
  readonly disagreements: number;
}

export interface ValidatorCandidate {
  readonly candidateVersion: typeof VALIDATOR_SELECTION_VERSION;
  readonly expertRef: string;
  /** Owning tenant ('public' = the reserved global scope, C002 precedent). */
  readonly tenant: string;
  /** Skill-competency evidence by skill (C005 dimensional projection). */
  readonly competency: readonly ValidatorCompetency[];
  /** Agreement-pattern evidence (C005 dimensional projection; null = none). */
  readonly agreement: ValidatorAgreement | null;
}

export const VALIDATOR_CANDIDATE_FIELDS = Object.freeze([
  'candidateVersion',
  'expertRef',
  'tenant',
  'competency',
  'agreement',
] as const);

export interface CreateValidatorCandidateInput {
  readonly expertRef: string;
  readonly tenant: string;
  readonly competency: readonly {
    readonly skill: string;
    readonly evidenceRecords: number;
    readonly totalSampleSize: number;
    readonly latestOutcome?: string | null;
    readonly stale?: boolean;
  }[];
  readonly agreement?: { readonly agreements: number; readonly disagreements: number } | null;
}

/** Create and freeze one validator candidate (strict, fail-closed). */
export function createValidatorCandidate(
  input: CreateValidatorCandidateInput,
): ValidatorCandidate {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: 'validator candidate input must be an object',
    });
  }
  requireBoundedString(input.expertRef, 'expertRef');
  requireBoundedString(input.tenant, 'tenant');
  if (!Array.isArray(input.competency)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: 'competency must be an array of dimensional summaries',
    });
  }
  const competency = input.competency.map((entry) => {
    requireBoundedString(entry.skill, 'competency.skill');
    if (
      typeof entry.evidenceRecords !== 'number' ||
      !Number.isInteger(entry.evidenceRecords) ||
      entry.evidenceRecords < 0
    ) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
        message: `competency.evidenceRecords must be an integer >= 0 (${entry.skill})`,
      });
    }
    if (
      typeof entry.totalSampleSize !== 'number' ||
      !Number.isInteger(entry.totalSampleSize) ||
      entry.totalSampleSize < 0
    ) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
        message: `competency.totalSampleSize must be an integer >= 0 (${entry.skill})`,
      });
    }
    return deepFreeze({
      skill: entry.skill,
      evidenceRecords: entry.evidenceRecords,
      totalSampleSize: entry.totalSampleSize,
      latestOutcome: entry.latestOutcome === undefined ? null : entry.latestOutcome,
      stale: entry.stale === undefined ? false : entry.stale,
    });
  });
  return deepFreeze({
    candidateVersion: VALIDATOR_SELECTION_VERSION,
    expertRef: input.expertRef,
    tenant: input.tenant,
    competency: Object.freeze(competency),
    agreement:
      input.agreement === undefined || input.agreement === null
        ? null
        : deepFreeze({
            agreements: input.agreement.agreements,
            disagreements: input.agreement.disagreements,
          }),
  });
}

// ---------------------------------------------------------------------------
// Selection (typed outcome, COI filter closure, deterministic order)
// ---------------------------------------------------------------------------

/** The closed validator-exclusion reason vocabulary. */
export const VALIDATOR_EXCLUSION_REASONS = Object.freeze([
  'cross-tenant',
  'conflict-of-interest',
  'no-competency-evidence',
  'stale-evidence-only',
] as const);
export type ValidatorExclusionReason = (typeof VALIDATOR_EXCLUSION_REASONS)[number];

export const VALIDATOR_SELECTION_OUTCOMES = Object.freeze(['selected', 'no-validator'] as const);
export type ValidatorSelectionOutcomeKind = (typeof VALIDATOR_SELECTION_OUTCOMES)[number];

export interface ValidatorSelectionInput {
  readonly requestId: string;
  readonly tenantId: string;
  /** The expert whose submission is being adjudicated (COI source). */
  readonly submittingExpertRef: string | null;
  /** Additional COI-excluded expert refs (explicit, tested filter). */
  readonly coiExpertRefs: readonly string[];
  /** The skills the plan's validator profile requires (>= 1). */
  readonly requiredSkills: readonly string[];
}

export type ValidatorSelectionResult =
  | {
      readonly outcome: 'selected';
      readonly selectionVersion: typeof VALIDATOR_SELECTION_VERSION;
      readonly validator: ValidatorCandidate;
      readonly rank: number;
      readonly considered: number;
      readonly exclusions: readonly {
        readonly expertRef: string;
        readonly reason: ValidatorExclusionReason;
      }[];
    }
  | {
      readonly outcome: 'no-validator';
      readonly selectionVersion: typeof VALIDATOR_SELECTION_VERSION;
      readonly considered: number;
      readonly exclusions: readonly {
        readonly expertRef: string;
        readonly reason: ValidatorExclusionReason;
      }[];
    };

/**
 * Select the adjudicating validator. TYPED CLOSED OUTCOME — never a bare
 * boolean — with the full exclusion ledger (the COI filter is closure-
 * tested: the submitting expert can never appear in the selected
 * result, whatever the candidate order).
 *
 * DETERMINISTIC: rank key is (fresh competency evidence volume over the
 * required skills DESC, total sample size DESC, expert ref ASC).
 */
export function selectValidator(
  candidates: readonly ValidatorCandidate[],
  input: ValidatorSelectionInput,
): ValidatorSelectionResult {
  requireBoundedString(input.requestId, 'input.requestId');
  requireBoundedString(input.tenantId, 'input.tenantId');
  const coi = new Set<string>([
    ...(input.submittingExpertRef !== null ? [input.submittingExpertRef] : []),
    ...input.coiExpertRefs,
  ]);

  const exclusions: { expertRef: string; reason: ValidatorExclusionReason }[] = [];
  const eligible: ValidatorCandidate[] = [];
  for (const candidate of candidates) {
    // TENANT GUARD (defense in depth — the host directory is the first).
    if (candidate.tenant !== input.tenantId && candidate.tenant !== 'public') {
      exclusions.push({ expertRef: candidate.expertRef, reason: 'cross-tenant' });
      continue;
    }
    // THE COI FILTER (explicit, tested): the submitting expert and any
    // listed COI expert are excluded — never selected, never ranked.
    if (coi.has(candidate.expertRef)) {
      exclusions.push({ expertRef: candidate.expertRef, reason: 'conflict-of-interest' });
      continue;
    }
    const relevant = candidate.competency.filter((entry) =>
      (input.requiredSkills as readonly string[]).includes(entry.skill),
    );
    if (relevant.length === 0) {
      exclusions.push({ expertRef: candidate.expertRef, reason: 'no-competency-evidence' });
      continue;
    }
    const fresh = relevant.filter((entry) => !entry.stale);
    if (fresh.length === 0) {
      exclusions.push({ expertRef: candidate.expertRef, reason: 'stale-evidence-only' });
      continue;
    }
    eligible.push(candidate);
  }

  const ledger = Object.freeze(exclusions.map((entry) => deepFreeze(entry)));
  if (eligible.length === 0) {
    return deepFreeze({
      outcome: 'no-validator',
      selectionVersion: VALIDATOR_SELECTION_VERSION,
      considered: candidates.length,
      exclusions: ledger,
    });
  }

  const ranked = [...eligible].sort((left, right) => {
    const leftVolume = competencyVolume(left, input.requiredSkills);
    const rightVolume = competencyVolume(right, input.requiredSkills);
    if (leftVolume !== rightVolume) return rightVolume - leftVolume;
    const leftSamples = totalSampleSize(left, input.requiredSkills);
    const rightSamples = totalSampleSize(right, input.requiredSkills);
    if (leftSamples !== rightSamples) return rightSamples - leftSamples;
    return left.expertRef.localeCompare(right.expertRef);
  });
  const validator = ranked[0];
  if (validator === undefined) {
    // Unreachable (eligible.length > 0) — kept for noUncheckedIndexedAccess.
    return deepFreeze({
      outcome: 'no-validator',
      selectionVersion: VALIDATOR_SELECTION_VERSION,
      considered: candidates.length,
      exclusions: ledger,
    });
  }
  return deepFreeze({
    outcome: 'selected',
    selectionVersion: VALIDATOR_SELECTION_VERSION,
    validator,
    rank: 1,
    considered: candidates.length,
    exclusions: ledger,
  });
}

function competencyVolume(
  candidate: ValidatorCandidate,
  requiredSkills: readonly string[],
): number {
  return candidate.competency
    .filter((entry) => (requiredSkills as readonly string[]).includes(entry.skill) && !entry.stale)
    .reduce((sum, entry) => sum + entry.evidenceRecords, 0);
}

function totalSampleSize(
  candidate: ValidatorCandidate,
  requiredSkills: readonly string[],
): number {
  return candidate.competency
    .filter((entry) => (requiredSkills as readonly string[]).includes(entry.skill) && !entry.stale)
    .reduce((sum, entry) => sum + entry.totalSampleSize, 0);
}

/**
 * The authority-discipline guard: PERFORMANCE EVIDENCE IS DATA, NEVER
 * AUTHORIZATION (lock rule 35). This function EXISTS to be tested to
 * have NO happy path — consuming a selection as an access grant must
 * fail closed. (House pattern: @arena/expert-performance's
 * consumeProfileAsGlobalScore.)
 */
export function consumeSelectionAsAuthorization(
  _selection: ValidatorSelectionResult,
): { readonly granted: false; readonly reason: 'selection-is-not-authorization' } {
  return deepFreeze({
    granted: false as const,
    reason: 'selection-is-not-authorization',
  });
}
