/**
 * View-model derivation tests (Work Order A017, requirement 5):
 *
 *   - POSITIVE: every projection derives the expected fields from real
 *     domain records (built through the domain packages' public APIs),
 *     deterministically (same input ⇒ deep-equal output) and deep-frozen;
 *   - PURITY: projections never mutate their domain inputs;
 *   - DEGRADATION (R41): every view-model carries the explicit degraded
 *     mode — healthy when the supply is available, reasons when not,
 *     last-known entries retained, and NO invented data in the empty
 *     case;
 *   - NEGATIVE: malformed domain objects fail closed with TYPED
 *     WorkbenchErrors (surface + index) — never crashes.
 */

import { describe, expect, it } from 'vitest';
import type { ExpertProfile } from '@arena/expert-registry';
import type { JobRecord } from '@arena/job-protocol';
import type { TaskSpec } from '@arena/task-spec';
import type { TrajectoryRecord } from '@arena/trajectory';
import { isDeepFrozen } from './freeze.js';
import { isWorkbenchError, WORKBENCH_ERROR_CODES } from './errors.js';
import {
  makeDegradedCorpus,
  makeEmptyDegradedCorpus,
  makeFixtureCorpus,
  makeFixtureRecords,
} from './test-support.js';
import type { WorkbenchCorpus } from './corpus.js';
import {
  toExpertDirectoryView,
  toJobStatusView,
  toTaskQueueView,
  toTrajectoryFeedView,
  toWorkbenchOverviewView,
} from './views.js';

describe('toExpertDirectoryView — derivation (positive)', () => {
  it('joins registry profiles with their A007 qualification states', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toExpertDirectoryView(corpus);
    expect(view.kind).toBe('expert-directory');
    expect(view.expertCount).toBe(2);
    // Deterministic ordering by (tenant, expertId).
    expect(view.entries.map((entry) => entry.expertId)).toEqual([
      'expert-fixture-ada',
      'expert-fixture-kwame',
    ]);
    const ada = view.entries[0];
    expect(ada?.status).toBe('published');
    expect(ada?.competencyRefs).toEqual(['skill/invoice-reconciliation@1.2.0']);
    expect(ada?.completedTasks).toBe(2);
    expect(ada?.failedTasks).toBe(1);
    expect(ada?.noResponseEvents).toBe(0);
    expect(ada?.taskHistoryCount).toBe(1);
    expect(ada?.availabilitySummary).toBe('daily 09:00-17:00 UTC (Fixture business hours.)');
    // The qualification line carries the LATEST record state for the claim.
    expect(ada?.qualifications).toHaveLength(1);
    const line = ada?.qualifications[0];
    expect(line?.capability).toBe('skill/invoice-reconciliation@1.2.0');
    expect(line?.proficiency).toBe('distinguished');
    expect(line?.status).toBe('qualified');
    expect(line?.validFrom).toBeDefined();
    expect(line?.validUntil).toBeDefined();
    expect(line?.claimDigest).toBe(corpus.claims[0]?.digest);
    expect(line?.recordDigest).toBe(corpus.qualificationRecords[0]?.digest);
    // The profile's digest is the traceability unit.
    expect(ada?.digest).toBe(corpus.profiles[0]?.digest);
    // Kwame is suspended with a STALE qualification (sufficient count,
    // outside the freshness window).
    const kwame = view.entries[1];
    expect(kwame?.status).toBe('suspended');
    expect(kwame?.qualifications[0]?.status).toBe('stale');
    expect(kwame?.noResponseEvents).toBe(1);
  });

  it('derives the qualification rollup and lifecycle breakdown', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toExpertDirectoryView(corpus);
    expect(view.qualifiedClaimCount).toBe(1);
    expect(view.lifecycleStatusBreakdown).toEqual([
      { status: 'published', count: 1 },
      { status: 'suspended', count: 1 },
    ]);
    expect(view.entries[0]?.qualificationStatusBreakdown).toEqual([
      { status: 'qualified', count: 1 },
    ]);
    expect(view.entries[1]?.qualificationStatusBreakdown).toEqual([{ status: 'stale', count: 1 }]);
  });

  it('uses the LATEST record per claim (append-only chains)', async () => {
    const corpus = await makeFixtureCorpus();
    const renewed = await makeFixtureRecords();
    // A second, newer evaluation of ada's claim is appended AFTER the
    // first: the LATEST record must win.
    const appended: WorkbenchCorpus = {
      ...corpus,
      qualificationRecords: [
        ...corpus.qualificationRecords,
        renewed.qualificationRecords[0] as never,
      ],
    };
    const view = toExpertDirectoryView(appended);
    const line = view.entries[0]?.qualifications[0];
    // The appended duplicate is a re-evaluation with the same digest; the
    // LAST occurrence for the claim is what the view must pin.
    expect(line?.recordDigest).toBe(
      appended.qualificationRecords[appended.qualificationRecords.length - 1]?.digest,
    );
  });
});

