/**
 * Network-quality protocol error taxonomy (Work Order C020; issue #126).
 *
 * @arena/network-quality owns its own closed error code set, mirroring the
 * sibling domain packages' typed errors (@arena/expert-performance's
 * ExpertPerformanceError, @arena/payments, @arena/escalation-validation —
 * closed codes, core category mapping, structured wire-safe form). Core
 * taxonomy is frozen inside @arena/protocol-core, so network-quality-domain
 * failures carry NETWORK_QUALITY_* codes here while core-level failures
 * (canonicalization, envelope shape, correlation ids, schema refs)
 * propagate the original ProtocolError.
 *
 * FINDINGS PROPOSE, NEVER SILENTLY ADJUST: no error code, message or
 * structured detail in this taxonomy adjusts a score, a routing decision,
 * an adjudication outcome or an authorization — the vocabulary is about
 * validation, integrity, lifecycle, dispute/COI state and enforcement
 * discipline of network-quality DATA only (lock rules 9/35).
 */

export const NETWORK_QUALITY_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'lifecycle',
  'privacy',
  'adapter',
  'unknown',
] as const);

export type NetworkQualityErrorCategory = (typeof NETWORK_QUALITY_ERROR_CATEGORIES)[number];

export const NETWORK_QUALITY_ERROR_CODES = Object.freeze({
  INVALID_RECORD: 'NETWORK_QUALITY_INVALID_RECORD',
  INVALID_FAMILY: 'NETWORK_QUALITY_INVALID_FAMILY',
  INVALID_OUTCOME: 'NETWORK_QUALITY_INVALID_OUTCOME',
  INVALID_AGGREGATE: 'NETWORK_QUALITY_INVALID_AGGREGATE',
  INVALID_POLICY: 'NETWORK_QUALITY_INVALID_POLICY',
  INVALID_REF: 'NETWORK_QUALITY_INVALID_REF',
  INVALID_IDENTITY: 'NETWORK_QUALITY_INVALID_IDENTITY',
  INVALID_TIMESTAMP: 'NETWORK_QUALITY_INVALID_TIMESTAMP',
  INVALID_SOURCE: 'NETWORK_QUALITY_INVALID_SOURCE',
  INVALID_TRANSITION: 'NETWORK_QUALITY_INVALID_TRANSITION',
  INVALID_COI: 'NETWORK_QUALITY_INVALID_COI',
  REVIEWER_COI_CONFLICT: 'NETWORK_QUALITY_REVIEWER_COI_CONFLICT',
  GLOBAL_SCORE_REJECTED: 'NETWORK_QUALITY_GLOBAL_SCORE_REJECTED',
  SILENT_ADJUSTMENT_REJECTED: 'NETWORK_QUALITY_SILENT_ADJUSTMENT_REJECTED',
  APPEND_ONLY_VIOLATION: 'NETWORK_QUALITY_APPEND_ONLY_VIOLATION',
  DUPLICATE_EVIDENCE: 'NETWORK_QUALITY_DUPLICATE_EVIDENCE',
  BACKDATED_RECORD: 'NETWORK_QUALITY_BACKDATED_RECORD',
  NOT_FOUND: 'NETWORK_QUALITY_NOT_FOUND',
  TAMPERED: 'NETWORK_QUALITY_TAMPERED',
  TENANT_MISMATCH: 'NETWORK_QUALITY_TENANT_MISMATCH',
  PRIVACY_VIOLATION: 'NETWORK_QUALITY_PRIVACY_VIOLATION',
  IDEMPOTENCY_CONFLICT: 'NETWORK_QUALITY_IDEMPOTENCY_CONFLICT',
  MASQUERADE_REJECTED: 'NETWORK_QUALITY_MASQUERADE_REJECTED',
  PORT_FAILURE: 'NETWORK_QUALITY_PORT_FAILURE',
  VERSION_CONFLICT: 'NETWORK_QUALITY_VERSION_CONFLICT',
  UNKNOWN_ERROR: 'NETWORK_QUALITY_UNKNOWN_ERROR',
} as const);

export type NetworkQualityErrorCode =
  (typeof NETWORK_QUALITY_ERROR_CODES)[keyof typeof NETWORK_QUALITY_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<NetworkQualityErrorCode, NetworkQualityErrorCategory>> = {
  NETWORK_QUALITY_INVALID_RECORD: 'validation',
  NETWORK_QUALITY_INVALID_FAMILY: 'validation',
  NETWORK_QUALITY_INVALID_OUTCOME: 'validation',
  NETWORK_QUALITY_INVALID_AGGREGATE: 'validation',
  NETWORK_QUALITY_INVALID_POLICY: 'validation',
  NETWORK_QUALITY_INVALID_REF: 'validation',
  NETWORK_QUALITY_INVALID_IDENTITY: 'validation',
  NETWORK_QUALITY_INVALID_TIMESTAMP: 'validation',
  NETWORK_QUALITY_INVALID_SOURCE: 'validation',
  NETWORK_QUALITY_INVALID_TRANSITION: 'lifecycle',
  NETWORK_QUALITY_INVALID_COI: 'validation',
  NETWORK_QUALITY_REVIEWER_COI_CONFLICT: 'integrity',
  NETWORK_QUALITY_GLOBAL_SCORE_REJECTED: 'integrity',
  NETWORK_QUALITY_SILENT_ADJUSTMENT_REJECTED: 'integrity',
  NETWORK_QUALITY_APPEND_ONLY_VIOLATION: 'integrity',
  NETWORK_QUALITY_DUPLICATE_EVIDENCE: 'integrity',
  NETWORK_QUALITY_BACKDATED_RECORD: 'integrity',
  NETWORK_QUALITY_NOT_FOUND: 'validation',
  NETWORK_QUALITY_TAMPERED: 'integrity',
  NETWORK_QUALITY_TENANT_MISMATCH: 'privacy',
  NETWORK_QUALITY_PRIVACY_VIOLATION: 'privacy',
  NETWORK_QUALITY_IDEMPOTENCY_CONFLICT: 'integrity',
  NETWORK_QUALITY_MASQUERADE_REJECTED: 'privacy',
  NETWORK_QUALITY_PORT_FAILURE: 'adapter',
  NETWORK_QUALITY_VERSION_CONFLICT: 'versioning',
  NETWORK_QUALITY_UNKNOWN_ERROR: 'unknown',
};

export interface NetworkQualityErrorDetails {
  readonly message: string;
  readonly code: NetworkQualityErrorCode;
  readonly category: NetworkQualityErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Structured, wire-safe network-quality error. `toJSON` keeps the typed
 * shape serializable; `message` carries the human-auditable line.
 */
export class NetworkQualityError extends Error {
  readonly code: NetworkQualityErrorCode;
  readonly category: NetworkQualityErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: NetworkQualityErrorCode,
    init: { message: string; details?: Record<string, unknown> },
  ) {
    super(init.message);
    this.name = 'NetworkQualityError';
    this.code = code;
    this.category = CODE_CATEGORY[code];
    this.details = init.details === undefined ? {} : Object.freeze({ ...init.details });
  }

  toJSON(): NetworkQualityErrorDetails {
    return {
      message: this.message,
      code: this.code,
      category: this.category,
      ...(Object.keys(this.details).length === 0 ? {} : { details: this.details }),
    };
  }
}
