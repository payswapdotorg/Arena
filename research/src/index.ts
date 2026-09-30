/**
 * @arena/research -- the RESEARCH / PUBLIC-EVALUATION protocol layer
 * (Work Order A030; requirements R23, R32, R43, R44; spec EV1.0;
 * architecture-lock rules 12, 18, 22).
 *
 * This package defines the CITABLE research objects layered on top of
 * the merged dependency fabrics -- never redefining them:
 *
 *   - ScoringMethodology  -- the versioned, content-addressed statement
 *     of HOW raw per-criterion verdicts become one benchmark score:
 *     the aggregation policy (the A012 closed enum, REUSED by import,
 *     never reimplemented), the pass bar, tie-breaking, known
 *     limitations and contamination caveats (public-benchmark hygiene
 *     is a stated field, never an implication);
 *   - BenchmarkDescriptor -- the versioned, content-addressed, citable
 *     definition of a public benchmark: identity pins for the criteria
 *     suites / evaluator / verifier templates it runs (A012/A013
 *     identity + version pins, NOT run digests), the scoring
 *     methodology ref, the public dataset ref (A014 DatasetManifest
 *     digest), the subject scope (the pinned body population, e.g. the
 *     A028 reference software-engineer body), the task population and
 *     seed policy, plus publication lifecycle (draft | published |
 *     retired);
 *   - BenchmarkResultRecord -- the APPEND-ONCE scored result of one
 *     deterministic benchmark run: the benchmark ref, the subject
 *     (body version + substrate + possession), the fixed run inputs
 *     (seed, timestamps, correlation/idempotency keys), per-criterion
 *     scores, the aggregate derived PURELY per the referenced
 *     methodology, and the verification-checked evidence chain
 *     (A012 EvaluationRecord + A013 VerificationRecord digests);
 *   - LeaderboardLedger -- the append-only, supersession-aware ledger
 *     of result records with a deterministic ranking projection;
 *   - publication helpers -- public-namespace dataset packaging through
 *     the REUSED A014 discipline (createDatasetManifest /
 *     resolveDatasetBundle / verifyDatasetBundle), so research
 *     artifacts inherit A002 content-addressed identity and lineage.
 *
 * Design law: a benchmark result is a statement of the form "body B
 * version V, possessed by substrate M, under environment E and runtime
 * R, scored S on benchmark X at revision Y, verified by evidence E" -
 * it is NEVER a statement about M alone (R43: model benchmarks are
 * distinct from Agent Body certifications; R44: model/body/
 * environment/runtime versions are recorded in every result).
 *
 * Pure TypeScript; the only runtime imports are workspace protocol
 * packages (@arena/protocol-core, @arena/artifact-protocol,
 * @arena/evaluation, @arena/verification, @arena/datasets) -- consumed
 * as digest refs and closed enums, never reimplemented.
 *
 * research/* is deliberately NOT a pnpm workspace member (the root
 * pnpm-workspace.yaml -- owned by the Tech Lead -- does not glob it, the
 * same self-contained pattern as examples/software-engineer from
 * A028): this package resolves @arena/* sources via tsconfig paths /
 * vitest aliases and pins its own exact devDependencies.
 */

export * from './errors.js';
export * from './shared.js';
export * from './schemas.js';
export * from './methodology.js';
export * from './descriptor.js';
export * from './result.js';
export * from './leaderboard.js';
export * from './publication.js';
