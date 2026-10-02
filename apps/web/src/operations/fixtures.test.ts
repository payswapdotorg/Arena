/**
 * Operations demo corpus tests (Work Order B014).
 *
 * Positive: the corpus is DETERMINISTIC (two builds byte-identical) and
 * every object is REAL — A015 job records across the lifecycle, A035
 * evaluations with an honest verdict distribution (including no-data),
 * a verified A034 audit chain, and all four closed FT2.0 capacity states.
 * Adversarial: the session posture's providers read DISABLED
 * (configuration-missing) — fail closed, never unlimited.
 */

import { describe, expect, it } from 'vitest';

import {
  OPERATIONS_DEMO_EPOCH_MS,
  OPERATIONS_DEMO_JOB_IDS,
  OPERATIONS_PROVIDERS,
  buildOperationsDemoCorpus,
  buildSessionProviderHealths,
  buildSloCatalog,
} from './fixtures.js';

describe('operations demo corpus (positive)', () => {
  it('is deterministic: two builds are byte-identical (same hash, same serialization)', async () => {
    const first = await buildOperationsDemoCorpus();
    const second = await buildOperationsDemoCorpus();
    expect(first.corpusHash).toBe(second.corpusHash);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('carries five REAL A015 job records across the lifecycle vocabulary', async () => {
    const corpus = await buildOperationsDemoCorpus();
    expect(corpus.jobs.map((job) => job.status)).toEqual([
      'succeeded',
      'running',
      'queued',
      'failed',
      'cancelled',
    ]);
    expect(corpus.jobs.map((job) => job.jobId)).toEqual([
      OPERATIONS_DEMO_JOB_IDS.regression,
      OPERATIONS_DEMO_JOB_IDS.upload,
      OPERATIONS_DEMO_JOB_IDS.evidence,
      OPERATIONS_DEMO_JOB_IDS.report,
      OPERATIONS_DEMO_JOB_IDS.scan,
    ]);

    const regression = corpus.jobs[0];
    expect(regression?.attempts).toBe(1);
    expect(regression?.attemptHistory[0]?.outcome).toBe('succeeded');
    expect(JSON.stringify(regression?.result)).toContain('green');

    const upload = corpus.jobs[1];
    expect(upload?.attemptHistory[0]?.outcome).toBe('pending');
    expect(upload?.progress?.percent).toBe(45);
    expect(upload?.timeoutAt).toBeDefined();

    const evidence = corpus.jobs[2];
    expect(evidence?.nextRetryAt).toBeDefined();
    expect(evidence?.events.some((event) => event.kind === 'job-retried')).toBe(true);

    const report = corpus.jobs[3];
    expect(report?.attempts).toBe(3);
    expect(report?.failure?.errorClass).toBe('dependency-unavailable');
    expect(report?.events.some((event) => event.kind === 'job-failed')).toBe(true);

    const scan = corpus.jobs[4];
    expect(scan?.cancellation?.reason).toBe('superseded by direct expert review');
  });

  it('evaluates the A035 catalog with an honest verdict distribution (including no-data)', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const verdicts = new Map(corpus.sloEvaluations.map((entry) => [String(entry.sloId), entry.verdict]));
    expect(verdicts.get('slo-job-completion')).toBe('breached');
    expect(verdicts.get('slo-job-latency')).toBe('at-risk');
    expect(verdicts.get('slo-environment-isolation')).toBe('met');
    expect(verdicts.get('slo-runner-lease')).toBe('met');
    expect(verdicts.get('slo-certification-determinism')).toBe('no-data');
    expect(verdicts.get('slo-audit-chain-integrity')).toBe('met');
    expect(verdicts.get('slo-console-availability')).toBe('at-risk');
    expect(verdicts.get('slo-observability-ingestion')).toBe('met');

    const noData = corpus.sloEvaluations.find((entry) => entry.verdict === 'no-data');
    expect(noData?.errorBudget.exhausted).toBe(true);
    expect(noData?.sampleCount).toBe(9);
  });

  it('builds a verified, digest-chained A034 audit stream', async () => {
    const corpus = await buildOperationsDemoCorpus();
    expect(corpus.auditChainVerified).toBe(true);
    expect(corpus.auditRecords).toHaveLength(4);
    for (const [index, record] of corpus.auditRecords.entries()) {
      expect(record.sequence).toBe(index + 1);
      if (index > 0) {
        expect(record.previousDigest).toBe(corpus.auditRecords[index - 1]?.digest);
      }
    }
    expect(corpus.auditHeadDigest).toBe(corpus.auditRecords[3]?.digest);
  });

  it('carries all four closed FT2.0 capacity states across providers (worst-of overall)', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const statuses = new Map(
      corpus.providers.map((entry) => [entry.health.providerId, entry.health.status]),
    );
    expect(statuses.get('control-plane-store')).toBe('AVAILABLE');
    expect(statuses.get('coordination-store')).toBe('DEGRADED');
    expect(statuses.get('object-store')).toBe('EXHAUSTED');
    expect(statuses.get('job-compute')).toBe('DISABLED');
    expect(corpus.capacityOverall.overall).toBe('DISABLED');
    const objectStore = corpus.providers.find(
      (entry) => entry.health.providerId === 'object-store',
    );
    expect(objectStore?.health.reasons.some((reason) => reason.code === 'quota-exhausted')).toBe(
      true,
    );
  });

  it('the SLO catalog validates through the A035 package (8 SLOs)', () => {
    const catalog = buildSloCatalog();
    expect(catalog).toHaveLength(8);
    expect(catalog.map((definition) => definition.sloId)).toContain('slo-job-completion');
    expect(catalog.map((definition) => definition.sloId)).toContain(
      'slo-observability-ingestion',
    );
  });
});

describe('session posture capacity (fail closed)', () => {
  it('every provider reads DISABLED with configuration-missing — never unlimited, never healthy', () => {
    const healths = buildSessionProviderHealths(OPERATIONS_DEMO_EPOCH_MS);
    expect(healths).toHaveLength(OPERATIONS_PROVIDERS.length);
    for (const health of healths) {
      expect(health.status).toBe('DISABLED');
      expect(health.reasons).toEqual([{ code: 'configuration-missing' }]);
      expect(health.dimensions).toEqual([]);
    }
  });

  it('the unwired posture is deterministic for a fixed clock', () => {
    const first = buildSessionProviderHealths(OPERATIONS_DEMO_EPOCH_MS);
    const second = buildSessionProviderHealths(OPERATIONS_DEMO_EPOCH_MS);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
