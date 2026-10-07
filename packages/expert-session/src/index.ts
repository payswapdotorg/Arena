/**
 * @arena/expert-session — the Arena expert environment session DOMAIN
 * CORE (Work Order C006; issue #113; spec/expert-environment-session.md
 * EES1.0).
 *
 * Pure TypeScript domain package whose workspace imports are
 * @arena/protocol-core (protocol layer — canonical JSON, sha256 digests,
 * Envelope<T>, branded identifiers, SchemaRef; never reimplemented) and
 * @arena/escalation (the merged C001 escalation-mode closed vocabulary
 * the session-mode derivation consumes — read-only consumption).
 *
 * Core objects (all deep-frozen, plain-JSON, append-only where history
 * is involved):
 *   - ExpertSessionCapsule — the bounded, escalation-scoped,
 *     time-bounded, privacy-policy-controlled, NON-AUTHORITATIVE
 *     replica derived from an ExecutionCapsule source (content-addressed
 *     sha256 digest; EES1.0 "Environment Capsule");
 *   - Session-mode enforcement — the six EES1.0 modes (Observe /
 *     Correct / Unblock / Takeover / Teach / Review) as a typed
 *     capability policy; allowed modes derive from the
 *     EscalationRequest's escalationModes;
 *   - PrivacyBarrier — the EES1.0 control set (field/document
 *     redaction, secret/tool exclusion, tenant boundary, identity
 *     masking, time-limited credentials, read-only resources, action
 *     allowlist, download/clipboard/screenshot restrictions) with
 *     fail-closed escape detection (ESCAPE_ATTEMPT);
 *   - Observable event stream — the closed approved vocabulary
 *     (environment observations, human actions, tool invocations/
 *     results, artifact changes, annotations, checkpoints, final
 *     result, expert corrections, tool-gap signals); private
 *     chain-of-thought is NEVER captured or transmitted;
 *   - ToolGapSignal — the full EES1.0 field set (evidence of use
 *     required);
 *   - Knowledge-capture tiers — task-specific guidance / scoped
 *     reusable knowledge / candidate domain rule / verified domain
 *     constraint, with the NO-SILENT-PROMOTION law enforced
 *     structurally (explicit append-only promotion only);
 *   - Session completion — result + evidence + annotations +
 *     corrections + optional knowledge artifacts + optional tool-gap
 *     signals + consent/rights statement;
 *   - Session lifecycle — open → active → completed (+ expired /
 *     cancelled) bound to the C001 escalation states; and
 *   - Replay traces — observational, clearly-marked bounded-expert-
 *     session replays that can never masquerade as live mutations.
 */

export * from './errors.js';
export * from './shared.js';
export * from './barrier.js';
export * from './modes.js';
export * from './capsule.js';
export * from './events.js';
export * from './toolgap.js';
export * from './knowledge.js';
export * from './submission.js';
export * from './lifecycle.js';
export * from './replay.js';
export * from './envelopes.js';

import { EXPERT_SESSION_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const EXPERT_SESSION_PACKAGE_VERSION = EXPERT_SESSION_SCHEMA_VERSION;
