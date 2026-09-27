/**
 * The console corpus — the read-only reference dataset the whole control
 * plane renders from (Work Order A018, gates 2, 5, 7).
 *
 * A corpus is a frozen bundle of DOMAIN objects (public types, referenced —
 * never redefined) plus the console-side run/trajectory records that pair
 * environment-protocol objects together. The app-side builder
 * (apps/web/src/console/corpus.ts) instantiates it through the domain
 * packages' public APIs; @arena/control-ui only ever READS it.
 *
 * The read-only guarantee (gate 7) is structural: every projection and
 * renderer in this package is a pure function over the corpus, and the
 * corpus handed to the HTTP server is deep-frozen, so no route can mutate
 * domain state.
 */

import type { BodyVersion } from '@arena/agent-body';
import type { CapabilityCase } from '@arena/capability-case';
import type { JobRecord } from '@arena/job-protocol';
import type { SubstrateRegistration } from '@arena/model-substrate';

import { deepFreeze } from './freeze.js';
import type {
  ConsoleEnvironmentRun,
  DashboardView,
  StatusCount,
  TrajectoryStep,
} from './views.js';
import { toJobView } from './views.js';

/** The read-only dataset rendered by the console. */
export interface ConsoleCorpus {
  readonly cases: readonly CapabilityCase[];
  readonly bodies: readonly BodyVersion[];
  readonly substrates: readonly SubstrateRegistration[];
  readonly jobs: readonly JobRecord[];
  readonly runs: readonly ConsoleEnvironmentRun[];
  /** Steps per run id (run ids are neutral and unique across the corpus). */
  readonly trajectories: Readonly<Record<string, readonly TrajectoryStep[]>>;
}

/** Project a whole corpus into a deep-frozen DashboardView. */
export function toDashboardView(corpus: ConsoleCorpus): DashboardView {
  const caseStatuses = new Map<string, number>();
  for (const caseRecord of corpus.cases) {
    caseStatuses.set(caseRecord.status, (caseStatuses.get(caseRecord.status) ?? 0) + 1);
  }
  const jobStatuses = new Map<string, number>();
  for (const job of corpus.jobs) {
    jobStatuses.set(job.status, (jobStatuses.get(job.status) ?? 0) + 1);
  }
  let trajectoryStepCount = 0;
  for (const steps of Object.values(corpus.trajectories)) {
    trajectoryStepCount += steps.length;
  }
  const caseBreakdown: StatusCount[] = [...caseStatuses.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status));
  const jobBreakdown: StatusCount[] = [...jobStatuses.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status));
  const view: DashboardView = {
    kind: 'dashboard',
    caseCount: corpus.cases.length,
    bodyCount: corpus.bodies.length,
    substrateCount: corpus.substrates.length,
    jobCount: corpus.jobs.length,
    runCount: corpus.runs.length,
    trajectoryStepCount,
    caseStatusBreakdown: caseBreakdown,
    jobStatusBreakdown: jobBreakdown,
    latestCaseDigests: corpus.cases.map((caseRecord) => caseRecord.digest),
    latestJobIds: corpus.jobs.map((job) => toJobView(job).jobId),
  };
  return deepFreeze(view);
}

/** Deep-freeze a corpus (the app builder calls this before serving). */
export function freezeCorpus(corpus: ConsoleCorpus): ConsoleCorpus {
  return deepFreeze({
    cases: [...corpus.cases],
    bodies: [...corpus.bodies],
    substrates: [...corpus.substrates],
    jobs: [...corpus.jobs],
    runs: [...corpus.runs],
    trajectories: { ...corpus.trajectories },
  });
}
