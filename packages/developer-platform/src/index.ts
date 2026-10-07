/**
 * @arena/developer-platform — the Arena developer platform DOMAIN CORE
 * (Work Order C017; issue #123).
 *
 * Pure TypeScript domain package. Workspace imports are the C001/C010
 * domain cores it projects (same-layer domain composition — the house
 * seam rule): @arena/escalation (client-app id, escalation records,
 * lifecycle vocabulary) and @arena/payments (fee-split seam), plus
 * @arena/protocol-core (canonical JSON / digest / identifier
 * conventions — never reimplemented).
 *
 * Core objects (all deep-frozen, plain-JSON, append-only where history
 * is involved):
 *   - DeveloperKeyRecord — a scoped API key bound to ONE client app +
 *     tenant + environment. Secrets are hashed at rest and shown ONCE at
 *     issuance. Keys AUTHENTICATE a client application; they NEVER
 *     confer role authority (lock rule 9 / roles-and-contexts: role
 *     context is presentation, never authority). Rotation and
 *     revocation are append-only status transitions with the full
 *     history retained.
 *   - ClientAppRecord + WebhookEndpointRecord — the ES1.0 client_app_id
 *     registration surface and the webhook endpoint/signing-secret
 *     pairing consumed by the C001 delivery seam.
 *   - Sandbox — deterministic, VISIBLY LABELLED sandbox escalations
 *     (sandbox truth-label law: demo money is not customer money;
 *     sandbox keys can never touch live surfaces; capacity is never
 *     faked — EXHAUSTED/DISABLED fail closed).
 *   - Escalation observability projections — per-client-app read models
 *     of lifecycle state, validation status, SLA-relevant timestamps and
 *     cost/fee fields. PROJECTIONS ONLY, no domain truth
 *     (service-boundaries law): the canonical record stays in the C001
 *     escalation domain.
 *
 * No generated contracts yet (documented limitation; a contracts/
 * generator can follow the C001 package-generator convention without
 * touching root surfaces when the wire surface stabilizes).
 */

export * from './errors.js';
export * from './shared.js';
export * from './api-keys.js';
export * from './client-apps.js';
export * from './sandbox.js';
export * from './projections.js';

/** Version of this package's protocol surface. */
export const DEVELOPER_PLATFORM_PACKAGE_VERSION = 1 as const;
