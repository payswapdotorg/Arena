/**
 * The workbench corpus (Work Order A017): the read-only reference dataset
 * the Expert Workbench renders from — the domain records of A006
 * (expert-registry profiles), A007 (qualification claims/records and
 * match results), A008 (TaskSpecs + compilation records), A011
 * (trajectory records) and A015 (job records) — PLUS the per-section
 * supply states that drive graceful degradation (R41).
 *
 * The app-side builder (apps/web/src/workbench/corpus.mjs) instantiates
 * it through the domain packages' public APIs (and the reference service
 * fabrics); @arena/workbench only ever READS it. The read-only guarantee
 * is structural: every projection and renderer in this package is a pure
 * function over the corpus, and the corpus handed to the HTTP transport
 * is deep-frozen, so no route can mutate domain state.
 *
 * Supply states: each section carries an explicit availability record.
 * An unavailable section does NOT remove its records from the corpus —
 * the records it still holds are exactly the LAST-KNOWN state the
 * section renders under its degradation banner (R41); an unavailable
 * section with no records renders an honest empty listing (NO invented
 * data). `lastKnownAt` is the capture time of that snapshot (data, not a
 * clock read — the projection never reads a clock).
 */

import type { CompetencyClaim, MatchResult, QualificationRecord } from '@arena/expert-qualification';
import type { ExpertProfile } from '@arena/expert-registry';
import type { JobRecord } from '@arena/job-protocol';
import type { CompilationRecord, TaskSpec } from '@arena/task-spec';
import type { TrajectoryRecord } from '@arena/trajectory';

import { WORKBENCH_ERROR_CODES, WorkbenchError } from './errors.js';
import { deepFreeze } from './freeze.js';

/** The workbench sections (route-level families). */
export const WORKBENCH_SECTIONS = Object.freeze([
  'experts',
  'tasks',
  'trajectories',
  'jobs',
] as const);

export type WorkbenchSection = (typeof WORKBENCH_SECTIONS)[number];

/**
 * The supply state of one section: whether its live source was available
 * when the snapshot was taken, a neutral human-readable detail, and the
 * capture time of the last-known snapshot rendered when unavailable.
 */
export interface SectionSupplyState {
  readonly section: WorkbenchSection;
  readonly available: boolean;
  readonly detail: string;
  readonly lastKnownAt: string;
}

/** Structural (non-throwing) check for a supply state. */
export function isSectionSupplyState(value: unknown): value is SectionSupplyState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['section'] === 'string' &&
    (WORKBENCH_SECTIONS as readonly string[]).includes(candidate['section']) &&
    typeof candidate['available'] === 'boolean' &&
    typeof candidate['detail'] === 'string' &&
    candidate['detail'].length > 0 &&
    typeof candidate['lastKnownAt'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate['lastKnownAt'])
  );
}

/** Validate one supply state (typed error on malformed input). */
function assertSupplyState(value: unknown, surface: string): SectionSupplyState {
  if (!isSectionSupplyState(value)) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_SUPPLY_STATE, {
      surface,
      message:
        'a section supply state must be { section, available, detail, lastKnownAt } with a closed section name and an ms-precision UTC lastKnownAt',
    });
  }
  return value;
}

/** The read-only dataset rendered by the Expert Workbench. */
export interface WorkbenchCorpus {
  /** R41: the expert supply (registry + qualification/matching) state. */
  readonly expertSupply: SectionSupplyState;
  /** The task queue (A008) supply state. */
  readonly taskQueue: SectionSupplyState;
  /** The trajectory store (A011) supply state. */
  readonly trajectoryStore: SectionSupplyState;
  /** The job store (A015) supply state. */
  readonly jobStore: SectionSupplyState;
  /** Expert registry profiles (A006; last-known when expert supply is degraded). */
  readonly profiles: readonly ExpertProfile[];
  /** Qualification claims (A007). */
  readonly claims: readonly CompetencyClaim[];
  /** Qualification records (A007) — append-only, evaluated states. */
  readonly qualificationRecords: readonly QualificationRecord[];
  /** Match results (A007) — the matching UX data (R8). */
  readonly matchResults: readonly MatchResult[];
  /** TaskSpecs (A008). */
  readonly specs: readonly TaskSpec[];
  /** Compilation records (A008). */
  readonly compilations: readonly CompilationRecord[];
  /** Trajectory records (A011) — read-only feed data (R10). */
  readonly trajectories: readonly TrajectoryRecord[];
  /** Durable job records (A015) — async jobs visibility (R26). */
  readonly jobs: readonly JobRecord[];
}

/**
 * Deep-freeze a corpus (the app builder calls this before serving). Also
 * validates the four supply states, so a malformed corpus fails loudly
 * at the boundary instead of rendering a misleading degraded/healthy
 * page. The domain records themselves are validated per-projection (see
 * views.ts) — defense in depth at both boundaries.
 */
export function freezeWorkbenchCorpus(corpus: WorkbenchCorpus): WorkbenchCorpus {
  assertSupplyState(corpus.expertSupply, 'expertSupply');
  assertSupplyState(corpus.taskQueue, 'taskQueue');
  assertSupplyState(corpus.trajectoryStore, 'trajectoryStore');
  assertSupplyState(corpus.jobStore, 'jobStore');
  return deepFreeze({
    expertSupply: corpus.expertSupply,
    taskQueue: corpus.taskQueue,
    trajectoryStore: corpus.trajectoryStore,
    jobStore: corpus.jobStore,
    profiles: [...corpus.profiles],
    claims: [...corpus.claims],
    qualificationRecords: [...corpus.qualificationRecords],
    matchResults: [...corpus.matchResults],
    specs: [...corpus.specs],
    compilations: [...corpus.compilations],
    trajectories: [...corpus.trajectories],
    jobs: [...corpus.jobs],
  });
}