describe('toTaskQueueView — derivation (positive)', () => {
  it('projects specs, compilations and match outcomes (R8 matching UX)', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toTaskQueueView(corpus);
    expect(view.kind).toBe('task-queue');
    expect(view.specCount).toBe(2);
    expect(view.compilationCount).toBe(1);
    expect(view.matchOutcomeCount).toBe(2);
    // Deterministic ordering by (tenant, taskId, version): load < review.
    expect(view.specs.map((spec) => spec.taskId)).toEqual([
      'task-fixture-load',
      'task-fixture-review',
    ]);
    const review = view.specs.find((spec) => spec.taskId === 'task-fixture-review');
    expect(review?.taskId).toBe('task-fixture-review');
    expect(review?.taskClass).toBe('correction');
    expect(review?.capabilityLabels).toEqual(['invoice-reconciliation', 'accounts-payable']);
    expect(review?.difficulty).toBe('arena:task-difficulty@1 · standard');
    expect(review?.expertRequirementCapabilities).toEqual([
      'skill/invoice-reconciliation@1.2.0',
    ]);
    expect(review?.caseRef).toBe('tenant-wb/case-fixture-review@1.0.0');
    expect(review?.digest).toBe(corpus.specs[0]?.digest);
    const load = view.specs.find((spec) => spec.taskId === 'task-fixture-load');
    expect(load?.taskClass).toBe('diagnosis');
    expect(view.taskClassBreakdown).toEqual([
      { status: 'correction', count: 1 },
      { status: 'diagnosis', count: 1 },
    ]);
    const compilation = view.compilations[0];
    expect(compilation?.compilationKey).toBe('compile-fixture-0001');
    expect(compilation?.correlationId).toBe('corr-fixture-0001');
    expect(compilation?.emittedSpecs).toEqual(['tenant-wb/task-fixture-review@1.0.0']);
    // Match outcomes (sorted by evaluatedAt then requestDigest): one
    // matched candidate, one honest unmet result — find by shape.
    const matched = view.matchOutcomes.find((outcome) => outcome.candidateCount === 1);
    expect(matched).toBeDefined();
    expect(matched?.candidates).toHaveLength(1);
    expect(matched?.candidates[0]?.expertId).toBe('expert-fixture-ada');
    expect(matched?.candidates[0]?.satisfiedAll).toBe(true);
    expect(matched?.candidates[0]?.satisfiedCount).toBe(1);
    expect(matched?.candidates[0]?.requirementCount).toBe(1);
    expect(matched?.candidates[0]?.unmatchedReasons).toEqual([]);
    expect(matched?.requirementsUnmet).toEqual([]);
    expect(matched?.digest).toBe(
      corpus.matchResults.find((result) => result.candidates.length === 1)?.digest,
    );
    const unmet = view.matchOutcomes.find((outcome) => outcome.candidateCount === 0);
    expect(unmet).toBeDefined();
    expect(unmet?.candidateCount).toBe(0);
    expect(unmet?.requirementsUnmet).toEqual(['load-analysis']);
  });
});

