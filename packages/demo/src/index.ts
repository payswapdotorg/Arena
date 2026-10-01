/**
 * @arena/demo — deterministic Demo/Preview mode (Work Order B006; #73).
 *
 * Pure + deterministic: the frozen seed corpus (canonical control-plane
 * records under the reserved demo tenant), the guided first-run
 * narrative script, the demo lifecycle port (+ in-memory fake), the
 * demo read session over the B005 canonical read path, and THE
 * labelling contract every demo surface must display.
 */

export * from './errors.js';
export * from './shared.js';
export * from './corpus.js';
export * from './narrative.js';
export * from './store.js';
export * from './views.js';

