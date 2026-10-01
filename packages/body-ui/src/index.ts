/**
 * @arena/body-ui — the reusable view model for Arena body surfaces
 * (Work Order B010; issue #82; packages/body-ui).
 *
 * Pure, deterministic, frozen-data-driven projections of canonical reads
 * into the shapes the Body Studio renders. This package adds NO runtime
 * authority and invents NO second domain model: it projects
 * `agent-body`/`certification` reads through the @arena/read-model
 * contract types, honestly (unknown stays unknown).
 *
 * Product truths carried structurally (architecture-lock A2.0 rules 1-5):
 *   - Body ≠ model; Substrate ≠ Body;
 *   - Possession = a versioned composition binding;
 *   - certification claims apply to the tested composition;
 *   - Body Versions are immutable and content-addressed;
 *   - substrate comparisons are composition-scoped or typed-rejected.
 */

export * from './shared.js';
export * from './errors.js';
export * from './identity-card.js';
export * from './composition.js';
export * from './possession-matrix.js';
export * from './certification.js';
export * from './comparison.js';
export * from './studio.js';
