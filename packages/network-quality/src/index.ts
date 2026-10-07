/**
 * @arena/network-quality — the ARENA NETWORK QUALITY SYSTEM domain core
 * (Work Order C020; issue #126; the integrity layer of the expert
 * network).
 *
 * Pure TypeScript domain package whose ONLY workspace import is
 * @arena/protocol-core (canonical JSON + sha256 digests, Envelope<T>).
 * The merged dep surfaces (C005/C009/C010/C013/A034) are consumed
 * through STRUCTURAL MIRRORS of their public read surfaces — never
 * direct writes into their state.
 *
 * Core objects (all deep-frozen, plain-JSON, append-only where history
 * is involved):
 *   - ReputationRecord — the append-only, provenance-addressed DIMENSIONAL
 *     reputation evidence: ONE record family per integrity dimension
 *     (dispute-outcome, competition-agreement, validation-outcome,
 *     coi-record, conduct-flag), each carrying its closed outcome
 *     vocabulary, applicability context, sample size and dep-surface
 *     provenance. THE NO-SINGLE-GLOBAL-SCORE LAW IS STRUCTURAL: no score
 *     field exists; the only aggregate is the typed, versioned,
 *     single-family FamilyOutcomeAggregate disclosing formula, sample
 *     sizes and limitation notes; buildNetworkQualityScore /
 *     consumeReputationAsGlobalScore / applyReputationWeights have NO
 *     happy paths. Reputation evidence is DATA, never authorization and
 *     never correctness verification (lock rules 9/35).
 *   - DisputeRecord — the dispute state machine: OPEN -> UNDER_REVIEW ->
 *     RESOLVED-with-typed-outcome (+ ESCALATED / WITHDRAWN), referencing
 *     escalations, validation verdicts and payment records through the
 *     owning surfaces' public refs; resolution is a typed transition with
 *     machine-readable reasons and retained audit history; REVIEWER COI
 *     IS CHECKED (a reviewer party to the dispute is excluded).
 *   - CoiRecord + checkConflictOfInterest — the COI registry: declared +
 *     derived conflicts (tenant overlap, prior engagement, marketplace
 *     interest) and the typed COI-check read port (clear /
 *     conflicted-with-reasons / unknown-insufficient-data) the
 *     C002/C009/C013 seams consume — a PROPOSAL surface, never a write
 *     into routing or adjudication.
 *   - FindingRecord + the anti-gaming controls — typed findings from C013
 *     voting data (self-voting attempts, duplicate-account/sybil signals,
 *     coordinated-brigading patterns, rate-limit breaches) and
 *     engagement/availability signals (capacity gaming); findings carry
 *     evidence refs and machine-readable reasons; CONTROLS NEVER
 *     SILENTLY ADJUST SCORES (silentlyAdjustReputation fails closed).
 *   - The fraud controls — anomaly findings over C010 records
 *     (duplicate-payout attempts, payout velocity anomalies) and identity
 *     findings (expert impersonation); enforcement actions (HOLD /
 *     SUSPEND / INVESTIGATE) are EXPLICIT state transitions over
 *     enforcement cases with append-only audit history — never silent
 *     drops (silentlyDropEnforcementTarget fails closed).
 *   - The ingestion mapping — C009 validation outcomes and C013
 *     competition outcomes map into dimensional reputation records
 *     through pure closed tables; findings PROPOSE profile evidence into
 *     the C005 ingestion ports and requalification triggers into the
 *     owning surfaces (typed proposals, data only).
 *
 * Tenant isolation at the domain level. The reference SERVICE (dispute
 * intake/resolution, COI registration/checks, anti-gaming + fraud
 * detection jobs over injected dep ports) lives in
 * services/network-quality (@arena/network-quality-service).
 */

export * from './errors.js';
export * from './shared.js';
export * from './vocabulary.js';
export * from './reputation.js';
export * from './dispute.js';
export * from './coi.js';
export * from './finding.js';
export * from './antigaming.js';
export * from './fraud.js';
export * from './ingestion.js';
export * from './envelopes.js';

import { NETWORK_QUALITY_ERROR_CODES } from './errors.js';
import { NETWORK_QUALITY_SCHEMA_VERSION, NETWORK_QUALITY_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const NETWORK_QUALITY_PROTOCOL_VERSION = NETWORK_QUALITY_SCHEMA_VERSION;

/** The network-quality error codes this build understands. */
export const SUPPORTED_NETWORK_QUALITY_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(NETWORK_QUALITY_ERROR_CODES),
);

/** The network-quality schema registry. */
export const NETWORK_QUALITY_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({
    ...NETWORK_QUALITY_SCHEMAS,
  });
