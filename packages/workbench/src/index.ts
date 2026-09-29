/**
 * @arena/workbench — the Arena EXPERT WORKBENCH package (Work Order
 * A017; requirements R7/R8 operational surface — expert qualification +
 * matching UX; R10 trajectory visibility; R26 async-jobs visibility; R41
 * graceful degradation when expert supply is unavailable).
 *
 * Vanilla TypeScript, ZERO external runtime dependencies: pure functions
 * producing HTML strings. The only workspace imports are the five
 * domain packages this surface renders (expert-registry, expert-
 * qualification, task-spec, trajectory, job-protocol). There is no UI
 * framework and no server framework in the frozen catalog — by design
 * (the A018 control-ui pattern, replicated exactly).
 *
 * Surfaces:
 *   - view-models (views.ts): typed, DEEP-FROZEN projections of the
 *     domain packages' public types via digest refs — domain types
 *     referenced, never redefined. Malformed domain objects fail CLOSED
 *     with typed WorkbenchErrors (the domain packages' exported
 *     structural guard predicates are the ONLY runtime domain imports;
 *     every other domain import is type-only — disclosed in README);
 *   - degradation (degradation.ts): the R41 model — EVERY view-model
 *     carries an explicit degraded mode with machine-readable reasons
 *     from a closed vocabulary; degraded views render last-known state
 *     plus a banner and a refresh affordance, and NEVER invent data;
 *   - renderers (render.ts): pure `(view) => string` HTML functions with
 *     EVERY interpolation escaped (escape.ts) + an inline stylesheet
 *     (stylesheet.ts) — no external assets, no CDN;
 *   - router (router.ts): a pure `(path, corpus) => view` router over
 *     server-routed section paths, with 404 and 405 (read-only)
 *     negative views;
 *   - corpus (corpus.ts): the frozen read-only reference dataset type
 *     the workbench renders from, with per-section supply states that
 *     drive degradation — the app-side builder instantiates it through
 *     the domain packages' public APIs.
 *
 * The package NEVER mutates domain state: every export is a pure
 * function over frozen inputs, and no function in this package performs
 * I/O, reads a clock, or generates randomness.
 */

export * from './corpus.js';
export * from './degradation.js';
export * from './errors.js';
export * from './escape.js';
export * from './freeze.js';
export * from './render.js';
export * from './router.js';
export * from './stylesheet.js';
export * from './views.js';

/** Version of the workbench UI surface. */
export const WORKBENCH_UI_VERSION = '1.0.0' as const;
