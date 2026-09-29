/**
 * @arena/body-registry — the ARENA BODY REGISTRY PROTOCOL (Work
 * Order A024; requirements R23/R24; the RELEASE stage of the README
 * "Completion target" chain: … Certification → RELEASE → Epoch
 * consumption; architecture-lock rules 5, 6, 12, 16, 17, 18, 23).
 *
 * The registry is the AUTHORITATIVE RECORD of released Body versions
 * and their release lineage:
 *
 *   - the RELEASE ADMISSION GATE is REAL (validated references,
 *     fail-closed, never a rubber stamp): only Body versions with
 *     VALID A023 certification statements (satisfied verdicts, granted
 *     levels, exact subject scope) AND VALID A022 compatibility
 *     verdicts (compatible, exact body-version address) — resolved
 *     through injected, digest-addressed evidence stores and
 *     tamper-verified — can be registered for release;
 *   - ReleaseRecords are TYPED, APPEND-ONLY and DEEP-FROZEN:
 *     registration binds the citable, content-addressed release
 *     artifact identity (A002 discipline) + channel + tags + the
 *     frozen gate evidence snapshot; supersession and retirement are
 *     append-only lineage records (history is never rewritten);
 *   - PUBLICATION is idempotent and reproducible: a registered release
 *     becomes a citable artifact identity through deterministic,
 *     content-addressed publication records on an append-only ledger
 *     (publish / retract; identity immutability across history);
 *   - closed error vocabulary + structured gate rejections: every
 *     gate failure is a structured, closed-vocabulary rejection;
 *   - Envelope<T> wiring: register-release-command /
 *     release-registered-event, publish-release-command /
 *     release-published-event, with REQUIRED idempotency keys on
 *     commands (architecture-lock rule 17).
 *
 * Pure TypeScript. Runtime dependencies: @arena/protocol-core
 * (canonical JSON + sha256 digests, envelopes, branded identifiers,
 * SchemaRef, ProtocolError) + the REAL sibling-protocol guards and
 * constructors the gate and records project through
 * (@arena/agent-body, @arena/body-forge, @arena/certification,
 * @arena/compatibility — consumed, never reimplemented). Zero external
 * runtime dependencies.
 *
 * The REFERENCE FABRIC (BodyRegistryService — register / publish /
 * supersede / retire with deterministic replay and ledger projections
 * — plus the envelope-wired service facade) lives in
 * services/body-registry (@arena/body-registry-fabric).
 *
 * CONTRACTS DISCLOSURE (A024): this package owns NO contracts/
 * surface. Its schemas live inside the package as SchemaRef-referenced
 * data (BODY_REGISTRY_SCHEMAS, envelopes.ts), following the
 * A019/A021/A022 precedent; existing contracts are not redeclared. No
 * generator ships, so governance G9 has nothing to drift-check here.
 */

export * from './errors.js';
export * from './shared.js';
export * from './gate.js';
export * from './record.js';
export * from './publication.js';
export * from './envelopes.js';

import { BODY_REGISTRY_ERROR_CODES } from './errors.js';
import { BODY_REGISTRY_SCHEMA_VERSION, BODY_REGISTRY_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const BODY_REGISTRY_PROTOCOL_VERSION = BODY_REGISTRY_SCHEMA_VERSION;

/** The body-registry error codes this build understands. */
export const SUPPORTED_BODY_REGISTRY_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(BODY_REGISTRY_ERROR_CODES),
]);

/** The body-registry schema registry (in-package SchemaRef data). */
export const BODY_REGISTRY_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...BODY_REGISTRY_SCHEMAS,
});
