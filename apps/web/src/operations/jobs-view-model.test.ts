/**
 * Jobs view-model tests (Work Order B014).
 *
 * Positive: the full projection of the REAL A015 records — lifecycle
 * states as verified facts, attempts/timestamps from the append-only
 * history, the pending outcome of a running job, the retry backoff gate.
 * Adversarial: malformed payloads degrade TRUTHFULLY (the distinct
 * `unknown` state, named unknown fields, no fabricated timing, no thrown
 * render) — a job can never render an optimistic completion.
 */

import { describe, expect, it } from 'vitest';

import { buildOperationsDemoCorpus, OPERATIONS_DEMO_JOB_IDS } from './fixtures.js';
import {
  JOB_LIFECYCLE_VIEW_STATES,
  toJobDetailView,
  toJobSummaryView,
} from './jobs-view-model.js';

describe('jobs view projection (positive)', () => {
  it('projects the recorded lifecycle states as verified facts of the job record', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const views = corpus.jobs.map((job) => toJobSummaryView(job));
    expect(views.map((view) => view.state)).toEqual([
      'succeeded',
      'running',
      'queued',
      'failed',
      'cancelled',
    ]);
    for (const view of views) {
      expect(view.truthClass).toBe('verified-fact');
      expect(view.readable).toBe(true);
      expect(view.unknownFields).toEqual([]);
      expect(view.jobId).toBeDefined();
      expect(view.kindKey).toContain('arena-demo/');
      expect(view.correlationId).toBeDefined();
      expect(view.attempts).toBeDefined();
      expect(view.submittedAt).toBe('2026-10-01T08:30:00.000Z');
      expect(view.updatedAt).toBeDefined();
    }
  });

  it('a running job renders its pending outcome — never an optimistic completion', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const upload = corpus.jobs.find((job) => job.jobId === OPERATIONS_DEMO_JOB_IDS.upload);
    const view = toJobDetailView(upload);
    expect(view.state).toBe('running');
    expect(view.outcomeNote).toContain('pending');
    expect(view.attempts).toBe(1);
    expect(view.attemptHistory[0]?.outcome).toBe('pending');
    expect(view.progress?.percent).toBe(45);
    expect(view.timeoutAt).toBeDefined();
    expect(view.failure).toBeUndefined();
    expect(view.resultNote).toBeUndefined();
  });

  it('projects the full detail: attempts, events, failure and the retry backoff gate', async () => {
    const corpus = await buildOperationsDemoCorpus();

    const report = toJobDetailView(
      corpus.jobs.find((job) => job.jobId === OPERATIONS_DEMO_JOB_IDS.report),
    );
    expect(report.attempts).toBe(3);
    expect(report.attemptHistory.map((attempt) => attempt.outcome)).toEqual([
      'failed',
      'failed',
      'failed',
    ]);
    expect(report.failure?.errorClass).toBe('dependency-unavailable');
    expect(report.policy.maxAttempts).toBe(3);
    expect(report.policy.retryableErrorClasses).toContain('dependency-unavailable');
    const eventKinds = report.events.map((event) => event.kind);
    expect(eventKinds).toContain('job-submitted');
    expect(eventKinds).toContain('job-retried');
    expect(eventKinds).toContain('job-failed');
    // The append-only event sequence is contiguous, 1-based.
    expect(report.events.map((event) => event.sequence)).toEqual(
      report.events.map((_, index) => index + 1),
    );

    const evidence = toJobDetailView(
      corpus.jobs.find((job) => job.jobId === OPERATIONS_DEMO_JOB_IDS.evidence),
    );
    expect(evidence.state).toBe('queued');
    expect(evidence.nextRetryAt).toBeDefined();
    expect(evidence.outcomeNote).toContain('pending');

    const regression = toJobDetailView(
      corpus.jobs.find((job) => job.jobId === OPERATIONS_DEMO_JOB_IDS.regression),
    );
    expect(regression.resultNote).toContain('green');
    expect(regression.definitionDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('renders exactly the closed lifecycle vocabulary plus unknown', () => {
    expect(JOB_LIFECYCLE_VIEW_STATES).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'unknown',
    ]);
  });
});

