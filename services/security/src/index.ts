/**
 * @arena/security-service — the ARENA REFERENCE SECURITY SERVICE (Work
 * Order A034; spec/security.md S1.0).
 *
 * In-process, zero external runtime dependencies (only
 * @arena/protocol-core + @arena/security). The reference slice — NO
 * network/HTTP layer, like the A013/A023 reference fabrics.
 *
 * Surface:
 *   - SecurityPolicyRegistry — content-addressed policy bundles:
 *     idempotent registration by statement-set digest, IDENTITY_CONFLICT
 *     on a different statement set under the same identity;
 *   - SecurityService — the envelope-wired facade:
 *     register-policy-bundle-command → registry + audit append +
 *     policy-bundle-registered-event;
 *     evaluate-authorization-command → engine + tenancy check + audit
 *     append (BOTH outcomes) → authorization-decided-event;
 *     authorize-learning-command → explicit-consent gate + audit append
 *     → learning-authorization-decided-event;
 *   - SecurityAuditLog (from @arena/security) — the append-only,
 *     tamper-evident audit trail the service seals every decision into.
 */

export * from './registry.js';
export * from './service.js';
