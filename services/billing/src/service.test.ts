/**
 * Positive service suite for @arena/billing-service (Work Order A033;
 * requirements R31, R34, R48): job-event usage ingestion with the closed
 * metering table, direct-command ingestion, idempotent replays, UTC window
 * aggregation, statement drafting/issuing with digest seals and locked
 * windows.
 */

import { describe, expect, it } from 'vitest';
import { BILLING_ERROR_CODES } from './errors.js';
import type { UsageRecord } from './shared.js';
import {
  DAY_WINDOW_START,
  FEATURE_COMPUTE,
  FEATURE_EVALUATE,
  JOB_ALPHA,
  JOB_BETA,
  MONTH_WINDOW_START,
  NEXT_DAY_WINDOW_START,
  NEXT_MONTH_WINDOW_START,
  T0,
  T1,
  T2,
  T3,
  T4,
  TENANT_ACME,
  COMPUTE_UNIT_PRICE_MICROS,
  createBillingHarness,
  makeJobEventEnvelopeRaw,
  makeRecordUsageCommandRaw,
  seedFlagGrant,
  seedQuotaGrant,
} from './test-support.js';

describe('usage ingestion from job events', () => {
  it('meters lifecycle milestones at their closed unit costs', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });

    const submitted = harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-submitted', sequence: 1, occurredAt: T0, jobId: JOB_ALPHA, envelopeId: 'env-001' }),
    );
    expect(submitted.metered).toBe(false);
    expect(submitted.reason).toBe('not-metered');

    const started = harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-started', sequence: 2, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-002' }),
    );
    expect(started.metered).toBe(true);
    expect(started.reason).toBe('metered');
    expect(started.record?.units).toBe(1);
    expect(started.record?.source).toBe('job-event');
    expect(started.record?.jobId).toBe(JOB_ALPHA);
    expect(started.record?.sequence).toBe(1);

    const progressed = harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-progressed', sequence: 3, occurredAt: T2, jobId: JOB_ALPHA, envelopeId: 'env-003' }),
    );
    expect(progressed.metered).toBe(false);

    const completed = harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 4, occurredAt: T3, jobId: JOB_ALPHA, envelopeId: 'env-004' }),
    );
    expect(completed.metered).toBe(true);
    expect(completed.record?.units).toBe(1);
    expect(completed.record?.sequence).toBe(2);

    expect(harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE)).toHaveLength(2);
  });

  it('replays an already-ingested envelope idempotently (no double metering)', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    const raw = makeJobEventEnvelopeRaw({ kind: 'job-started', sequence: 1, occurredAt: T0, jobId: JOB_ALPHA, envelopeId: 'env-010' });

    const first = harness.service.ingestJobEventEnvelope(raw);
    const replay = harness.service.ingestJobEventEnvelope(raw);
    expect(first.reason).toBe('metered');
    expect(replay.reason).toBe('idempotent-replay');
    expect(replay.record?.usageId).toBe(first.record?.usageId);
    expect(harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE)).toHaveLength(1);
  });

  it('meters per (tenant, feature) stream independently with contiguous sequences', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    harness.jobIndex.register(JOB_BETA, { tenantId: TENANT_ACME, featureKey: FEATURE_EVALUATE });
    seedFlagGrant(harness, { featureKey: FEATURE_EVALUATE, enabled: true });
    seedQuotaGrant(harness, { grantId: 'grant-quota-002', featureKey: FEATURE_EVALUATE, limit: 100 });

    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-started', sequence: 1, occurredAt: T0, jobId: JOB_ALPHA, envelopeId: 'env-a1' }),
    );
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 2, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-a2' }),
    );
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-started', sequence: 1, occurredAt: T1, jobId: JOB_BETA, envelopeId: 'env-b1' }),
    );

    const compute = harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE);
    const evaluate = harness.service.listUsageRecords(TENANT_ACME, FEATURE_EVALUATE);
    expect(compute.map((record) => record.sequence)).toEqual([1, 2]);
    expect(evaluate.map((record) => record.sequence)).toEqual([1]);
  });
});

describe('direct-command usage ingestion', () => {
  it('meters record-usage commands at the injected clock time', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    const outcome = harness.service.ingestRecordUsageCommand(
      makeRecordUsageCommandRaw({
        tenantId: TENANT_ACME,
        featureKey: FEATURE_COMPUTE,
        units: 4,
        idempotencyKey: 'cmd-001',
      }),
    );
    expect(outcome.metered).toBe(true);
    expect(outcome.record?.units).toBe(4);
    expect(outcome.record?.source).toBe('direct-command');
    expect(outcome.record?.occurredAt).toBe(T0);
    expect(outcome.record?.recordedAt).toBe(T0);
  });

  it('replays a command idempotently by its idempotency key', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    const raw = makeRecordUsageCommandRaw({
      tenantId: TENANT_ACME,
      featureKey: FEATURE_COMPUTE,
      units: 2,
      idempotencyKey: 'cmd-replay',
    });
    const first = harness.service.ingestRecordUsageCommand(raw);
    const replay = harness.service.ingestRecordUsageCommand(raw);
    expect(first.reason).toBe('metered');
    expect(replay.reason).toBe('idempotent-replay');
    expect(replay.record?.usageId).toBe(first.record?.usageId);
    expect(harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE)).toHaveLength(1);
  });
});

