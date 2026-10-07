/**
 * Capability-routing error taxonomy (Work Order C015; issue #121). Mirrors
 * the sibling domain packages' typed errors (@arena/escalation-routing's
 * EscalationRoutingError): closed code set, category mapping, structured
 * wire-safe form. Every routing outcome is machine-readable (never a bare
 * boolean) — errors are for STRUCTURALLY invalid inputs and integrity
 * failures only; routing semantics are typed outcomes.
 */

export const CAPABILITY_ROUTING_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'idempotency',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type CapabilityRoutingErrorCategory = (typeof CAPABILITY_ROUTING_ERROR_CATEGORIES)[number];

export const CAPABILITY_ROUTING_ERROR_CODES = Object.freeze({
  INVALID_DEMAND_INPUT: 'CAPABILITY_ROUTING_INVALID_DEMAND_INPUT',
  INVALID_PROFILE: 'CAPABILITY_ROUTING_INVALID_PROFILE',
  INVALID_CANDIDATE: 'CAPABILITY_ROUTING_INVALID_CANDIDATE',
  INVALID_MATCH: 'CAPABILITY_ROUTING_INVALID_MATCH',
  INVALID_HISTORY: 'CAPABILITY_ROUTING_INVALID_HISTORY',
  INVALID_POLICY: 'CAPABILITY_ROUTING_INVALID_POLICY',
  GRAPH_LOOKUP_FAILED: 'CAPABILITY_ROUTING_GRAPH_LOOKUP_FAILED',
  CROSS_TENANT_ACCESS: 'CAPABILITY_ROUTING_CROSS_TENANT_ACCESS',
  TAMPERED: 'CAPABILITY_ROUTING_TAMPERED',
  ROUTING_UNAVAILABLE: 'CAPABILITY_ROUTING_UNAVAILABLE',
  UNKNOWN_ERROR: 'CAPABILITY_ROUTING_UNKNOWN_ERROR',
} as const);
export type CapabilityRoutingErrorCode =
  (typeof CAPABILITY_ROUTING_ERROR_CODES)[keyof typeof CAPABILITY_ROUTING_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<CapabilityRoutingErrorCode, CapabilityRoutingErrorCategory>> = {
  CAPABILITY_ROUTING_INVALID_DEMAND_INPUT: 'validation',
  CAPABILITY_ROUTING_INVALID_PROFILE: 'validation',
  CAPABILITY_ROUTING_INVALID_CANDIDATE: 'validation',
  CAPABILITY_ROUTING_INVALID_MATCH: 'validation',
  CAPABILITY_ROUTING_INVALID_HISTORY: 'validation',
  CAPABILITY_ROUTING_INVALID_POLICY: 'validation',
  CAPABILITY_ROUTING_GRAPH_LOOKUP_FAILED: 'integrity',
  CAPABILITY_ROUTING_CROSS_TENANT_ACCESS: 'scope',
  CAPABILITY_ROUTING_TAMPERED: 'integrity',
  CAPABILITY_ROUTING_UNAVAILABLE: 'state',
  CAPABILITY_ROUTING_UNKNOWN_ERROR: 'unknown',
};

export class CapabilityRoutingError extends Error {
  readonly code: CapabilityRoutingErrorCode;
  readonly category: CapabilityRoutingErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: CapabilityRoutingErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(input.message);
    this.name = 'CapabilityRoutingError';
    this.code = code;
    this.category = CODE_CATEGORY[code] ?? 'unknown';
    this.details = Object.freeze({ ...(input.details ?? {}) });
  }
}
