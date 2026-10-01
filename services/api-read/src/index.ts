/**
 * @arena/api-read — the versioned, auth-gated read API boundary
 * (Work Order B005; issue #71). Consumed by B006/B007 UI wiring per
 * spec/service-boundaries.md.
 *
 * Fail-closed by construction: anonymous reads are not representable,
 * the tenant always comes from the validated B004 session context, and
 * no write path exists on this surface.
 */

export * from './protocol.js';
export * from './service.js';