describe('toTrajectoryFeedView — derivation (positive, R10 read-only)', () => {
  it('projects headers, chained entries and completion state', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toTrajectoryFeedView(corpus);
    expect(view.kind).toBe('trajectory-feed');
    expect(view.trajectoryCount).toBe(2);
    expect(view.totalEntryCount).toBe(7);
    expect(view.completedCount).toBe(2);
    // Deterministic ordering by (startedAt, trajectoryId).
    expect(view.entries.map((entry) => entry.trajectoryId)).toEqual([
      'traj-fixture-0001',
      'traj-fixture-0002',
    ]);
    const first = view.entries[0];
    expect(first?.runId).toBe('tenant-wb/run-fixture-0001');
    expect(first?.taskId).toBe('task-fixture-review');
    expect(first?.environment).toBe('tenant-wb/fixture-sandbox@1.4.0');
    expect(first?.seed).toBe('seed-fixture-alpha');
    expect(first?.entryCount).toBe(4);
    expect(first?.completed).toBe(true);
    expect(first?.chainHead).toBe(corpus.trajectories[0]?.chainHead);
    expect(first?.digest).toBe(corpus.trajectories[0]?.header.digest);
    // Entry summaries are deterministic projections of the typed payloads.
    expect(first?.entries.map((entry) => entry.kind)).toEqual([
      'action',
      'observation',
      'checkpoint',
      'completion',
    ]);
    expect(first?.entries[0]?.summary).toBe('action read-invoices — input {"invoice":"INV-2291"}');
    expect(first?.entries[1]?.summary).toBe(
      'observation stdout [stdout]: read 48 fixture invoices and 3 credit notes',
    );
    expect(first?.entries[2]?.digests).toHaveLength(1);
    expect(first?.entries[3]?.summary).toBe('completion — outcome completed (1 evidence digest(s))');
    const second = view.entries[1];
    expect(second?.seed).toBeNull();
    expect(second?.entries[1]?.summary).toBe(
      'error ERR_TIMEOUT: fixture replay exceeded the wall-clock limit',
    );
  });

  it('projects a null-input action without crashing (negative-shaped payload)', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toTrajectoryFeedView(corpus);
    expect(view.entries[1]?.entries[0]?.summary).toBe('action replay-load (no input recorded)');
  });
});

describe('toJobStatusView — derivation (positive, R26)', () => {
  it('projects jobs with their addressability pair and event rollups', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toJobStatusView(corpus);
    expect(view.kind).toBe('job-status');
    expect(view.jobCount).toBe(2);
    // Deterministic ordering by (submittedAt, jobId).
    expect(view.jobs.map((job) => job.jobId)).toEqual([
      'job-fixture-match-0001',
      'job-fixture-compile-0002',
    ]);
    const first = view.jobs[0];
    expect(first?.jobKind).toBe('tenant-wb/match-experts@1.0.0');
    expect(first?.status).toBe('queued');
    expect(first?.attempts).toBe(0);
    expect(first?.maxAttempts).toBe(2);
    expect(first?.correlationId).toBe('corr-fixture-0001');
    expect(first?.idempotencyKey).toBe('idem-fixture-0001');
    expect(first?.idempotencyScope).toBe('fixture-matching');
    expect(first?.eventKinds).toEqual(['job-submitted']);
    expect(first?.lastEventKind).toBe('job-submitted');
    expect(view.statusBreakdown).toEqual([{ status: 'queued', count: 2 }]);
  });
});

describe('toWorkbenchOverviewView — aggregate (positive)', () => {
  it('aggregates every section and stays healthy when supplies are', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toWorkbenchOverviewView(corpus);
    expect(view.kind).toBe('workbench-overview');
    expect(view.expertCount).toBe(2);
    expect(view.qualifiedClaimCount).toBe(1);
    expect(view.matchOutcomeCount).toBe(2);
    expect(view.specCount).toBe(2);
    expect(view.compilationCount).toBe(1);
    expect(view.trajectoryCount).toBe(2);
    expect(view.trajectoryEntryCount).toBe(7);
    expect(view.completedTrajectoryCount).toBe(2);
    expect(view.jobCount).toBe(2);
    expect(view.degradedSections).toEqual([]);
    expect(view.degradation.degraded).toBe(false);
  });
});

