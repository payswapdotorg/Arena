/**
 * @arena/knowledge-capture — the four-tier domain-knowledge capture
 * lattice (Work Order C008; issue #115; spec/expert-environment-session.md
 * EES1.0 "Knowledge capture").
 *
 * Pure TypeScript. The ONLY workspace imports are @arena/expert-session
 * (the C006 KnowledgeArtifact / four-tier vocabulary — consumed, never
 * redefined) and @arena/protocol-core.
 *
 *   - KnowledgeCaptureError taxonomy (closed code set, strict parsing)
 *   - typed scope declarations (task / case / domain / jurisdiction,
 *     ordered by rank, at most ONE rank of widening per promotion)
 *   - LatticeKnowledgeRecord — the append-only, evidence-backed,
 *     rights-carrying lattice record over the C006 artifact vocabulary
 *     with structured scopes, validation state and capture provenance
 *   - THE NO-SILENT-PROMOTION WALL (machine-checked + tested): tier
 *     promotion is explicit, append-only, consent-gated, validation-gated
 *     for the verified tier, and scope widening is capped at one rank —
 *     task-specific advice can never surface as universal knowledge
 *   - KnowledgePatch — the scoped, rights-carrying, evidence-backed
 *     statement A019/A020 consume as a LEARNING CANDIDATE ONLY
 *     (candidateOnly is a structural property, not a flag anyone can
 *     clear — the type is true-typed).
 */

export * from './errors.js';
export * from './shared.js';
export * from './scope.js';
export * from './lattice.js';
export * from './patch.js';

import { KNOWLEDGE_CAPTURE_WIRE_VERSION } from './shared.js';

/** Version of this package's protocol surface. */
export const KNOWLEDGE_CAPTURE_PACKAGE_VERSION = KNOWLEDGE_CAPTURE_WIRE_VERSION;
