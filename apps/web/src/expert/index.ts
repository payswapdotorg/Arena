/**
 * @arena/web expert workbench barrel (Work Order B009; issue #81).
 *
 * SERVER-ONLY surface: the composition modules read the browser session
 * through the B004 boundary (next/headers) and write through the B002
 * control-plane repository port — importing them from a Client Component
 * is a build-time contract violation. The presentational views are sync
 * and side-effect-free.
 */

export * from './state-mark.js';
export * from './runtime.js';
export * from './assignment.js';
export * from './evidence.js';
export * from './workbench.js';
export * from './expert-view.js';
