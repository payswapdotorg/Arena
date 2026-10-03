/**
 * @arena/marketplace-ui — the reusable view model for Arena marketplace
 * surfaces (Work Order B013; issue #88; packages/marketplace-ui).
 *
 * Pure, deterministic, frozen-data-driven projections of expert-service and
 * artifact listings: identity, provenance summary (evidence-class mark),
 * rights posture, verification status (own truth class), certification
 * presence ONLY when a certification record backs it (composition-scoped —
 * a marketplace purchase is never a certification), the explicit
 * entitlement state machine (granted/revoked/expired/pending, never implied
 * by ownership), and the fail-closed purchase action view model.
 *
 * Zero runtime dependencies: honest structural readers over the canonical
 * marketplace shapes; a projection, never a second domain model.
 */

export * from './shared.js';
export * from './provenance.js';
export * from './rights.js';
export * from './verification.js';
export * from './entitlement.js';
export * from './certification.js';
export * from './expert-listing.js';
export * from './artifact-listing.js';
export * from './purchase.js';
export * from './fixtures.js';