describe('metered aggregation windows', () => {
  it('aggregates usage into UTC day windows', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-started', sequence: 1, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-w1' }),
    );
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 2, occurredAt: T3, jobId: JOB_ALPHA, envelopeId: 'env-w2' }),
    );
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-started', sequence: 3, occurredAt: T4, jobId: JOB_ALPHA, envelopeId: 'env-w3' }),
    );

    const day = harness.service.summarizeWindow(TENANT_ACME, FEATURE_COMPUTE, 'day', DAY_WINDOW_START);
    expect(day.recordCount).toBe(2);
    expect(day.unitsTotal).toBe(2);
    expect(day.windowEnd).toBe(NEXT_DAY_WINDOW_START);

    const nextDay = harness.service.summarizeWindow(TENANT_ACME, FEATURE_COMPUTE, 'day', NEXT_DAY_WINDOW_START);
    expect(nextDay.recordCount).toBe(1);
    expect(nextDay.unitsTotal).toBe(1);
  });

  it('aggregates usage into UTC month windows', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    for (let index = 0; index < 4; index += 1) {
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({
          kind: 'job-completed',
          sequence: index + 1,
          occurredAt: index < 3 ? [T0, T1, T3][index]! : T4,
          jobId: JOB_ALPHA,
          envelopeId: `env-m${index}`,
        }),
      );
    }
    const month = harness.service.summarizeWindow(TENANT_ACME, FEATURE_COMPUTE, 'month', MONTH_WINDOW_START);
    expect(month.recordCount).toBe(4);
    expect(month.unitsTotal).toBe(4);
    expect(month.windowEnd).toBe(NEXT_MONTH_WINDOW_START);
  });

  it('enforces day-window quotas across the aggregated window', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 3 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    for (let index = 0; index < 3; index += 1) {
      const outcome = harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({
          kind: 'job-completed',
          sequence: index + 1,
          occurredAt: [T0, T1, T2][index]!,
          jobId: JOB_ALPHA,
          envelopeId: `env-q${index}`,
        }),
      );
      expect(outcome.metered).toBe(true);
    }
    expect(
      harness.service.summarizeWindow(TENANT_ACME, FEATURE_COMPUTE, 'day', DAY_WINDOW_START).unitsTotal,
    ).toBe(3);
  });
});

describe('usage statements', () => {
  function draftableHarness() {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-started', sequence: 1, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-s1' }),
    );
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 2, occurredAt: T3, jobId: JOB_ALPHA, envelopeId: 'env-s2' }),
    );
    return harness;
  }

  it('drafts a priced, digest-sealed statement over a window', async () => {
    const harness = draftableHarness();
    const draft = await harness.service.draftStatement({
      tenantId: TENANT_ACME,
      featureKey: FEATURE_COMPUTE,
      window: 'day',
      windowStart: DAY_WINDOW_START,
    });

    expect(draft.status).toBe('draft');
    expect(draft.recordCount).toBe(2);
    expect(draft.unitsTotal).toBe(2);
    expect(draft.amountMicros).toBe(2 * COMPUTE_UNIT_PRICE_MICROS);
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0]?.unitPriceMicros).toBe(COMPUTE_UNIT_PRICE_MICROS);
    expect(draft.lineage.map((entry) => entry.kind)).toEqual(['drafted']);
    expect(await harness.service.verifyStatement(draft)).toBe(true);
  });

  it('issues a draft terminally and appends the issued lineage entry', async () => {
    const harness = draftableHarness();
    const draft = await harness.service.draftStatement({
      tenantId: TENANT_ACME,
      featureKey: FEATURE_COMPUTE,
      window: 'day',
      windowStart: DAY_WINDOW_START,
    });
    const issued = await harness.service.issueStatement(draft.statementId);

    expect(issued.status).toBe('issued');
    expect(issued.issuedAt).toBeDefined();
    expect(issued.lineage.map((entry) => entry.kind)).toEqual(['drafted', 'issued']);
    expect(issued.statementDigest).not.toBe(draft.statementDigest);
    expect(await harness.service.verifyStatement(issued)).toBe(true);

    const stored = harness.service.getStatementForTenant(TENANT_ACME, issued.statementId);
    expect(stored.status).toBe('issued');
    expect(stored.statementDigest).toBe(issued.statementDigest);
  });

  it('locks the stated window: late usage into it is rejected', async () => {
    const harness = draftableHarness();
    await harness.service.draftStatement({
      tenantId: TENANT_ACME,
      featureKey: FEATURE_COMPUTE,
      window: 'day',
      windowStart: DAY_WINDOW_START,
    });

    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 3, occurredAt: '2026-02-01T23:00:00.000Z', jobId: JOB_ALPHA, envelopeId: 'env-late' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.WINDOW_LOCKED }),
    );
  });

  it('the ledger itself rejects appends into a stated window (defense in depth)', async () => {
    const harness = draftableHarness();
    await harness.service.draftStatement({
      tenantId: TENANT_ACME,
      featureKey: FEATURE_COMPUTE,
      window: 'day',
      windowStart: DAY_WINDOW_START,
    });
    const records = harness.ledger.listForTenantFeature(TENANT_ACME, FEATURE_COMPUTE);
    const last = records[records.length - 1] as UsageRecord;
    expect(() =>
      harness.ledger.append({
        ...last,
        usageId: 'usage-late',
        sequence: last.sequence + 1,
        idempotencyKey: 'job-event:env-late-direct',
      }),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.WINDOW_LOCKED }),
    );
  });
});