describe('jobs view projection (adversarial — truthful degradation)', () => {
  it('degrades structurally unreadable payloads to the distinct unknown state, never throwing', () => {
    const malformed: readonly unknown[] = [
      null,
      undefined,
      42,
      'job',
      {},
      [],
      { recordVersion: 2, status: 'queued' },
      { recordVersion: '1', jobId: 'job-x', status: 'queued' },
    ];
    for (const payload of malformed) {
      const view = toJobSummaryView(payload);
      expect(view.state).toBe('unknown');
      expect(view.truthClass).toBe('unknown');
      expect(view.readable).toBe(false);
      expect(view.unknownFields.length).toBeGreaterThan(0);
      expect(view.outcomeNote).toContain('Unknown');
    }
  });

  it('a foreign status value renders unknown — the closed vocabulary is never guessed', () => {
    const view = toJobSummaryView({
      recordVersion: 1,
      jobId: 'job-foreign',
      status: 'exploded',
      attempts: 2,
      submittedAt: '2026-10-01T08:30:00.000Z',
      updatedAt: '2026-10-01T08:31:00.000Z',
    });
    expect(view.state).toBe('unknown');
    expect(view.truthClass).toBe('unknown');
    expect(view.unknownFields.join(' ')).toContain('exploded');
    // The readable scalar fields still render — the record is degraded, not erased.
    expect(view.jobId).toBe('job-foreign');
    expect(view.attempts).toBe(2);
  });

  it('malformed timestamps never render — no fabricated timing', () => {
    const view = toJobSummaryView({
      recordVersion: 1,
      jobId: 'job-times',
      status: 'succeeded',
      attempts: 1,
      submittedAt: 'yesterday',
      updatedAt: 'soon',
    });
    expect(view.state).toBe('succeeded');
    expect(view.submittedAt).toBeUndefined();
    expect(view.updatedAt).toBeUndefined();
    expect(view.unknownFields).toContain('submittedAt');
    expect(view.unknownFields).toContain('updatedAt');
  });

  it('the detail of a degraded record keeps its truthful state while naming every unknown', () => {
    // The record's status IS 'queued' — that truth renders even when the
    // identity fields are missing; nothing else is fabricated.
    const detail = toJobDetailView({ recordVersion: 1, status: 'queued' });
    expect(detail.state).toBe('queued');
    expect(detail.truthClass).toBe('verified-fact');
    expect(detail.attemptHistory).toEqual([]);
    expect(detail.events).toEqual([]);
    expect(detail.failure).toBeUndefined();
    expect(detail.unknownFields).toContain('jobId');
    expect(detail.unknownFields).toContain('kind identity');
    expect(detail.unknownFields).toContain('attempts');
    expect(detail.unknownFields).toContain('policy snapshot');

    const partial = toJobDetailView({
      recordVersion: 1,
      jobId: 'job-partial',
      status: 'failed',
      attempts: 1,
      attemptHistory: 'not-an-array',
      events: [null, { kind: 'job-failed', sequence: 2, occurredAt: '2026-10-01T08:31:00.000Z' }],
      failure: { kind: 'maybe', errorClass: '', message: 'x' },
    });
    expect(partial.state).toBe('failed');
    expect(partial.unknownFields).toContain('attempt history');
    expect(partial.unknownFields).toContain('event history entry #1');
    // The readable event still renders its kind; the unreadable one degrades in place.
    expect(partial.events[0]?.kind).toBeUndefined();
    expect(partial.events[1]?.kind).toBe('job-failed');
    // A failure with empty pieces is not a failure view — never fabricated.
    expect(partial.failure).toBeUndefined();
  });
});
