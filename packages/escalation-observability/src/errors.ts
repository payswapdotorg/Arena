/**
 * Typed, fail-closed errors of @arena/escalation-observability
 * (Work Order C021; issue #127). Closed machine-readable codes — never
 * bare booleans, never free-text failure reasons on the wire (the house
 * error discipline of every C-series package).
 */

/** The closed error-code vocabulary. */
export const ESCALATION_OBSERVABILITY_ERROR_CODES = Object.freeze({
  INVALID_PROJECTION: 'ESCALATION_OBSERVABILITY_INVALID_PROJECTION',
  INVALID_EVENT: 'ESCALATION_OBSERVABILITY_INVALID_EVENT',
  CROSS_TENANT_ACCESS: 'ESCALATION_OBSERVABILITY_CROSS_TENANT_ACCESS',
  INVALID_TENANT: 'ESCALATION_OBSERVABILITY_INVALID_TENANT',
  INVALID_SLA: 'ESCALATION_OBSERVABILITY_INVALID_SLA',
  INVALID_SLO: 'ESCALATION_OBSERVABILITY_INVALID_SLO',
  INVALID_SIGNAL: 'ESCALATION_OBSERVABILITY_INVALID_SIGNAL',
  SUPERSESSION_REQUIRED: 'ESCALATION_OBSERVABILITY_SUPERSESSION_REQUIRED',
  PORT_FAILURE: 'ESCALATION_OBSERVABILITY_PORT_FAILURE',
  TENANT_MISMATCH: 'ESCALATION_OBSERVABILITY_TENANT_MISMATCH',
} as const);
export type EscalationObservabilityErrorCode =
  (typeof ESCALATION_OBSERVABILITY_ERROR_CODES)[keyof typeof ESCALATION_OBSERVABILITY_ERROR_CODES];

export function isEscalationObservabilityErrorCode(
  value: unknown,
): value is EscalationObservabilityErrorCode {
  return (
    typeof value === 'string' &&
    (Object.values(ESCALATION_OBSERVABILITY_ERROR_CODES) as readonly string[]).includes(value)
  );
}

/** The typed error (code + structured details — machine-readable). */
export class EscalationObservabilityError extends Error {
  readonly code: EscalationObservabilityErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: EscalationObservabilityErrorCode,
    info: { message: string; details?: Record<string, unknown> },
  ) {
    super(info.message);
    this.name = 'EscalationObservabilityError';
    this.code = code;
    this.details = Object.freeze({ ...(info.details ?? {}) });
    Object.freeze(this);
  }
}
