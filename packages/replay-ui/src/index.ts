/**
 * @arena/replay-ui — the ARENA REPLAY VIEWER view-model layer (Work Order
 * B011; issue #86; requirements R10, R11, R33 — observability;
 * architecture-lock rule 6 — trajectories are append-only and
 * content-addressed).
 *
 * Pure, deterministic, frozen-data-driven projections of canonical
 * trajectory / environment-runtime / evaluation / verification objects
 * into the shapes the replay surface renders. This package adds NO
 * runtime authority and invents NO parallel domain model: every payload
 * is validated through the sibling protocol packages' PUBLIC guards and
 * projected honestly — unknown stays unknown, pending stays pending,
 * degraded renders as degraded, and a replayed step is ALWAYS
 * simulation-replay, never "result". Zero app dependencies (the boundary
 * checker enforces domain-package posture).
 *
 * Surface map:
 *   - truth.ts        — the replay truth classes + the observational and
 *                       not-a-result product-truth notes;
 *   - timeline.ts     — the timeline over a trajectory (steps, wall-clock
 *                       vs logical ordering, honest no-data/pending gaps,
 *                       full-chain verification helper);
 *   - event-stream.ts — the environment event stream (A010 runtime
 *                       events, step linkage, honest stream states);
 *   - linkage.ts      — evidence addresses + evaluation/verification
 *                       result linkage, each under its OWN truth class;
 *   - inspection.ts   — the interactive run-inspection assembly (step
 *                       selection, per-step I/O, run record/result
 *                       summaries);
 *   - run-list.ts     — the run list (deterministic ordering, bounded
 *                       pages, opaque continuation tokens);
 *   - role-lens.ts    — the eight B003 role lenses + granted/not-granted
 *                       active-role resolution (a lens, never an
 *                       authorization);
 *   - fixtures.ts     — the deterministic demo corpus (REAL protocol
 *                       objects through the sibling factories).
 */

export * from './truth.js';
export * from './timeline.js';
export * from './event-stream.js';
export * from './linkage.js';
export * from './inspection.js';
export * from './run-list.js';
export * from './role-lens.js';
export * from './fixtures.js';
