/**
 * @arena/escalation — the Arena expert escalation DOMAIN CORE
 * (Work Order C001; issue #75; spec/expert-escalation-api.md ES1.0).
 *
 * Pure TypeScript domain package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer — never reimplemented:
 * canonical JSON, sha256 digests, Envelope<T>, branded identifiers,
 * SchemaRef). The escalation API is an INTEGRATION BOUNDARY, not a new
 * semantic authority (ES1.0 design constraint): canonical objects here
 * back the public surfaces built in services/escalation-api,
 * adapters/escalation and contracts/escalation.
 *
 * Core objects (all deep-frozen, plain-JSON, append-only where history
 * is involved):
 *   - EscalationRequest — the ES1.0 primary object (every minimum
 *     field; content-addressed sha256 digest; strict fail-closed
 *     construction);
 *   - EscalationRecord + lifecycle — the durable state machine:
 *     CREATED → TRIAGED → MATCHING → OFFERED → ACCEPTED →
 *     SESSION_READY → IN_PROGRESS → SUBMITTED → VALIDATING →
 *     ACCEPTED|REVISION_REQUIRED|REJECTED → PAID → LEARNING_CAPTURED →
 *     CLOSED with EXPLICIT timed-out / cancelled / expert-replaced
 *     states; machine-readable transition verdicts (never a bare
 *     boolean); append-only state history; terminal states are final;
 *   - Result taxonomy — the closed 11-kind vocabulary (Correction …
 *     LearningArtifactRef) with per-kind required fields;
 *   - Idempotency + correlation addressability — the
 *     (tenant, idempotency key, correlation id) submission identity;
 *     duplicate submissions REPLAY the original request; conflicting
 *     key+body is a typed ESCALATION_IDENTITY_CONFLICT rejection;
 *   - Tenant isolation at the DOMAIN level (typed CROSS_TENANT_ACCESS);
 *   - Webhook event taxonomy — the closed 13-event minimum vocabulary,
 *     a pure projection of the canonical lifecycle (idempotent
 *     consumer keys = event ids);
 *   - Envelope wiring — create-escalation-command (REQUIRED idempotency
 *     key), get-escalation-status-query (NULL key), escalation-response,
 *     escalation-webhook-event, all in the `escalation` SchemaRef
 *     namespace.
 *
 * Generated contracts live in ../../../contracts/escalation (see
 * scripts/generate-contracts.mjs; drift is checked by governance G9,
 * which runs every package-level generator under packages with --check).
 */

export * from './errors.js';
export * from './shared.js';
export * from './request.js';
export * from './results.js';
export * from './lifecycle.js';
export * from './events.js';
export * from './idempotency.js';
export * from './envelopes.js';

import { ESCALATION_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const ESCALATION_PACKAGE_VERSION = ESCALATION_SCHEMA_VERSION;
