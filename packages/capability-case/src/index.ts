/**
 * @arena/capability-case — the Capability Case protocol (Work Order A005;
 * docs/architecture.md §5; spec CC1.0; requirements R5, R6-bridge,
 * R3-style addressability; architecture-lock rules 6, 11, 24).
 *
 * The Capability Case is the bridge from observed failure to capability
 * development. Pure TypeScript; the ONLY runtime dependency is
 * @arena/protocol-core, whose primitives (canonical JSON + sha256 digests,
 * branded identifiers, Envelope<T>, SchemaRef, ProtocolError) are reused
 * throughout — never reimplemented. Zero model/provider surface (lock rule
 * 10).
 *
 * Core model:
 *   - CapabilityCase: versioned, content-addressed (sha256 over the
 *     canonical digest-free view), deep-frozen, carrying EVERY §5 field
 *     (target capability, domain, context, observed failure, evidence,
 *     current body/substrate — both optional —, uncertainty, desired
 *     outcome, expert/environment/task/evaluation/verification
 *     requirements) plus the spec CC1.0 required fields (source, problem
 *     statement, priority, risk, provenance, status);
 *   - append-only lifecycle DRAFT → SUBMITTED → TRIAGED → ACTIVE →
 *     RESOLVED/SUPERSEDED with terminal finality (terminal mutation
 *     throws) and a deep-frozen append-only event history;
 *   - supersession by new case versions (supersedes/supersededBy refs);
 *     superseded versions stay immutable and addressable forever;
 *   - tenant scoping (lock rule 11): every case carries a tenant scope
 *     (reserved `public` namespace for explicitly published global cases);
 *     cross-tenant reads fail closed at the query API (CaseRegistry);
 *   - evidence discipline (lock rule 6): digest-addressed evidence refs;
 *     attachment appends; NO removal or rewrite API exists;
 *   - TaskCompilationTarget: the typed data contract the A008 TaskSpec
 *     compiler consumes (pure types + deriveCompilationTarget validator —
 *     no compiler logic here);
 *   - commands and events travel inside @arena/protocol-core's Envelope<T>
 *     with REQUIRED idempotency keys on commands (lock rule 17).
 *
 * Generated contracts: contracts/capability-case/*.json (see
 * scripts/generate-contracts.mjs; drift is checked by the drift test suite
 * and governance G9, and parity is asserted against this TS surface by
 * contracts.parity.test.ts).
 */

export * from './errors.js';
export * from './shared.js';
export * from './timestamp.js';
export * from './identity.js';
export * from './requirements.js';
export * from './digest.js';
export * from './case.js';
export * from './lifecycle.js';
export * from './registry.js';
export * from './compilation.js';
export * from './envelopes.js';

import { CAPABILITY_CASE_ERROR_CODES } from './errors.js';
import { CAPABILITY_CASE_SCHEMA_VERSION, CAPABILITY_CASE_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const CAPABILITY_CASE_PROTOCOL_VERSION = CAPABILITY_CASE_SCHEMA_VERSION;

/** The capability-case error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_CAPABILITY_CASE_ERROR_CODES: readonly string[] =
  Object.values(CAPABILITY_CASE_ERROR_CODES);

/** The capability-case schema registry (parity-checked against contracts). */
export const CAPABILITY_CASE_SCHEMA_REGISTRY: Readonly<Record<string, string>> = {
  ...CAPABILITY_CASE_SCHEMAS,
};
