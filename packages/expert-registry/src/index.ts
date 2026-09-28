/**
 * @arena/expert-registry — the Expert registry and Expert profile protocol
 * (Work Order A006; docs/architecture.md §8, verbatim: "Experts are
 * capability providers. Profiles include identity, competencies,
 * qualifications, evidence, task history, reliability, availability and
 * domain/jurisdiction where appropriate. Qualification, reputation and
 * authorization are separate concerns."; requirements R7 registry side,
 * R32 measurement data, R37 domain-pack guard; architecture-lock rules 6,
 * 9, 11, 23, 24).
 *
 * Pure TypeScript; the ONLY runtime dependency is @arena/protocol-core,
 * whose primitives (canonical JSON + sha256 digests, branded identifiers,
 * Envelope<T>, SchemaRef, ProtocolError) are reused throughout — never
 * reimplemented. Zero model/provider surface (lock rule 10).
 *
 * Core model:
 *   - ExpertProfile: versioned, content-addressed (sha256 over the
 *     canonical digest-free view), deep-frozen, carrying EVERY §8 field
 *     (identity: neutral expert id + declared identity refs — PII
 *     minimization; competencies: capability/skill refs + proficiency
 *     evidence refs; qualifications: typed records with credential refs,
 *     evidence digests and status — DATA, never authorization; evidence:
 *     digest-addressed refs; task history: append-only record refs;
 *     reliability: an append-only event-sourced ledger whose
 *     completed/failed/no-response counters are ALWAYS recomputed from
 *     history; availability: typed windows; domain/jurisdiction: explicit
 *     professional-limitation metadata per lock rule 23) plus the explicit
 *     privacy policy that governs public-view derivation;
 *   - SEPARATION OF CONCERNS (lock rule 9 — the critical gate): the
 *     profile carries qualification DATA but NO authorization grants and
 *     NO system authority claims; the authority/PII vocabulary screen
 *     rejects `systemRole`/`authority`/`adminOf`/`permissions`-shaped and
 *     `email`/`phone`/`legalName`-shaped fields at any input depth.
 *     Authorization is a SEPARATE FUTURE PROTOCOL — nothing in this
 *     package grants, implies or records a permission;
 *   - append-only lifecycle DRAFT → PUBLISHED → SUSPENDED → PUBLISHED
 *     (reinstatement) → RETIRED with terminal finality (terminal mutation
 *     throws) and a deep-frozen append-only event history;
 *   - supersession by new profile versions (supersedes/supersededBy
 *     refs); superseded versions stay immutable and addressable forever;
 *   - tenant scoping (lock rule 11): every profile carries a tenant scope
 *     (reserved `public` namespace for explicitly published global
 *     experts); cross-tenant reads fail closed at the query API
 *     (ExpertRegistry), and public-view derivation strips
 *     tenant-internal-marked groups;
 *   - domain packs (R37): ExpertDomainPack descriptors ADD domain
 *     competency types/metadata and can NEVER alter lifecycle semantics
 *     or inject authority/PII fields (both are negative-tested);
 *   - commands and events travel inside @arena/protocol-core's
 *     Envelope<T> with REQUIRED idempotency keys on commands (lock rule
 *     17).
 *
 * Generated contracts: contracts/expert/*.json (see
 * packages/expert-registry/scripts/generate-contracts.mjs; drift is
 * checked by the drift test suite and governance G9, and parity is
 * asserted against this TS surface by contracts.parity.test.ts).
 */

export * from './errors.js';
export * from './shared.js';
export * from './timestamp.js';
export * from './identity.js';
export * from './authority-screen.js';
export * from './competencies.js';
export * from './qualifications.js';
export * from './task-history.js';
export * from './reliability.js';
export * from './availability.js';
export * from './domain-scope.js';
export * from './privacy-policy.js';
export * from './digest.js';
export * from './profile.js';
export * from './lifecycle.js';
export * from './registry.js';
export * from './public-view.js';
export * from './domain-pack.js';
export * from './envelopes.js';

import { EXPERT_ERROR_CODES } from './errors.js';
import { EXPERT_SCHEMA_VERSION, EXPERT_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const EXPERT_REGISTRY_PROTOCOL_VERSION = EXPERT_SCHEMA_VERSION;

/** The expert-registry error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_EXPERT_ERROR_CODES: readonly string[] =
  Object.values(EXPERT_ERROR_CODES);

/** The expert schema registry (parity-checked against contracts). */
export const EXPERT_SCHEMA_REGISTRY: Readonly<Record<string, string>> = {
  ...EXPERT_SCHEMAS,
};
