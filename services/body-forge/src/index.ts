/**
 * @arena/body-forge-fabric — the in-process reference FORGE FABRIC
 * (Work Order A021; requirement R18; architecture-lock rules 5, 6,
 * 17, 18).
 *
 *   - ForgeService — submit(manifest, policy) → validate → compose →
 *     emit ForgeRecord + the BodyVersion proposal; a registry of
 *     ForgeRecords (digest-addressed, append-only); deterministic
 *     replay (same key + same tuple ⇒ byte-identical stored result);
 *     a version-consistency guard mirroring the A003 registry
 *     semantics (the same body version number can never be recorded
 *     with two different digests). No network, no database.
 *   - composeFromLearning — the A020→A019→A021 demo path: a REAL A020
 *     ExperimentRunRecord + a REAL A019 SkillDraft cited as explicit
 *     provenance → a new manifest → a new BodyVersion proposal. The
 *     learning→forge boundary is PROPOSAL-only; history is never
 *     rewritten (lock rule 6).
 *
 * The forge NEVER mutates BodyVersions and never appends them into an
 * AgentBody's version registry — the A003 body-version registry append
 * stays the single authority; this fabric only EMITS proposals plus
 * its own append-only execution records.
 *
 * Runtime dependencies (disclosed): @arena/body-forge (the pure forge
 * protocol), @arena/protocol-core (idempotency keys), @arena/learning
 * + @arena/skill-extraction (REAL record guards for the demo path).
 * Zero external runtime dependencies.
 */

export * from './fabric.js';
export * from './learning-demo.js';
