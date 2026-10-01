/**
 * @arena/web capability-flow barrel (Work Order B008; issue #80).
 *
 * SERVER-ONLY surface: the composition modules read the browser session
 * through the B004 boundary (next/headers) and write through the
 * product-flows runtime — importing them from a Client Component is a
 * build-time contract violation. The presentational views are sync and
 * side-effect-free.
 */

export * from './role-lens.js';
export * from './case-view.js';
export * from './capability-views.js';
export * from './runtime.js';
export * from './flow-actions.js';
