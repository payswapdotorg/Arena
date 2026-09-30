/**
 * @arena/body-registry-fabric — the in-process reference BODY REGISTRY
 * FABRIC + envelope-wired service facade (Work Order A024; the RELEASE
 * stage of the Arena loop; architecture-lock rules 5, 6, 12, 16, 17,
 * 18, 23).
 *
 *   - BodyRegistryService — register (gate → idempotency → identity
 *     binding → append-only ledger) / supersede / retire / publish /
 *     retract with pure ledger projections (lifecycle + visibility).
 *     Injected evidence stores, fail-closed, no network, no database.
 *   - BodyRegistryEnvelopeService — the envelope-wired facade:
 *     register-release-command → release-registered-event,
 *     publish-release-command → release-published-event (REQUIRED
 *     idempotency keys on commands, lock rule 17).
 *
 * Runtime dependencies (disclosed): @arena/body-registry (the pure
 * release protocol), @arena/protocol-core (idempotency keys, envelope
 * serialization), @arena/agent-body (principal/rights types for
 * publication), plus the sibling protocol packages whose record types
 * the injected evidence stores carry (@arena/certification,
 * @arena/compatibility, @arena/body-forge). Zero external runtime
 * dependencies.
 */

export * from './fabric.js';
export * from './service.js';
