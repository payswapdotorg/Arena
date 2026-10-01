/**
 * @arena/hosted-upstash-redis — the Upstash Redis adapter for
 * @arena/persistence (Work Order B002; issue #64; FT2.0 "Redis":
 * bounded/rebuildable coordination state ONLY).
 *
 * Public surface:
 *   env             — env-var contract (UPSTASH_REDIS_REST_URL /
 *                     UPSTASH_REDIS_REST_TOKEN)
 *   rest-transport  — the RestCommandTransport seam (closed GET/SET/
 *                     DEL/INCR/PEXPIRE/PTTL/PING vocabulary) + the
 *                     default plain-fetch REST transport (ZERO new
 *                     dependencies — the ONLY infrastructure touchpoint)
 *   adapter         — UpstashCoordinationStore (CoordinationStore +
 *                     CapacityProbe; DISABLED fail-closed without
 *                     config; TTL cache, idempotency windows,
 *                     fixed-window rate-limit counters, leases)
 *
 * Configuration is read ONLY from server-side env vars; values are never
 * committed and never logged. Without configuration the adapter is
 * DISABLED and every operation fails closed with the typed capacity
 * error. The RestCommandTransport seam lets the FULL persistence
 * contract suite run against this adapter without live credentials.
 */

export * from './env.js';
export * from './rest-transport.js';
export * from './adapter.js';
