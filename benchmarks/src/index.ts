/**
 * @arena/benchmarks -- the A030 EXECUTABLE benchmark suites.
 *
 * One deterministic function (`runSeRepairBenchmark`) exercises the A028
 * reference Software Engineer Agent Body end-to-end (via the A028
 * reference walkthrough -- no live model calls, no network, no
 * wall-clock reads), scores it against criteria suites built through
 * the A012 evaluation protocol, checks the scoring inputs through the
 * A013 verification fabric (the receipt's digest-pinned evidence), and
 * produces:
 *
 *   - a published `BenchmarkDescriptor` (citable, content-addressed);
 *   - a `BenchmarkResultRecord` with the full provenance chain
 *     (A012 EvaluationRecord + A013 VerificationRecord + A023
 *     CertificationRecord digests);
 *   - a PUBLIC A014 dataset packaging the benchmark definition AND a
 *     PUBLIC dataset packaging the results (publication semantics per
 *     the A014/A002 discipline);
 *   - an append-only `LeaderboardLedger` with a content-addressed
 *     snapshot.
 *
 * Determinism: every timestamp, seed, correlation id and idempotency
 * key is a fixed suite input; two runs produce byte-identical digests
 * (asserted by the reproducibility suite).
 *
 * benchmarks/* is deliberately NOT a pnpm workspace member (the root
 * pnpm-workspace.yaml -- owned by the Tech Lead -- does not glob it; the
 * same self-contained pattern as examples/software-engineer from A028
 * and research/ from A030): @arena/* sources resolve via tsconfig
 * paths / vitest aliases.
 */

export * from './shared.js';
export * from './suite.js';
export * from './runner.js';
