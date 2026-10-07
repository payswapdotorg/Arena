/**
 * @arena/epoch-escalation-adapter — the Epoch escalation REFERENCE
 * adapter (Work Order C019; issue #125; spec/epoch-integration.md
 * EPI1.0 + spec/expert-escalation-api.md ES1.0 + architecture-lock
 * rules 13-15 and 36).
 *
 * Epoch is a reference CUSTOMER of the generic Arena Escalation API
 * (lock rule 36), never a special semantic authority inside Arena.
 * This adapter proves that mapping in both directions:
 *
 *   Epoch → Arena: EpochEscalationTrigger (capability-failure /
 *   uncertainty-boundary / tool-gap events carrying the EPI1.0
 *   asynchronous contract — job id, correlation id, causation id,
 *   idempotency key, artifact digests, authorization metadata, explicit
 *   lifecycle) + EpochIntegrationPosture (the declared session/privacy
 *   posture) → the REAL ES1.0 EscalationRequest constructor from
 *   @arena/escalation. Closed-shape, fail-closed validation; unknown
 *   fields reject; authorization mismatch rejects typed.
 *
 *   Arena → Epoch: EscalationRecord / webhook events →
 *   EpochEscalationDelivery — a deep-frozen READ-ONLY projection with
 *   typed result taxonomy, evidence refs, validation status, cost/fee
 *   fields and learning-artifact refs WHERE the request authorized
 *   reuse. NO write-back surface exists (authority.ts): Epoch applies
 *   results through its OWN authority (lock rule 26).
 *
 * Dependencies are consumed, never reimplemented: @arena/escalation
 * (the C001 escalation domain core — request/lifecycle/result/event
 * shapes and strict envelope parsing) and @arena/protocol-core.
 *
 * CONTRACTS DISCLOSURE (C019): this adapter owns NO contracts/ surface;
 * the escalation wire schemas are C001's (contracts/escalation). The
 * Epoch-side trigger/posture shapes live in-package as closed data
 * shapes with fail-closed parsers (the A026 precedent).
 */

export * from './errors.js';
export * from './authority.js';
export * from './posture.js';
export * from './trigger.js';
export * from './adapter.js';
export * from './webhook.js';

import { EPOCH_ESCALATION_ERROR_CODES } from './errors.js';
import { EPOCH_ESCALATION_AUTHORITY_BOUNDARY } from './authority.js';
import { EPOCH_ESCALATION_TRIGGER_VERSION } from './trigger.js';
import { EPOCH_ESCALATION_DELIVERY_VERSION } from './adapter.js';

const ES1_0 = 'ES1.0' as const;
const EPI1_0 = 'EPI1.0' as const;

/** The ES1.0 escalation contract this adapter consumes (EPI1.0 async envelope). */
export const EPOCH_ESCALATION_ADAPTER_PROTOCOL_VERSION = `${EPI1_0}+${ES1_0}` as const;

/** The error codes this build understands (closed vocabulary). */
export const SUPPORTED_EPOCH_ESCALATION_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(EPOCH_ESCALATION_ERROR_CODES),
]);

/** The authority boundary this adapter structurally enforces (EPI1.0). */
export const EPOCH_ESCALATION_ADAPTER_AUTHORITY_BOUNDARY = EPOCH_ESCALATION_AUTHORITY_BOUNDARY;

/** Wire versions this build speaks (trigger in, delivery out). */
export const EPOCH_ESCALATION_WIRE_VERSIONS = Object.freeze({
  trigger: EPOCH_ESCALATION_TRIGGER_VERSION,
  delivery: EPOCH_ESCALATION_DELIVERY_VERSION,
} as const);
