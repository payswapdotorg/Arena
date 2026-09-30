/**
 * @arena/api-fabric — the reference server-side layer for the Arena
 * public/private API (Work Order A025).
 *
 * Two layers, mirroring the sibling reference services exactly
 * (services/certification, services/body-registry):
 *
 *   - ApiFabric (fabric.ts) — the in-process reference read model:
 *     guard-validated, idempotent-by-digest ingest of the AUTHORITATIVE
 *     records of the completed platform core (A003 body versions, A023
 *     certification records/suites, A022 compatibility records, A024
 *     release records + publication records) and the tenant-scoped
 *     query dispatch over @arena/arena-sdk's closed query vocabulary.
 *     Satisfies the SDK's ArenaQueryHandler port STRUCTURALLY — hosts
 *     wire `createLoopbackTransport(fabric)` or bridge the same
 *     envelopes over a network.
 *   - ApiService (service.ts) — the envelope-wired facade: strict-parse
 *     api-query-request (envelope kind `query`, NULL idempotency key),
 *     dispatch, emit api-query-response (envelope kind `response`, same
 *     correlation id).
 *
 * Zero external runtime dependencies; only @arena/* workspace domain
 * packages (boundary: service → domain/protocol only, never another
 * service).
 */

export * from './fabric.js';
export * from './service.js';
