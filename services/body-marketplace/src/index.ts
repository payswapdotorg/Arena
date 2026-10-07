/**
 * @arena/body-marketplace-service — the Arena body-marketplace REFERENCE
 * SERVICE (Work Order C014; issue #120).
 *
 *   PRETRAINING — on-demand Agent Body pretraining from rights-cleared,
 *   validated intervention data: a typed PretrainingRequest compiled
 *   from C009-validated intervention evidence, C008 improvement
 *   candidates and customer commissions (provenance, scope and rights
 *   metadata on every input) into typed CLOSED outcomes (compilable |
 *   blocked-with-reasons: rights-insufficient, evidence-insufficient);
 *   compilable runs PROPOSE new immutable BodyVersions through the A021
 *   forge's public port — a certified Body is NEVER mutated (lock rule
 *   5; AB1.0 Evolution law) — and enter the A023 certification pipeline
 *   as candidates before A024 release registration.
 *
 *   LISTINGS — the capability-body listing model over A024 body-registry
 *   releases: record-backed certification posture ONLY (derived from
 *   resolvable A023 records about the exact body version), explicit
 *   versioned publication transitions with typed guard outcomes (lock
 *   rule 12), lifecycle DRAFT → PUBLISHED → SUSPENDED/RETIRED with
 *   reasons, append-only history, license/rights and
 *   substrate-compatibility metadata, and offer/grant records per the
 *   A031/A032 marketplace house patterns.
 *
 * Dependencies are consumed through their public package ports only
 * (@arena/body-forge, @arena/certification, @arena/body-registry,
 * @arena/agent-body, @arena/compatibility,
 * @arena/escalation-validation, @arena/protocol-core) — never by
 * importing a sibling service (boundary rule B2).
 */

export * from './errors.js';
export * from './shared.js';
export * from './pretraining.js';
export * from './ports.js';
export * from './fabric.js';
export * from './envelopes.js';
export * from './service.js';

import { BODY_MARKETPLACE_ERROR_CODES } from './errors.js';
import { BODY_MARKETPLACE_SCHEMAS, BODY_MARKETPLACE_SCHEMA_VERSION } from './envelopes.js';

/** Version of this surface's protocol surface. */
export const BODY_MARKETPLACE_PROTOCOL_VERSION = BODY_MARKETPLACE_SCHEMA_VERSION;

/** The body-marketplace error codes this build understands. */
export const SUPPORTED_BODY_MARKETPLACE_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(BODY_MARKETPLACE_ERROR_CODES),
]);

/** The body-marketplace schema registry (in-package SchemaRef data). */
export const BODY_MARKETPLACE_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...BODY_MARKETPLACE_SCHEMAS,
});
