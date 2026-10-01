/**
 * PERF1.0 primitives (Work Order A036).
 */

/** Wire version of every performance-suite record. */
export const PERF_SUITE_VERSION = 1 as const;

/** Closed load-shape vocabulary. */
export const LOAD_SHAPE_IDS = Object.freeze([
  'steady-baseline',
  'fault-injection',
  'sparse-no-data',
] as const);
export type LoadShapeId = (typeof LOAD_SHAPE_IDS)[number];

export function isLoadShapeId(value: unknown): value is LoadShapeId {
  return (
    typeof value === 'string' &&
    (LOAD_SHAPE_IDS as readonly string[]).includes(value)
  );
}

/** Closed suite verdicts. */
export const PERF_SUITE_VERDICTS = Object.freeze(['pass', 'fail'] as const);
export type PerfSuiteVerdict = (typeof PERF_SUITE_VERDICTS)[number];

export const PERF_ERROR_CODES = Object.freeze({
  INVALID_LOAD_SHAPE: 'PERF_INVALID_LOAD_SHAPE',
  INVALID_EVIDENCE: 'PERF_INVALID_EVIDENCE',
} as const);
export type PerfErrorCode = (typeof PERF_ERROR_CODES)[keyof typeof PERF_ERROR_CODES];

export class PerfError extends Error {
  readonly code: PerfErrorCode;
  constructor(code: PerfErrorCode, detail: string) {
    super(`[${code}] ${detail}`);
    this.name = 'PerfError';
    this.code = code;
  }
}
