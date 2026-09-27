/**
 * View-model projections — positive and negative tests (Work Order A018,
 * gate 2). Every projection must:
 *
 *   - derive its fields from the domain object via digest refs (positive);
 *   - return a DEEP-FROZEN view (positive);
 *   - never mutate its input (negative — structural snapshot compare);
 *   - carry the domain object's content digest for traceability (positive).
 */

import { describe, expect, it } from 'vitest';
import type { CapabilityCase } from '@arena/capability-case';
import { isDeepFrozen } from './freeze.js';
import { toDashboardView } from './corpus.js';
import {
  toBodyView,
  toCaseSummaryView,
  toEnvironmentRunView,
  toJobView,
  toSubstrateView,
  toTrajectoryView,
} from './views.js';
import {
  makeFixtureBody,
  makeFixtureCase,
  makeFixtureCorpus,
  makeFixtureJob,
  makeFixtureRun,
  makeFixtureSteps,
  makeFixtureSubstrate,
  RUN_ID,
} from './test-support.js';

describe('toCaseSummaryView (gate 2)', () => {
  it('projects a capability case with its digest ref (positive)', async () => {
    const caseRecord = await makeFixtureCase();
    const view = toCaseSummaryView(caseRecord);
    expect(view.kind).toBe('case-summary');
    expect(view.tenant).toBe('tenant-fixture');
    expect(view.caseId).toBe('case-fixture');
    expect(view.version).toBe('1.0.0');
    expect(view.status).toBe('draft');
    expect(view.digest).toBe(caseRecord.digest);
    expect(view.evidenceCount).toBe(1);
    expect(view.lifecycleEventCount).toBe(1);
    expect(view.targetCapability).toBe('fixture-capability@1.0.0');
    expect(view.domain).toBe('fixture-domain@1.0.0');
    expect(view.currentBodyRef).toBeUndefined();
    expect(view.currentSubstrateRef).toBeUndefined();
  });

  it('returns a deep-frozen view (positive)', async () => {
    const view = toCaseSummaryView(await makeFixtureCase());
    expect(isDeepFrozen(view)).toBe(true);
    expect(() => {
      (view as unknown as Record<string, unknown>)['status'] = 'resolved';
    }).toThrow();
  });

  it('never mutates the domain case (negative)', async () => {
    const caseRecord = await makeFixtureCase();
    const before = JSON.stringify(caseRecord);
    toCaseSummaryView(caseRecord);
    expect(JSON.stringify(caseRecord)).toBe(before);
    expect(Object.isFrozen(caseRecord)).toBe(true);
  });
});

describe('toBodyView (gate 2)', () => {
  it('projects a body version with its digest ref (positive)', async () => {
    const body = await makeFixtureBody();
    const view = toBodyView(body);
    expect(view.kind).toBe('body');
    expect(view.tenant).toBe('tenant-fixture');
    expect(view.name).toBe('fixture-agent');
    expect(view.digest).toBe(body.digest);
    expect(view.skillsCount).toBe(1);
    expect(view.toolsCount).toBe(1);
    expect(view.parentsCount).toBe(0);
    expect(view.requiredToolCalling).toBe('json-schema');
    expect(view.minContextUnits).toBe(1000);
  });

  it('is deep-frozen and non-mutating (positive + negative)', async () => {
    const body = await makeFixtureBody();
    const before = JSON.stringify(body);
    const view = toBodyView(body);
    expect(isDeepFrozen(view)).toBe(true);
    expect(JSON.stringify(body)).toBe(before);
  });
});

describe('toSubstrateView (gate 2)', () => {
  it('projects a registration with neutral ids and digest refs (positive)', async () => {
    const registration = await makeFixtureSubstrate();
    const view = toSubstrateView(registration);
    expect(view.kind).toBe('substrate');
    expect(view.substrateId).toBe('substrate-fixture');
    expect(view.adapterId).toBe('fixture-adapter');
    expect(view.contentDigest).toBe(registration.substrate.integrity.contentDigest);
    expect(view.registrationDigest).toBe(registration.registrationDigest);
    expect(view.maxContextUnits).toBe(4096);
    expect(view.toolCallingProfile).toBe('json-schema');
  });

  it('is deep-frozen and non-mutating (positive + negative)', async () => {
    const registration = await makeFixtureSubstrate();
    const before = JSON.stringify(registration);
    const view = toSubstrateView(registration);
    expect(isDeepFrozen(view)).toBe(true);
    expect(JSON.stringify(registration)).toBe(before);
  });
});

