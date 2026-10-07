/**
 * @arena/tool-gap — the tool-gap capture pipeline domain core (Work Order
 * C008; issue #115; spec/expert-environment-session.md EES1.0
 * "Tool-gap discovery").
 *
 * Pure TypeScript. The ONLY workspace imports are @arena/expert-session
 * (the C006 signal vocabulary — ToolGapSignal is consumed, never
 * redefined) and @arena/protocol-core. Everything protocol-visible is
 * versioned, append-only and machine-readable:
 *
 *   - ToolGapError taxonomy (closed code set, strict parsing)
 *   - the typed CLOSED stage machine (captured -> triaged ->
 *     tool-specification-proposed -> adapter-request | body-improvement-
 *     candidate | benchmark-candidate | marketplace-artifact-candidate)
 *     with machine-readable transition verdicts; terminal stages final
 *   - ToolGapSignalRecord — provenance-addressed, correlation-linked,
 *     append-only staged records over the full EES1.0 signal field set,
 *     with deterministic content keys (duplicate injections deduplicate
 *     instead of inflating triage counts) and an integrity check over the
 *     append-only stage history (tamper detection)
 *   - NOTHING AUTO-PROMOTES — the only stage-mover is an explicit
 *     advance command carrying a recorded decision.
 */

export * from './errors.js';
export * from './shared.js';
export * from './stages.js';
export * from './signal.js';

import { TOOL_GAP_WIRE_VERSION } from './shared.js';

/** Version of this package's protocol surface. */
export const TOOL_GAP_PACKAGE_VERSION = TOOL_GAP_WIRE_VERSION;
