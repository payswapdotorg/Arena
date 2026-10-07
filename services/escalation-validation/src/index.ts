/**
 * @arena/escalation-validation-service — the Arena escalation
 * validation/adjudication REFERENCE SERVICE (Work Order C009; issue
 * #116).
 *
 * Implements C007's labelled validation seam for real (the C002
 * precedent): SUBMITTED payloads route onto a derived typed validation
 * plan, the C001 lifecycle binds VALIDATING → ACCEPTED |
 * REVISION_REQUIRED | REJECTED through injected ports, the A012
 * evaluation and A013 verification stages run as EXPLICITLY DISTINCT
 * adjudication stages (architecture-lock rule 7), the bounded revision
 * loop and typed expert-replacement triggers (returning the escalation
 * to MATCHING through the C002 public routing seam) are driven through
 * the C001 public lifecycle functions, and escalation.validation.
 * updated webhook events are emitted through the A015 fabric
 * conventions.
 */

export * from './ports.js';
export * from './fabric.js';
export * from './service.js';
