/**
 * @arena/web cockpit barrel (Work Order B007; issue #78).
 *
 * SERVER-ONLY surface: the composition modules read the browser session
 * through the B004 boundary (next/headers) — importing them from a Client
 * Component is a build-time contract violation. The presentational view
 * is sync and side-effect-free.
 */

export * from './state-mark.js';
export * from './role-lens.js';
export * from './cockpit-view.js';
export * from './cockpit-home-view.js';
export * from './runtime.js';
export * from './home-route.js';
