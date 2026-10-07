/**
 * @arena/payments — the Arena human-expert payments DOMAIN CORE
 * (Work Order C010; issue #77; handoff §8 commercial model).
 *
 * Pure TypeScript domain package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer — canonical JSON, sha256 digests,
 * Envelope<T>, branded identifiers, SchemaRef). Payment providers stay
 * behind the provider-neutral PaymentProviderPort (architecture-lock
 * rule 33); the deterministic DEMO adapter lives in adapters/payments.
 *
 * Core objects (all deep-frozen, plain-JSON, append-only where history
 * is involved):
 *   - Money — currency + amount as ONE typed value; amounts are
 *     string-scaled minor units (BigInt arithmetic; floats never touch
 *     money); multi-currency is representation-only — conversion is a
 *     provider concern, explicitly out of scope;
 *   - PaymentLedger — the append-only escrow/hold ledger: budget HOLD at
 *     creation, offer/acceptance markers, CAPTURE at ACCEPTED, RELEASE
 *     (platform-fee + expert-payout split) on completion, REFUND on
 *     REVISION_REQUIRED/REJECTED/cancellation/timeout; double-entry
 *     lines, contiguous 1..n entries, sha256 digest chain (silent
 *     mutation of a committed money record is detectable), terminal
 *     commercial states are final;
 *   - FeeSchedule / FeeSplit — versioned, deterministic, exhaustive
 *     fee-split computation + caller-split tamper validation;
 *   - CommercialAuditEvent — one audit event per applied money
 *     operation (the commercial audit surface);
 *   - Idempotency — every money operation is correlation-addressable
 *     (operationKey); duplicates REPLAY the recorded outcome verbatim;
 *     key+body conflicts are typed rejections;
 *   - Lifecycle binding — money operations are guarded against closed
 *     C001 escalation lifecycle allowlists (payout on an expired or
 *     revoked commercial state is a typed denial);
 *   - Truth labels — demo money is never customer money (the
 *     truth-label law is enforced at the provider seam).
 *
 * Generated contracts live in ../contracts (see
 * scripts/generate-contracts.mjs; drift is checked by governance G9,
 * which runs every package-level generator under packages with a
 * --check).
 */

export * from './errors.js';
export * from './shared.js';
export * from './money.js';
export * from './fees.js';
export * from './audit.js';
export * from './ledger.js';
export * from './provider.js';
export * from './envelopes.js';

import { PAYMENTS_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const PAYMENTS_PACKAGE_VERSION = PAYMENTS_SCHEMA_VERSION;
