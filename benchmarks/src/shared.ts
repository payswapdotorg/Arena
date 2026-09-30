/**
 * Fixed suite inputs (Work Order A030): the benchmark never reads the
 * wall clock, never draws entropy -- every input is a declared constant,
 * exactly like the A028 walkthrough's SCENARIO.
 */

/** The benchmark tenant/namespace scope (public research). */
export const BENCH = Object.freeze({
  benchmarkId: 'benchmark-se-repair',
  benchmarkVersion: '1.0.0' as const,
  domain: 'software-engineering',
  title: 'Software Engineer Repair Benchmark v1',
  methodologyId: 'methodology-se-repair',
  methodologyVersion: '1.0.0' as const,
  rubricMethodologyId: 'methodology-se-repair-rubric',
  datasetName: 'dataset-se-repair-benchmark',
  datasetVersion: '1.0.0' as const,
  resultsDatasetName: 'dataset-se-repair-results',
  resultsDatasetVersion: '1.0.0' as const,
  runner: 'arena-benchmark-runner',
  seed: 'arena-benchmark-seed-0001',
  correlationId: 'corr-benchmark-se-repair-0001',
  idempotencyKey: 'idem-benchmark-se-repair-0001',
  startMs: Date.parse('2026-10-01T11:00:00.000Z'),
  t0: '2026-10-01T11:00:00.000Z',
  t1: '2026-10-01T11:01:00.000Z',
  t2: '2026-10-01T11:02:00.000Z',
  t3: '2026-10-01T11:03:00.000Z',
  t4: '2026-10-01T11:04:00.000Z',
} as const);

/** The contamination policy every A030 public benchmark states. */
export const CONTAMINATION_POLICY =
  'task population is the synthetic A028 reference scenario; no customer data and no live-model outputs may enter the population; scores are reference-fabric results, not professional licensure claims';

/** The stated limitation of the reference benchmark. */
export const KNOWN_LIMITATIONS =
  'single reference scenario over one body version and one reference substrate; weighted-sum scoring of three criteria; not a professional licensure claim (R43)';
