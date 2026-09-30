/**
 * @arena/security — Arena security, tenancy, authorization and audit
 * core protocol (Work Order A034; spec/security.md S1.0).
 *
 * Pure TypeScript domain package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer). Everything security-visible is
 * closed, frozen and fail-closed:
 *
 *   - identity.ts — typed TenantId/Principal model (separate concerns:
 *     identity, tenancy, authorization, policy);
 *   - authorization.ts — policy objects + the pure authorization engine
 *     (allow/deny decisions with CLOSED reasons; deny-overrides-allow;
 *     no wildcards; fail-closed default 'no-matching-policy');
 *   - tenancy.ts — S1.0 boundary-class isolation validators (nine
 *     closed classes; cross-tenant access denies and fails closed);
 *   - data-rights.ts — the six mandatory rights fields as frozen
 *     records (owner, source, permitted use, contract/license
 *     reference, retention, publication status) + enforcement helpers;
 *   - learning-authorization.ts — the cross-tenant learning gate
 *     (explicit-consent grants, expiry, revocation, scope, per-dataset
 *     permitted-use — never a rubber stamp);
 *   - expert-rights.ts — expert work record rights (contributor
 *     identity, compensation terms, attribution policy, derived
 *     artifact rights, withdrawal/deletion policy hooks);
 *   - model-governance.ts — model data governance (per-tenant/task
 *     input/output retention, classification, and the secret gate:
 *     secrets never enter generic trajectories);
 *   - audit.ts — append-only, tamper-evident, content-addressed audit
 *     trail with causation/correlation ids (A015 discipline);
 *   - envelopes.ts — Envelope<T> wiring with in-package SchemaRef
 *     schema registry (A019/A022 precedent — no contracts/ surface).
 *
 * CONTRACTS DISCLOSURE (A034): this package owns NO contracts/ surface.
 * Schemas live in-package as SchemaRef-referenced data (see
 * envelopes.ts); there is no contracts generator and no drift surface.
 */

export * from './errors.js';
export * from './shared.js';
export * from './identity.js';
export * from './authorization.js';
export * from './tenancy.js';
export * from './data-rights.js';
export * from './learning-authorization.js';
export * from './expert-rights.js';
export * from './model-governance.js';
export * from './audit.js';
export * from './envelopes.js';

import { SECURITY_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const SECURITY_PROTOCOL_VERSION = SECURITY_SCHEMA_VERSION;