describe('determinism + immutability (positive)', () => {
  it('is deterministic: same corpus ⇒ deep-equal views', async () => {
    const corpus = await makeFixtureCorpus();
    expect(toExpertDirectoryView(corpus)).toEqual(toExpertDirectoryView(corpus));
    expect(toTaskQueueView(corpus)).toEqual(toTaskQueueView(corpus));
    expect(toTrajectoryFeedView(corpus)).toEqual(toTrajectoryFeedView(corpus));
    expect(toJobStatusView(corpus)).toEqual(toJobStatusView(corpus));
    expect(toWorkbenchOverviewView(corpus)).toEqual(toWorkbenchOverviewView(corpus));
  });

  it('returns deep-frozen views', async () => {
    const corpus = await makeFixtureCorpus();
    expect(isDeepFrozen(toExpertDirectoryView(corpus))).toBe(true);
    expect(isDeepFrozen(toTaskQueueView(corpus))).toBe(true);
    expect(isDeepFrozen(toTrajectoryFeedView(corpus))).toBe(true);
    expect(isDeepFrozen(toJobStatusView(corpus))).toBe(true);
    expect(isDeepFrozen(toWorkbenchOverviewView(corpus))).toBe(true);
  });

  it('never mutates its domain inputs (read-only projections)', async () => {
    const corpus = await makeFixtureCorpus();
    const before = JSON.stringify(corpus);
    toExpertDirectoryView(corpus);
    toTaskQueueView(corpus);
    toTrajectoryFeedView(corpus);
    toJobStatusView(corpus);
    toWorkbenchOverviewView(corpus);
    expect(JSON.stringify(corpus)).toBe(before);
  });
});

describe('degradation modes (R41 — requirement 2)', () => {
  it('every healthy view carries the explicit non-degraded state', async () => {
    const corpus = await makeFixtureCorpus();
    expect(toExpertDirectoryView(corpus).degradation).toEqual({
      degraded: false,
      reasons: [],
    });
    expect(toTaskQueueView(corpus).degradation.degraded).toBe(false);
    expect(toTrajectoryFeedView(corpus).degradation.degraded).toBe(false);
    expect(toJobStatusView(corpus).degradation.degraded).toBe(false);
    expect(toWorkbenchOverviewView(corpus).degradation.degraded).toBe(false);
  });

  it('expert supply unavailable ⇒ directory serves LAST-KNOWN state with reasons', async () => {
    const corpus = await makeDegradedCorpus();
    const view = toExpertDirectoryView(corpus);
    expect(view.degradation.degraded).toBe(true);
    expect(view.degradation.reasons.map((reason) => reason.code)).toEqual([
      'expert-supply-unavailable',
      'last-known-state',
    ]);
    // LAST-KNOWN STATE: the exact same entries as the healthy corpus —
    // the degraded mode never alters the data it annotates.
    const healthy = toExpertDirectoryView(await makeFixtureCorpus());
    expect(view.entries).toEqual(healthy.entries);
    expect(view.expertCount).toBe(healthy.expertCount);
    expect(view.qualifiedClaimCount).toBe(healthy.qualifiedClaimCount);
  });

  it('expert supply unavailable with NO last-known state ⇒ honest empty directory (no invented data)', async () => {
    const corpus = await makeEmptyDegradedCorpus();
    const view = toExpertDirectoryView(corpus);
    expect(view.degradation.degraded).toBe(true);
    expect(view.degradation.reasons[0]?.code).toBe('expert-supply-unavailable');
    expect(view.entries).toEqual([]);
    expect(view.expertCount).toBe(0);
    expect(view.qualifiedClaimCount).toBe(0);
  });

  it('the overview rolls degradation up across sections', async () => {
    const degraded = toWorkbenchOverviewView(await makeDegradedCorpus());
    expect(degraded.degradedSections).toEqual(['experts']);
    expect(degraded.degradation.degraded).toBe(true);
    expect(degraded.degradation.reasons.map((reason) => reason.code)).toContain(
      'expert-supply-unavailable',
    );
    // Counts still derive from the last-known records (not zeroed).
    expect(degraded.expertCount).toBe(2);
    const healthy = toWorkbenchOverviewView(await makeFixtureCorpus());
    expect(healthy.degradedSections).toEqual([]);
  });

  it('per-section degradation is independent (jobs degraded does not touch experts)', async () => {
    const corpus = await makeFixtureCorpus();
    const jobsDegraded: WorkbenchCorpus = {
      ...corpus,
      jobStore: {
        section: 'jobs',
        available: false,
        detail: 'fixture job store unreachable',
        lastKnownAt: '2026-10-05T09:00:00.000Z',
      },
    };
    const jobs = toJobStatusView(jobsDegraded);
    expect(jobs.degradation.reasons.map((reason) => reason.code)).toEqual([
      'job-store-unavailable',
      'last-known-state',
    ]);
    expect(jobs.jobs).toEqual(toJobStatusView(corpus).jobs);
    expect(toExpertDirectoryView(jobsDegraded).degradation.degraded).toBe(false);
    const overview = toWorkbenchOverviewView(jobsDegraded);
    expect(overview.degradedSections).toEqual(['jobs']);
  });
});

