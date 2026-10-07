/**
 * @arena/intervention — the Arena live human intervention DOMAIN CORE
 * (Work Order C007; issue #114; spec/human-escalation-work-items.md C007
 * row; spec/expert-escalation-api.md ES1.0 escalation modes + result
 * taxonomy; spec/expert-environment-session.md EES1.0 session modes).
 *
 * Pure TypeScript domain package whose workspace imports are the merged
 * dependency surfaces, consumed READ-ONLY:
 *   - @arena/escalation (C001): the closed escalation-mode vocabulary,
 *     the EscalationRequest authorization fields, the C001 lifecycle
 *     states the mode-transition guard runs against, and the result
 *     taxonomy the per-mode contracts map onto;
 *   - @arena/expert-session (C006): the six EES1.0 session-mode policies
 *     and the capsule allowedModes the mode contract maps onto;
 *   - @arena/trajectory (A011): the append-only, content-addressed
 *     trajectory protocol every intervention binds its observable work
 *     into (never reimplemented here);
 *   - @arena/protocol-core (protocol layer).
 *
 * Core objects (all deep-frozen, plain-JSON, machine-readable):
 *   - INTERVENTION_MODE_TABLE — the typed ES1.0→EES1.0 mode mapping
 *     (all eight approved escalation modes; closure-tested);
 *   - Mode-authorization guards — permitted modes come from the
 *     EscalationRequest; an unlisted mode is a typed fail-closed
 *     rejection, never a silent coercion (the escalation-modes law);
 *   - Mode-transition guards — a request may transition between modes
 *     only through explicit lifecycle state and authorization;
 *   - Per-mode typed result contracts — CORRECT (correction patch +
 *     before/after evidence refs), UNBLOCK (exactly the missing
 *     information/decision + provenance), SOLVE (completed-subproblem
 *     result + evidence bundle), REVIEW (critique/verdict against
 *     declared criteria), TEACH (observable demonstration record shaped
 *     state → human action → observable consequence → evidence, with a
 *     MANDATORY trajectory binding), plus TOOL_GAP / KNOWLEDGE /
 *     EVALUATE — each mapping onto exactly one C001 result kind;
 *   - Trajectory binding — every intervention emits an A011
 *     trajectory-backed record of observable work, screened fail-closed
 *     against private chain-of-thought (lock rule 30) and live-world
 *     mutation attempts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './modes.js';
export * from './results.js';
export * from './trajectory-binding.js';

import { INTERVENTION_WIRE_VERSION } from './shared.js';

/** Version of this package's protocol surface. */
export const INTERVENTION_PACKAGE_VERSION = INTERVENTION_WIRE_VERSION;
