/**
 * @arena/body-forge — the ARENA AGENT BODY FORGE PROTOCOL (Work
 * Order A021; requirement R18 — "Forge immutable Agent Body
 * Versions"; docs/architecture.md §12 Agent Body Forge;
 * architecture-lock rules 5, 6, 16, 17, 18, 23).
 *
 * The Forge composes: Body Manifest + Skills + Knowledge + Tools +
 * Procedures/Policies + Verification + Evaluation + Environment
 * Requirements — into an IMMUTABLE Body Version.
 *
 *   - a manifest is the versioned, content-addressed composition
 *     INPUT (every §12 field; A004-shaped capability refs;
 *     digest-addressed skill/knowledge/tool/procedure/suite/
 *     environment refs; EXPLICIT learning citations);
 *   - a policy is the versioned, content-addressed composition RULE
 *     set (mandatory-input requirements; learning admission —
 *     learning-derived content enters ONLY as an explicit cited
 *     provenance ref; conflict handling; lineage rules);
 *   - composition is DETERMINISTIC and PURE: same manifest + policy +
 *     recipe ⇒ byte-identical BodyVersion (no hidden clock reads);
 *   - the forge NEVER mutates an existing BodyVersion (lock rule 5):
 *     every compose mints a NEW immutable proposal with full lineage
 *     (parent refs, source manifest digest, policy digest,
 *     correlation id); supersession is APPEND-ONLY (lock rule 6 —
 *     learning proposes, the forge composes, history is never
 *     rewritten);
 *   - the emitted proposal is a REAL @arena/agent-body BodyVersion BY
 *     CONSTRUCTION (built through createBodyVersion — the A003
 *     constructor — and re-verified fail-closed; disclosed: the
 *     BodyVersion contract is imported, never mirrored);
 *   - ForgeRecords are append-only and idempotency-keyed (lock rule
 *     17): re-running the same key returns the recorded result.
 *
 * Pure TypeScript. Runtime dependencies: @arena/protocol-core
 * (canonical JSON + sha256 digests, envelopes, branded identifiers,
 * SchemaRef, ProtocolError) + @arena/agent-body (the REAL BodyVersion
 * constructor and view validators the forge projects through) +
 * @arena/capability-graph (the REAL CapabilityNodeRef guard for
 * A004-shaped capability refs). Zero external runtime dependencies.
 *
 * The REFERENCE FABRIC (ForgeService — submit/validate/compose/record
 * with deterministic replay — plus the compose-from-learning demo
 * path) lives in services/body-forge (@arena/body-forge-fabric).
 *
 * CONTRACTS DISCLOSURE (A021): this package owns NO contracts/
 * surface. Its schemas live inside the package as SchemaRef-
 * referenced data (BODY_FORGE_SCHEMAS, envelopes.ts); existing
 * contracts are not redeclared. No generator ships, so governance G9
 * has nothing to drift-check here.
 */

export * from './errors.js';
export * from './shared.js';
export * from './manifest.js';
export * from './policy.js';
export * from './forge.js';
export * from './envelopes.js';

import { BODY_FORGE_ERROR_CODES } from './errors.js';
import { BODY_FORGE_SCHEMA_VERSION, BODY_FORGE_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const BODY_FORGE_PROTOCOL_VERSION = BODY_FORGE_SCHEMA_VERSION;

/** The body-forge error codes this build understands. */
export const SUPPORTED_BODY_FORGE_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(BODY_FORGE_ERROR_CODES),
]);

/** The body-forge schema registry (in-package SchemaRef data). */
export const BODY_FORGE_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...BODY_FORGE_SCHEMAS,
});
