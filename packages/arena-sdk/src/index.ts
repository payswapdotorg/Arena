/**
 * @arena/arena-sdk — the PUBLIC/PRIVATE ARENA API AND SDK (Work Order
 * A025; requirements R24, R26; architecture-lock rules 5, 6, 11, 17,
 * 18, 22; docs/architecture.md §15 "Product/SDK surfaces").
 *
 * The typed client surface over the platform's read/query paths: the
 * certified, released, registered Body versions of the completed
 * platform core become programmatically consumable through ONE closed
 * query vocabulary:
 *
 *   - registry reads (release records, body-version registrations,
 *     release publications, certification suites, body versions);
 *   - certification statement reads (records carry the DERIVED scoped
 *     statement — the design law is preserved end-to-end: the API
 *     never surfaces an unscoped statement);
 *   - compatibility verdict reads;
 *   - compound projections (active release per channel, release
 *     lifecycle status + publication visibility).
 *
 * Discipline (house style, fail-closed everywhere):
 *   - closed vocabularies — API_QUERY_KINDS / params / results /
 *     error codes / schema names are frozen sets; unknown anything is
 *   - REJECTED, never coerced;
 *   - every read carries a REQUIRED tenant scope (`public` is the
 *     reserved global-visibility namespace; cross-tenant reads fail
 *     closed with ARENA_API_CROSS_TENANT_ACCESS — lock rule 11);
 *   - results are deep-frozen and validated against the OWNING
 *     sibling packages' structural guards (isReleaseRecord,
 *     isCertificationRecord, isCompatibilityRecord, …) — this package
 *     NEVER redefines a sibling record shape;
 *   - queries/responses travel in @arena/protocol-core Envelope<T>
 *     with the (previously unused) `query` / `response` envelope
 *     kinds — the first consumer of the full core envelope vocabulary;
 *     idempotency keys remain command-only (lock rule 17);
 *   - errors are typed ArenaApiError with a closed ARENA_API_* code
 *     set, category mapping and a strictly validating wire-safe struct.
 *
 * The reference server-side fabric lives in services/api
 * (@arena/api-fabric) — in-process, injected deps, envelope-wired,
 * zero external runtime dependencies.
 *
 * Generated contracts live in ../../contracts/api (repo root — A025
 * owned surface; see scripts/generate-contracts.mjs). Drift is
 * checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './queries.js';
export * from './envelopes.js';
export * from './client.js';

import { ARENA_API_ERROR_CODES } from './errors.js';
import { API_SCHEMA_VERSION, API_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const ARENA_API_PROTOCOL_VERSION = API_SCHEMA_VERSION;

/** The Arena API error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_ARENA_API_ERROR_CODES: readonly string[] = Object.freeze(
  [...Object.values(ARENA_API_ERROR_CODES)],
);

/** The schema registry of this package (parity-checked against contracts). */
export const ARENA_API_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...API_SCHEMAS,
});
