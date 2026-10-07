/**
 * @arena/expert-engagement — the ENGAGEMENT LAYER between routing and
 * session (Work Order C011; issue #117): the lifecycle of offers to
 * experts (issue → accept/decline/expiry → activate → complete/withdraw/
 * replace), the expert-declared availability + capacity model feeding
 * the ES1.0 "current availability" routing input, deadline-aware
 * scheduling (offer-expiry deadlines, SLA clocks) and the SLA
 * measurements later observability (C021) consumes.
 *
 * Pure TypeScript; the ONLY workspace import is @arena/protocol-core
 * (canonical JSON + sha256 digests + Envelope<T> — the C005 package
 * dependency discipline). Arena handles offer/acceptance per
 * FINAL-HANDOFF §8; this package owns the ENGAGEMENT RECORDS and the
 * AVAILABILITY/SLA MEASUREMENTS, never the money (C010 owns commercial
 * truth — engagements reference its offer/budget-hold records through
 * opaque public refs only) and never routing decisions (C002 owns
 * routing — this package exposes the availability projection the router
 * READS).
 *
 *   - EngagementRecord / transitions — the closed OFFERED → ACCEPTED |
 *     DECLINED | EXPIRED → ACTIVE → COMPLETED | WITHDRAWN | REPLACED
 *     lifecycle with machine-readable transition reasons, offer-expiry
 *     determinism, append-only history (supersession house pattern) and
 *     tamper detection;
 *   - AvailabilityDeclaration — versioned expert-declared windows +
 *     capacity; capacity accounting that cannot overcommit a declared
 *     window; deterministic offer-time availability resolution;
 *     toRoutingAvailabilityInput — the ES1.0 routing-input projection;
 *   - SlaPolicy / SlaClocks / SlaBreachRecord — versioned response
 *     windows by urgency class (mirrors the C001 urgency vocabulary),
 *     deadline-aware accept-by/start-by/submit-by derivation, clock
 *     states (satisfied | on-track | at-risk | breached) with reasons,
 *     and explicit append-only breach records (measurements only —
 *     enforcement belongs to downstream consumers).
 */

export * from './errors.js';
export * from './shared.js';
export * from './engagement.js';
export * from './availability.js';
export * from './sla.js';
export * from './envelopes.js';

import { EXPERT_ENGAGEMENT_SCHEMA_VERSION, EXPERT_ENGAGEMENT_SCHEMAS } from './envelopes.js';
import { EXPERT_ENGAGEMENT_ERROR_CODES } from './errors.js';

/** Version of this package's protocol surface. */
export const EXPERT_ENGAGEMENT_PROTOCOL_VERSION = EXPERT_ENGAGEMENT_SCHEMA_VERSION;

/** The expert-engagement error codes this build understands. */
export const SUPPORTED_EXPERT_ENGAGEMENT_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(EXPERT_ENGAGEMENT_ERROR_CODES),
);

/** The expert-engagement schema registry. */
export const EXPERT_ENGAGEMENT_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({
    ...EXPERT_ENGAGEMENT_SCHEMAS,
  });
