/**
 * Typed errors for @arena/workbench (Work Order A017).
 *
 * The workbench renders DOMAIN records it did not build; a malformed or
 * hostile record must surface as a TYPED, fail-closed error — never as a
 * crash, never as a silently empty page (failing loudly beats false
 * green). Every code is a closed-vocabulary string of the shape
 * `workbench/<surface>` naming the exact domain surface that failed the
 * structural check.
 */

/** Closed error-code vocabulary (tests + README mirror it). */
export const WORKBENCH_ERROR_CODES = Object.freeze({
  INVALID_EXPERT_PROFILE: 'workbench/invalid-expert-profile',
  INVALID_COMPETENCY_CLAIM: 'workbench/invalid-competency-claim',
  INVALID_QUALIFICATION_RECORD: 'workbench/invalid-qualification-record',
  INVALID_MATCH_RESULT: 'workbench/invalid-match-result',
  INVALID_TASK_SPEC: 'workbench/invalid-task-spec',
  INVALID_COMPILATION_RECORD: 'workbench/invalid-compilation-record',
  INVALID_TRAJECTORY_RECORD: 'workbench/invalid-trajectory-record',
  INVALID_JOB_RECORD: 'workbench/invalid-job-record',
  INVALID_SUPPLY_STATE: 'workbench/invalid-supply-state',
  INVALID_DEGRADATION_INPUT: 'workbench/invalid-degradation-input',
  INVALID_CORPUS: 'workbench/invalid-corpus',
} as const);

export type WorkbenchErrorCode = (typeof WORKBENCH_ERROR_CODES)[keyof typeof WORKBENCH_ERROR_CODES];

/** Structured details carried on every workbench error. */
export interface WorkbenchErrorDetails {
  readonly surface: string;
  readonly index?: number;
  readonly [key: string]: unknown;
}

/** The typed error every workbench surface throws on malformed input. */
export class WorkbenchError extends Error {
  readonly code: WorkbenchErrorCode;
  readonly details: WorkbenchErrorDetails;

  constructor(code: WorkbenchErrorCode, details: WorkbenchErrorDetails) {
    const surface = details.surface;
    super(`${code}: ${surface} failed the structural check (workbench renders only validated domain records; no partial views are invented)`, {
      cause: undefined,
    });
    this.name = 'WorkbenchError';
    this.code = code;
    this.details = details;
  }
}

/** True iff the value is a workbench error with a known code. */
export function isWorkbenchError(value: unknown): value is WorkbenchError {
  return (
    value instanceof WorkbenchError &&
    (Object.values(WORKBENCH_ERROR_CODES) as readonly string[]).includes(value.code)
  );
}
