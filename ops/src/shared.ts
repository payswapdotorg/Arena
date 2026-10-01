/**
 * OPS1.0 primitives: closed vocabularies and typed errors for the
 * operational tooling surface (Work Order A036).
 */

/** Wire version of every ops record. */
export const OPS_SCHEMA_VERSION = 1 as const;

/** Closed checklist-item kinds. */
export const CHECKLIST_ITEM_KINDS = Object.freeze(['required', 'advisory'] as const);
export type ChecklistItemKind = (typeof CHECKLIST_ITEM_KINDS)[number];

export function isChecklistItemKind(value: unknown): value is ChecklistItemKind {
  return (
    typeof value === 'string' &&
    (CHECKLIST_ITEM_KINDS as readonly string[]).includes(value)
  );
}

/** Closed checklist verdicts. */
export const CHECKLIST_VERDICTS = Object.freeze(['go', 'no-go'] as const);
export type ChecklistVerdict = (typeof CHECKLIST_VERDICTS)[number];

export function isChecklistVerdict(value: unknown): value is ChecklistVerdict {
  return (
    typeof value === 'string' &&
    (CHECKLIST_VERDICTS as readonly string[]).includes(value)
  );
}

/** Closed ops error codes. */
export const OPS_ERROR_CODES = Object.freeze({
  INVALID_CHECKLIST: 'OPS_INVALID_CHECKLIST',
  REQUIRED_EVIDENCE_MISSING: 'OPS_REQUIRED_EVIDENCE_MISSING',
  INVALID_PROMOTION: 'OPS_INVALID_PROMOTION',
  TIER_SKIP: 'OPS_TIER_SKIP',
  GATE_FAILURE: 'OPS_GATE_FAILURE',
  SECURITY_FAILURE: 'OPS_SECURITY_FAILURE',
  MISSING_APPROVAL: 'OPS_MISSING_APPROVAL',
  CHECKLIST_NOT_GO: 'OPS_CHECKLIST_NOT_GO',
  INVALID_ROLLBACK_POLICY: 'OPS_INVALID_ROLLBACK_POLICY',
} as const);
export type OpsErrorCode = (typeof OPS_ERROR_CODES)[keyof typeof OPS_ERROR_CODES];

/** Typed, fail-closed ops error. */
export class OpsError extends Error {
  readonly code: OpsErrorCode;
  constructor(code: OpsErrorCode, detail: string) {
    super(`[${code}] ${detail}`);
    this.name = 'OpsError';
    this.code = code;
  }
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

export function isDigestHex(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isOpsId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
