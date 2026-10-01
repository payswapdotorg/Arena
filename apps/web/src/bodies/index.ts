/**
 * @arena/web bodies barrel (Work Order B010; issue #82).
 *
 * SERVER-ONLY surface: the composition modules read the browser session
 * through the B004 boundary (next/headers) — importing them from a Client
 * Component is a build-time contract violation. The presentational views
 * are sync and side-effect-free.
 */

export * from './role-lens.js';
export * from './runtime.js';
export * from './studio-view.js';
export * from './body-detail-view.js';
export * from './bodies-home-view.js';
export * from './bodies-detail-view.js';