describe('toJobView (gate 2)', () => {
  it('projects a job record with its addressability pair (positive)', async () => {
    const job = await makeFixtureJob();
    const view = toJobView(job);
    expect(view.kind).toBe('job');
    expect(view.jobId).toBe('job-fixture-0001');
    expect(view.status).toBe('queued');
    expect(view.jobKind).toBe('tenant-fixture/fixture-job-kind@1.0.0');
    expect(view.correlationId).toBe('fixture-correlation-1');
    expect(view.idempotencyKey).toBe('fixture-idempotency-1');
    expect(view.maxAttempts).toBe(2);
    expect(view.lastEventKind).toBe('job-submitted');
    expect(view.failureKind).toBeUndefined();
  });

  it('is deep-frozen and non-mutating (positive + negative)', async () => {
    const job = await makeFixtureJob();
    const before = JSON.stringify(job);
    const view = toJobView(job);
    expect(isDeepFrozen(view)).toBe(true);
    expect(JSON.stringify(job)).toBe(before);
  });
});

describe('toEnvironmentRunView (gate 2)', () => {
  it('projects definition + run address via digest refs (positive)', async () => {
    const run = await makeFixtureRun();
    const view = toEnvironmentRunView(run);
    expect(view.kind).toBe('environment-run');
    expect(view.runId).toBe(RUN_ID);
    expect(view.environment).toBe('tenant-fixture/fixture-sandbox');
    expect(view.environmentDigest).toBe(run.definition.digest);
    expect(view.trajectoryDigest).toBe(run.address.trajectoryDigest);
    expect(view.evidenceDigests).toEqual([run.address.evidenceDigests[0]]);
    expect(view.networkEgress).toBe('default-deny');
    expect(view.filesystemWriteMode).toBe('declared-mounts-only');
  });

  it('is deep-frozen and non-mutating (positive + negative)', async () => {
    const run = await makeFixtureRun();
    const before = JSON.stringify(run);
    const view = toEnvironmentRunView(run);
    expect(isDeepFrozen(view)).toBe(true);
    expect(JSON.stringify(run)).toBe(before);
  });
});

describe('toTrajectoryView (gate 2)', () => {
  it('projects a run trajectory pinned by its trajectory digest (positive)', async () => {
    const run = await makeFixtureRun();
    const steps = makeFixtureSteps();
    const view = toTrajectoryView(run.address, steps);
    expect(view.kind).toBe('trajectory');
    expect(view.runId).toBe(RUN_ID);
    expect(view.stepCount).toBe(2);
    expect(view.steps[0]?.action).toBe('fixture-action: read inputs');
    expect(view.trajectoryDigest).toBe(run.address.trajectoryDigest);
  });

  it('is deep-frozen and does not alias the input steps (negative)', async () => {
    const run = await makeFixtureRun();
    const steps = makeFixtureSteps();
    const view = toTrajectoryView(run.address, steps);
    expect(isDeepFrozen(view)).toBe(true);
    // Mutating the ORIGINAL steps must not affect the frozen view (and
    // vice versa — the view owns a copy).
    expect(() => {
      ((steps as unknown) as { action: string }[])[0]!.action = 'tampered';
    }).not.toThrow();
    expect(view.steps[0]?.action).toBe('fixture-action: read inputs');
  });
});

describe('toDashboardView (gate 2)', () => {
  it('aggregates counts and breakdowns over the corpus (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toDashboardView(corpus);
    expect(view.kind).toBe('dashboard');
    expect(view.caseCount).toBe(1);
    expect(view.bodyCount).toBe(1);
    expect(view.substrateCount).toBe(1);
    expect(view.jobCount).toBe(1);
    expect(view.runCount).toBe(1);
    expect(view.trajectoryStepCount).toBe(2);
    expect(view.caseStatusBreakdown).toEqual([{ status: 'draft', count: 1 }]);
    expect(view.jobStatusBreakdown).toEqual([{ status: 'queued', count: 1 }]);
    expect(view.latestCaseDigests).toEqual([corpus.cases[0]?.digest]);
    expect(view.latestJobIds).toEqual(['job-fixture-0001']);
  });

  it('is deep-frozen and does not consume the corpus (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const before = JSON.stringify(corpus);
    const view = toDashboardView(corpus);
    expect(isDeepFrozen(view)).toBe(true);
    expect(JSON.stringify(corpus)).toBe(before);
    // The corpus input is a plain (unfrozen) fixture here; projection must
    // not have frozen the DOMAIN objects it read from.
    expect(Object.isFrozen(corpus.cases[0] as CapabilityCase)).toBe(true); // domain ctor froze it
  });
});
