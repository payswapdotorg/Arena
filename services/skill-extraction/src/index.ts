/**
 * @arena/skill-extraction-fabric — the Arena reference EXTRACTION
 * FABRIC (Work Order A019; requirement R17 — "Extract reusable Skills
 * from validated trajectories"; architecture-lock rules 6, 17, 18).
 *
 * The in-process fabric over @arena/skill-extraction:
 *
 *   - ExtractionPolicyRegistry — content-addressed policy registry,
 *     idempotent by digest, identity conflicts rejected;
 *   - ExtractionRunRecord — the append-only, digest-addressed record
 *     of one extraction run (policy, inputs, full decision log,
 *     candidate/draft digests, correlation id + run key);
 *   - ExtractionService — the runner: resolve policy → re-enforce the
 *     validated-input contract (the R17 gate never bypasses) → run the
 *     pure mining core → build A004-ready SkillDrafts → append the run
 *     record. Idempotent by run key (same key + same command ⇒ the
 *     stored record, byte-identical, never duplicated; same key +
 *     different command ⇒ IDEMPOTENCY_CONFLICT). Queries are pure
 *     projections; the ledger and draft store are append-only.
 *
 * Pure TypeScript, ZERO external runtime dependencies. In-process
 * only: no network, no database (the A019 reference slice, mirroring
 * the A011/A012/A013 reference stores/fabrics).
 */

export * from './registry.js';
export * from './record.js';
export * from './fabric.js';
