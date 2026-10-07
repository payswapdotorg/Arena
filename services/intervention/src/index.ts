/**
 * @arena/intervention-service — the Arena live human intervention
 * REFERENCE SERVICE (Work Order C007; issue #114).
 *
 * Binds C006 expert sessions to the C001 escalation lifecycle
 * (SESSION_READY → IN_PROGRESS → SUBMITTED) through injected ports
 * (escalation, session, trajectory, intervention store, webhook event
 * sink, validation handoff); enforces mode authorization and the
 * escalation-modes law on every mode selection/transition; records
 * observable expert work into BOTH the C006 session stream and an A011
 * trajectory-backed record; emits escalation.progressed webhook
 * events; and routes SUBMITTED payloads onto the validation seam
 * (A012/A013) through the clearly-labelled deterministic C009 stub.
 */

export * from './ports.js';
export * from './fabric.js';
export * from './service.js';
