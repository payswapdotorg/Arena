/**
 * @arena/escalation-observability — the C021 operator-side projection
 * package over the escalation network (issue #127).
 *
 * Pure TypeScript PROJECTION layer: it consumes the PUBLIC surfaces of
 * the merged dependency packages — C001 (escalation events/lifecycle),
 * C011 (SLA clocks + policies), A035 (SLO/alert vocabulary) — and
 * produces frozen, deterministic, tenant-scoped read models. It owns NO
 * domain truth and has NO code path that mutates domain state
 * (spec/service-boundaries.md).
 *
 *   - timeline.ts — lifecycle projections (per-escalation timelines with
 *     dwell times, validation-verdict refs, payment-state refs,
 *     replacement events; client-app/capability/urgency rollups);
 *   - sla.ts      — SLA measurement over the C011 clocks (typed
 *     versioned four-clock definitions, measured records with
 *     met/pending/at-risk/breached states, evidence law, supersession
 *     corrections);
 *   - slo.ts      — SLO rollups in the A035 vocabulary (disclosed
 *     formulas, sample sizes, explicit small-sample status, cross-tenant
 *     detail suppression on aggregates);
 *   - health.ts   — operational health signals (matching latency, queue
 *     depth, validation backlog, replacement rate, availability
 *     coverage);
 *   - alerts.ts   — alert-rule projections onto the A035 alert-catalog
 *     condition vocabulary (a mapping surface — the catalog is cited,
 *     never edited).
 */

export * from './errors.js';
export * from './shared.js';
export * from './timeline.js';
export * from './sla.js';
export * from './slo.js';
export * from './health.js';
export * from './alerts.js';
