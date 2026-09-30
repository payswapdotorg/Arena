/**
 * @arena/observability — Arena observability, operations and SLO core
 * protocol (Work Order A035; requirements R33, R26, R27, R28).
 *
 * Pure TypeScript domain package whose ONLY workspace imports are
 * @arena/protocol-core (protocol layer) and @arena/security (domain
 * layer — the A034 integration: security audit events are first-class
 * telemetry). Everything observability-visible is closed, frozen and
 * fail-closed:
 *
 *   - telemetry.ts  — typed metric/trace/log/audit signals with
 *                     correlation + causation ids and per-source
 *                     append-only sequence discipline (the A015
 *                     event-log discipline applied to telemetry);
 *   - slo.ts        — frozen SLO definitions with DERIVED error
 *                     budgets and a pure, window-strict, no-data
 *                     fail-closed evaluator;
 *   - alerts.ts     — alert-rule descriptors with CLOSED condition
 *                     semantics, a closed state machine and cooldown
 *                     flap protection;
 *   - health.ts     — health/status vocabularies with worst-of
 *                     fail-closed aggregation;
 *   - envelopes.ts  — Envelope<T> wiring with in-package SchemaRef
 *                     data in the `observability` namespace (no
 *                     contracts/ surface is owned — A034 disclosure
 *                     precedent).
 */

export * from './errors.js';
export * from './shared.js';
export * from './telemetry.js';
export * from './slo.js';
export * from './alerts.js';
export * from './health.js';
export * from './envelopes.js';
