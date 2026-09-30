/**
 * @arena/epoch-adapter — the provider-neutral Epoch capability-development
 * adapter (Work Order A026; spec/epoch-integration.md EPI1.0; requirements
 * R25, R26, R35, R36).
 *
 * Bridges the Epoch CONSUMPTION stage of the Arena loop:
 *
 *   Epoch detects capability failure → capability-development request
 *   → [THIS ADAPTER: typed translation] → Arena Capability Case
 *   → task/environment/expert work → evaluation/verification/learning
 *   → Body/substrate certification → capability artifact refs
 *   → [THIS ADAPTER: typed output refs] → Epoch consumes the artifact.
 *
 *  - EPI1.0 incoming requests: CapabilityDevelopmentRequest (carrying the
 *    capability-case seed, failed trajectory refs, evaluation gaps and
 *    capability/domain requirements) — fail-closed, closed-shape parsing.
 *  - EPI1.0 Arena outputs: the spec's eleven content-addressed Ref kinds.
 *  - The EPI1.0 asynchronous job envelope: job id, correlation id,
 *    causation id, idempotency key, artifact digests, authorization
 *    metadata, explicit lifecycle/status — closed error vocabulary.
 *  - The authority boundary, enforced structurally: NO Epoch World-Model
 *    mutation surface exists anywhere in this package (EPOCH_AUTHORITY_
 *    BOUNDARY declares the six EPI1.0 clauses; the hygiene suite scans
 *    the public surface).
 *
 * Dependencies are consumed, never reimplemented: @arena/protocol-core
 * (envelopes, digests, identifiers), @arena/capability-case (A005 case
 * provisioning), @arena/job-protocol (A015 idempotent submission identity),
 * @arena/body-registry (A024 release admission gates), @arena/arena-sdk
 * (the A025 typed public read surface — ArenaApiClient).
 *
 * CONTRACTS DISCLOSURE (A026): this adapter owns NO contracts/ surface;
 * schemas live in-package as SchemaRef-referenced data (see ./schemas.ts,
 * the A019/A024 precedent).
 */

export * from './errors.js';
export * from './refs.js';
export * from './request.js';
export * from './job.js';
export * from './schemas.js';
export * from './adapter.js';

import { EPOCH_ADAPTER_ERROR_CODES } from './errors.js';
import { EPOCH_SCHEMAS, EPOCH_SCHEMA_VERSION } from './schemas.js';
import { EPOCH_OUTPUT_REF_KINDS } from './refs.js';

const EPI1_0 = 'EPI1.0' as const;

/** The EPI1.0 contract label this adapter implements. */
export const EPOCH_ADAPTER_PROTOCOL_VERSION = EPI1_0;

/** The epoch adapter error codes this build understands. */
export const SUPPORTED_EPOCH_ADAPTER_ERROR_CODES: readonly string[] = Object.freeze(
  [...Object.values(EPOCH_ADAPTER_ERROR_CODES)],
);

/** The in-package epoch schema registry (SchemaRef data; no contracts/). */
export const EPOCH_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...EPOCH_SCHEMAS,
});

/** The EPI1.0 output ref kind count (the spec's list is eleven). */
export const EPOCH_OUTPUT_REF_KIND_COUNT = EPOCH_OUTPUT_REF_KINDS.length;

/** The in-package schema registry version (parity anchor). */
export const EPOCH_ADAPTER_SCHEMA_VERSION = EPOCH_SCHEMA_VERSION;