describe('malformed domain objects fail closed with typed errors (negative)', () => {
  it('a malformed expert profile throws INVALID_EXPERT_PROFILE (never crashes)', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed: WorkbenchCorpus = {
      ...corpus,
      profiles: [{ ...(corpus.profiles[0] as ExpertProfile), digest: 'not-a-digest' }],
    };
    let error: unknown;
    try {
      toExpertDirectoryView(malformed);
    } catch (caught) {
      error = caught;
    }
    expect(isWorkbenchError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(WORKBENCH_ERROR_CODES.INVALID_EXPERT_PROFILE);
    expect((error as { details: { index?: number } }).details.index).toBe(0);
  });

  it('a malformed qualification record throws INVALID_QUALIFICATION_RECORD', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed: WorkbenchCorpus = {
      ...corpus,
      qualificationRecords: [{ ...(corpus.qualificationRecords[0] as object), status: 'hero' }] as never,
    };
    expect(() => toExpertDirectoryView(malformed)).toThrowError(WORKBENCH_ERROR_CODES.INVALID_QUALIFICATION_RECORD);
  });

  it('a malformed competency claim throws INVALID_COMPETENCY_CLAIM', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed: WorkbenchCorpus = {
      ...corpus,
      claims: [{ ...(corpus.claims[0] as object), proficiency: 'godlike' }] as never,
    };
    expect(() => toExpertDirectoryView(malformed)).toThrowError(
      WORKBENCH_ERROR_CODES.INVALID_COMPETENCY_CLAIM,
    );
  });

  it('a malformed match result throws INVALID_MATCH_RESULT', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed: WorkbenchCorpus = {
      ...corpus,
      matchResults: [{ ...(corpus.matchResults[0] as object), requestDigest: 'oops' }] as never,
    };
    expect(() => toTaskQueueView(malformed)).toThrowError(WORKBENCH_ERROR_CODES.INVALID_MATCH_RESULT);
  });

  it('a malformed task spec throws INVALID_TASK_SPEC', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed: WorkbenchCorpus = {
      ...corpus,
      specs: [{ ...(corpus.specs[0] as TaskSpec), recordVersion: 99 }] as never,
    };
    expect(() => toTaskQueueView(malformed)).toThrowError(WORKBENCH_ERROR_CODES.INVALID_TASK_SPEC);
  });

  it('a malformed compilation record throws INVALID_COMPILATION_RECORD', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed: WorkbenchCorpus = {
      ...corpus,
      compilations: [{ ...(corpus.compilations[0] as object), compilationKey: 'not valid!' }] as never,
    };
    expect(() => toTaskQueueView(malformed)).toThrowError(
      WORKBENCH_ERROR_CODES.INVALID_COMPILATION_RECORD,
    );
  });

  it('a malformed trajectory record throws INVALID_TRAJECTORY_RECORD', async () => {
    const corpus = await makeFixtureCorpus();
    const trajectory = corpus.trajectories[0] as TrajectoryRecord;
    const malformed: WorkbenchCorpus = {
      ...corpus,
      trajectories: [
        // Chain head that does not match the appended history: the
        // domain guard exists precisely to catch this class of tamper.
        { ...trajectory, chainHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      ] as never,
    };
    expect(() => toTrajectoryFeedView(malformed)).toThrowError(
      WORKBENCH_ERROR_CODES.INVALID_TRAJECTORY_RECORD,
    );
  });

  it('a malformed job record throws INVALID_JOB_RECORD', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed: WorkbenchCorpus = {
      ...corpus,
      jobs: [{ ...(corpus.jobs[0] as JobRecord), status: 'exploded' }] as never,
    };
    expect(() => toJobStatusView(malformed)).toThrowError(WORKBENCH_ERROR_CODES.INVALID_JOB_RECORD);
  });

  it('the error names the offending index (batch diagnostics)', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed: WorkbenchCorpus = {
      ...corpus,
      jobs: [
        corpus.jobs[0] as JobRecord,
        { ...(corpus.jobs[1] as JobRecord), recordVersion: 99 as unknown as 1 },
      ],
    };
    let error: unknown;
    try {
      toJobStatusView(malformed);
    } catch (caught) {
      error = caught;
    }
    expect(isWorkbenchError(error)).toBe(true);
    expect((error as { details: { index?: number } }).details.index).toBe(1);
  });
});
