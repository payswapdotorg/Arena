/**
 * The graceful-degradation model for @arena/workbench (Work Order A017,
 * requirement R41: "Graceful degradation when expert supply is
 * unavailable").
 *
 * EVERY view-model carries an explicit, typed `degradation` state:
 *   - `degraded: false` — the section's live source was available;
 *   - `degraded: true`  — the section is serving LAST-KNOWN state (or an
 *     honest empty listing when nothing is known) and carries at least
 *     one machine-readable reason from the closed vocabulary below.
 *
 * THE NO-INVENTED-DATA RULE: a degraded view NEVER fabricates records,
 * counts or statuses to look healthier than the last-known state; it
 * renders exactly the records it was handed, plus the degradation banner
 * and a refresh affordance (see render.ts). An unavailable expert supply
 * with no last-known directory renders an EMPTY directory plus the
 * degradation banner — never placeholder experts.
 *
 * Degradation is DATA carried on the corpus's per-section supply state
 * (see corpus.ts); deriving it there — instead of hand-setting flags per
 * page — keeps every view's degraded mode consistent with the corpus it
 * was derived from, deterministically.
 */

import { WORKBENCH_ERROR_CODES, WorkbenchError } from './errors.js';
import { deepFreeze } from './freeze.js';

/**
 * The closed degradation-reason vocabulary. Codes are stable
 * machine-readable identifiers; the human-readable `detail` travels
 * beside them (escaped at render time).
 */
export const DEGRADATION_REASON_CODES = Object.freeze([
  /** R41: the expert supply (registry + qualification/matching) is unavailable. */
  'expert-supply-unavailable',
  /** The expert registry itself could not be read. */
  'expert-registry-unavailable',
  /** Qualification records (A007) could not be read. */
  'qualification-records-unavailable',
  /** The matching flow (A007/A008) could not run; results are last-known. */
  'matching-unavailable',
  /** The task queue (A008 specs/compilations) is unavailable. */
  'task-queue-unavailable',
  /** The task compiler (A008 service) is unavailable. */
  'task-compiler-unavailable',
  /** The trajectory store (A011) is unavailable. */
  'trajectory-store-unavailable',
  /** The job store (A015) is unavailable. */
  'job-store-unavailable',
  /** The rendered data is a last-known snapshot, not live state. */
  'last-known-state',
] as const);

export type DegradationReasonCode = (typeof DEGRADATION_REASON_CODES)[number];

/** True iff the value is a member of the closed reason vocabulary. */
export function isDegradationReasonCode(value: unknown): value is DegradationReasonCode {
  return (
    typeof value === 'string' &&
    (DEGRADATION_REASON_CODES as readonly string[]).includes(value)
  );
}

/** One machine-readable degradation reason with a human-readable detail. */
export interface DegradationReason {
  readonly code: DegradationReasonCode;
  readonly detail: string;
}

/** The explicit degraded mode carried by EVERY workbench view-model. */
export interface DegradationState {
  readonly degraded: boolean;
  readonly reasons: readonly DegradationReason[];
}

/** Structural (non-throwing) check for one reason. */
export function isDegradationReason(value: unknown): value is DegradationReason {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isDegradationReasonCode(candidate['code']) &&
    typeof candidate['detail'] === 'string' &&
    candidate['detail'].length > 0
  );
}

/** Structural (non-throwing) check for a whole degradation state. */
export function isDegradationState(value: unknown): value is DegradationState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['degraded'] !== 'boolean') return false;
  if (!Array.isArray(candidate['reasons'])) return false;
  if (!candidate['reasons'].every((reason) => isDegradationReason(reason))) return false;
  const reasons = candidate['reasons'] as readonly DegradationReason[];
  if (candidate['degraded'] === false) return reasons.length === 0;
  // A degraded state carries at least one reason, and `last-known-state`
  // is a QUALIFIER: it may only appear together with a cause reason
  // naming what is unavailable.
  if (reasons.length === 0) return false;
  return reasons.some((reason) => reason.code !== 'last-known-state');
}

/** The healthy state: not degraded, no reasons (a frozen singleton). */
export function noDegradation(): DegradationState {
  return HEALTHY;
}

const HEALTHY: DegradationState = deepFreeze({ degraded: false, reasons: [] });

/**
 * Build a validated, deep-frozen degraded mode from explicit reasons.
 * Throws a typed INVALID_DEGRADATION_INPUT error on unknown codes, empty
 * details, an empty reason list, or a `last-known-state` reason without a
 * cause (fail loudly rather than render a misleading banner).
 */
export function degradationMode(
  reasons: readonly { code: string; detail: string }[],
): DegradationState {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT, {
      surface: 'degradation mode',
      message: 'a degraded mode requires at least one reason (no silent degradation)',
    });
  }
  const validated: DegradationReason[] = reasons.map((reason, index) => {
    if (typeof reason !== 'object' || reason === null) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT, {
        surface: 'degradation reason',
        index,
        message: 'a degradation reason must be { code, detail }',
      });
    }
    if (!isDegradationReasonCode(reason.code)) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT, {
        surface: 'degradation reason',
        index,
        code: String(reason.code),
        message: `unknown degradation reason code (closed vocabulary: ${DEGRADATION_REASON_CODES.join(', ')})`,
      });
    }
    if (typeof reason.detail !== 'string' || reason.detail.length === 0) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT, {
        surface: 'degradation reason',
        index,
        code: reason.code,
        message: 'a degradation reason requires a non-empty detail',
      });
    }
    return { code: reason.code, detail: reason.detail };
  });
  const hasCause = validated.some((reason) => reason.code !== 'last-known-state');
  if (!hasCause) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT, {
      surface: 'degradation mode',
      message:
        "the 'last-known-state' reason qualifies a cause; it cannot be the only reason (name what is unavailable)",
    });
  }
  return deepFreeze({ degraded: true, reasons: validated });
}

/**
 * Merge degradation states (the overview aggregates sections): healthy
 * sections contribute nothing; degraded sections contribute their
 * reasons. The result is healthy iff every input was healthy.
 */
export function mergeDegradation(states: readonly DegradationState[]): DegradationState {
  const degraded = states.some((state) => state.degraded);
  if (!degraded) return HEALTHY;
  const reasons: DegradationReason[] = [];
  for (const state of states) {
    for (const reason of state.reasons) {
      if (!reasons.some((entry) => entry.code === reason.code && entry.detail === reason.detail)) {
        reasons.push(reason);
      }
    }
  }
  return deepFreeze({ degraded: true, reasons });
}
