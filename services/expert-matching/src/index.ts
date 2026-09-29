/**
 * @arena/expert-matching-fabric — the A007 reference matching fabric
 * (in-process pool + pure matcher + command/query orchestration).
 *
 * Public surface:
 *   - QualifiedExpertPool / RegisteredClaim (pool.ts);
 *   - ExpertMatchingEngine (matcher.ts) — the deterministic, pure matcher;
 *   - ExpertMatchingFabric / createExpertMatchingFabric (fabric.ts) —
 *     qualify-claim / record-qualification-expiry commands (idempotent,
 *     lock rule 17) and the match-experts query.
 */

export * from './pool.js';
export * from './matcher.js';
export * from './fabric.js';
