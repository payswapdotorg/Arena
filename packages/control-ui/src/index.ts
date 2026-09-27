/**
 * @arena/control-ui — the Arena control-plane console UI package (Work
 * Order A018; requirements R16-R18 per the dispatch; implementation-plan
 * Phase 4 exit: "a human can discover a task, perform it in the correct
 * environment, review evidence and inspect results without developer
 * intervention").
 *
 * Vanilla TypeScript, ZERO external runtime dependencies: pure functions
 * producing HTML strings. The ONLY workspace imports are the domain
 * packages + @arena/protocol-core (consumed as a UI-consumption domain
 * package; layering enforced by `pnpm boundary`). There is no UI framework
 * and no server framework in the frozen catalog — by design.
 *
 * Surfaces:
 *   - view-models: typed, deep-frozen projections of the domain packages'
 *     public types via digest refs (views.ts) — domain types referenced,
 *     never redefined;
 *   - renderers: pure `(view) => string` HTML functions with EVERY
 *     interpolation escaped (escape.ts, render.ts) + an inline stylesheet
 *     (stylesheet.ts) — no external assets, no CDN;
 *   - router: a pure `(path, corpus) => view` router over the server-
 *     routed section paths, with 404 and 405 (read-only) negative views
 *     (router.ts);
 *   - corpus: the frozen read-only reference dataset type the console
 *     renders from (corpus.ts) — the app-side builder instantiates it
 *     through the domain packages' public APIs.
 *
 * The package NEVER mutates domain state: every export is a pure function
 * over frozen inputs (gate 7), and no function in this package performs
 * I/O, reads a clock, or generates randomness.
 */

export * from './corpus.js';
export * from './escape.js';
export * from './freeze.js';
export * from './render.js';
export * from './router.js';
export * from './stylesheet.js';
export * from './views.js';

/** Version of the console UI surface. */
export const CONTROL_UI_VERSION = '1.0.0' as const;
