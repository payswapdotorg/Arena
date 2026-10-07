/**
 * Escalation-routing error taxonomy (Work Order C002). Mirrors the sibling
 * domain packages' typed errors (@arena/escalation's EscalationError):
 * closed code set, category mapping, structured wire-safe form. Every
 * routing outcome is machine-readable (never a bare boolean).
 */

export const ESCALATION_ROUTING_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'idempotency',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type EscalationRoutingErrorCategory = (typeof ESCALATION_ROUTING_ERROR_CATEGORIES)[number];

export const ESCALATION_ROUTING_ERROR_CODES = Object.freeze({
  INVALID_DEMAND_INPUT: 'ESCALATION_ROUTING_INVALID_DEMAND_INPUT',
  INVALID_PROFILE: 'ESCALATION_ROUTING_INVALID_PROFILE',
  INVALID_CANDIDATE: 'ESCALATION_ROUTING_INVALID_CANDIDATE',
  INVALID_VERDICT: 'ESCALATION_ROUTING_INVALID_VERDICT',
  INVALID_HISTORY: 'ESCALATION_ROUTING_INVALID_HISTORY',
  GRAPH_LOOKUP_FAILED: 'ESCALATION_ROUTING_GRAPH_LOOKUP_FAILED',
  CROSS_TENANT_ACCESS: 'ESCALATION_ROUTING_CROSS_TENANT_ACCESS',
  TAMPERED: 'ESCALATION_ROUTING_TAMPERED',
  ROUTING_UNAVAILABLE: 'ESCALATION_ROUTING_UNAVAILABLE',
  UNKNOWN_ERROR: 'ESCALATION_ROUTING_UNKNOWN_ERROR',
} as const);
export type EscalationRoutingErrorCode =
  (typeof ESCALATION_ROUTING_ERROR_CODES)[keyof typeof ESCALATION_ROUTING_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<EscalationRoutingErrorCode, EscalationRoutingErrorCategory>> = {
  ESCALATION_ROUTING_INVALID_DEMAND_INPUT: 'validation',
  ESCALATION_ROUTING_INVALID_PROFILE: 'validation',
  ESCALATION_ROUTING_INVALID_CANDIDATE: 'validation',
  ESCALATION_ROUTING_INVALID_VERDICT: 'validation',
  ESCALATION_ROUTING_INVALID_HISTORY: 'validation',
  ESCALATION_ROUTING_GRAPH_LOOKUP_FAILED: 'integrity',
  ESCALATION_ROUTING_CROSS_TENANT_ACCESS: 'scope',
  ESCALATION_ROUTING_TAMPERED: 'integrity',
  ESCALATION_ROUTING_UNAVAILABLE: 'state',
  ESCALATION_ROUTING_UNKNOWN_ERROR: 'unknown',
};

export class EscalationRoutingError extends Error {
  readonly code: EscalationRoutingErrorCode;
  readonly category: EscalationRoutingErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: EscalationRoutingErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(input.message);
    this.name = 'EscalationRoutingError';
    this.code = code;
    this.category = CODE_CATEGORY[code] ?? 'unknown';
    this.details = Object.freeze({ ...(input.details ?? {}) });
  }
}
