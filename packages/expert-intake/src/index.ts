/**
 * @arena/expert-intake — the AI EXPERT INTAKE / ADAPTIVE CAPABILITY
 * INTERVIEW AGENT (Work Order C003; issue #110; the front door of the
 * expert network).
 *
 * A prospective human expert is profiled through an adaptive, versioned,
 * seed-deterministic interview over the C002 DemandProfile / A004
 * capability vocabulary:
 *
 *   - TYPED interview items (capability probe, experience probe, evidence
 *     request, scenario item), each with an expected answer schema — the
 *     interview elicits STRUCTURED declarations, not free prose;
 *   - next-item selection by EXPECTED INFORMATION VALUE with a fully
 *     inspectable, per-component scored rationale (the capability-case
 *     active-learning law);
 *   - the APPEND-ONLY digest-chained transcript records exactly what the
 *     expert was asked and what the expert DECLARED — never hidden model
 *     reasoning;
 *   - the typed output contract: a structured IntakeProfile proposal for
 *     the A006 registry field groups + qualification claim candidates
 *     with evidence pointers for A007;
 *   - CLAIMS ARE INPUT TO QUALIFICATION, NEVER AN ACCESS GRANT (lock
 *     rules 9/35 — qualification is never authorization);
 *   - the interviewer model sits behind an ADAPTER PORT with a
 *     deterministic scripted reference implementation (lock rule 10);
 *   - tenant isolation (lock rule 11) and minimal-PII capture under the
 *     expert's declared privacy policy, with consent recorded for
 *     transcript retention.
 *
 * Pure TypeScript; runtime dependencies are the merged domain packages
 * @arena/protocol-core (canonical JSON + sha256 digests, Envelope<T>),
 * @arena/expert-qualification (the shared proficiency/competency/
 * evidence/availability/jurisdiction vocabulary — consumed, never
 * redefined) and @arena/escalation-routing (the DemandProfile view type
 * the catalog is seeded from). Zero service imports.
 *
 * The reference SERVICE (in-memory store + injected model/registry/
 * qualification ports) lives in services/expert-intake
 * (@arena/expert-intake-service).
 */

export * from './errors.js';
export * from './shared.js';
export * from './model-adapter.js';
export * from './items.js';
export * from './selection.js';
export * from './session.js';
export * from './outcome.js';
export * from './profile.js';
export * from './engine.js';
export * from './envelopes.js';

import { EXPERT_INTAKE_ERROR_CODES } from './errors.js';
import { EXPERT_INTAKE_SCHEMA_VERSION, EXPERT_INTAKE_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const EXPERT_INTAKE_PROTOCOL_VERSION = EXPERT_INTAKE_SCHEMA_VERSION;

/** The expert-intake error codes this build understands. */
export const SUPPORTED_EXPERT_INTAKE_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(EXPERT_INTAKE_ERROR_CODES),
);

/** The expert-intake schema registry. */
export const EXPERT_INTAKE_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...EXPERT_INTAKE_SCHEMAS,
});
