/**
 * Research-protocol error codes (Work Order A030). Closed registry;
 * the failure modes of every research constructor and ledger
 * operation, mirroring the A012/A013/A014 error registries.
 */

export const RESEARCH_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'RESEARCH_INVALID_IDENTITY',
  INVALID_DIGEST: 'RESEARCH_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'RESEARCH_INVALID_TIMESTAMP',
  INVALID_TEXT: 'RESEARCH_INVALID_TEXT',
  INVALID_SCHEMA_REF: 'RESEARCH_INVALID_SCHEMA_REF',
  INVALID_METHODOLOGY: 'RESEARCH_INVALID_METHODOLOGY',
  INVALID_DESCRIPTOR: 'RESEARCH_INVALID_DESCRIPTOR',
  INVALID_RESULT: 'RESEARCH_INVALID_RESULT',
  INVALID_PROVENANCE: 'RESEARCH_INVALID_PROVENANCE',
  INVALID_PINS: 'RESEARCH_INVALID_PINS',
  TAMPERED: 'RESEARCH_TAMPERED',
  NOT_FOUND: 'RESEARCH_NOT_FOUND',
  DUPLICATE_IDENTITY: 'RESEARCH_DUPLICATE_IDENTITY',
  NON_MONOTONIC: 'RESEARCH_NON_MONOTONIC',
  INVALID_TRANSITION: 'RESEARCH_INVALID_TRANSITION',
} as const);

export type ResearchErrorCode =
  (typeof RESEARCH_ERROR_CODES)[keyof typeof RESEARCH_ERROR_CODES];

export function isResearchErrorCode(value: unknown): value is ResearchErrorCode {
  return (
    typeof value === 'string' &&
    (Object.values(RESEARCH_ERROR_CODES) as readonly string[]).includes(value)
  );
}

/** Structured init shape for ResearchError (mirrors A012/A014). */
export interface ResearchErrorInit {
  readonly message: string;
  readonly details?: unknown;
  readonly cause?: unknown;
}

/** The typed error of the research protocol layer. */
export class ResearchError extends Error {
  readonly code: ResearchErrorCode;
  readonly details: unknown;

  constructor(code: ResearchErrorCode, init: ResearchErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ResearchError';
    this.code = code;
    this.details = init.details ?? null;
  }
}

export function isResearchError(value: unknown): value is ResearchError {
  return value instanceof ResearchError;
}
