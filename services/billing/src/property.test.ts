/**
 * Property suite for @arena/billing-service (Work Order A033) — seeded,
 * deterministic invariants: contiguous ledger sequences, window summaries
 * that always reconcile with the ledger, and reproducible statement
 * digests across identically-populated fabrics. No Math.random anywhere.
 */

import { describe, expect, it } from 'vitest';
import type { JobEventKind } from '@arena/job-protocol';
import {
  DAY_WINDOW_START,
  FEATURE_COMPUTE,
  FEATURE_EVALUATE,
  JOB_ALPHA,
  JOB_BETA,
  T0,
  TENANT_ACME,
  createBillingHarness,
  makeJobEventEnvelopeRaw,
  makeRecordUsageCommandRaw,
  seedQuotaGrant,
} from './test-support.js';
import type { BillingHarness } from './test-support.js';

/** Deterministic mulberry32 PRNG (seeded — the property suite is stable). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METERED_KINDS: readonly JobEventKind[] = ['job-started', 'job-completed'];
const UNMETERED_KINDS: readonly JobEventKind[] = ['job-submitted', 'job-progressed', 'job-cancelled'];

interface Ingestion {
  readonly kind: 'job-event' | 'command';
  readonly eventKind?: JobEventKind;
  readonly units?: number;
  readonly jobId?: string;
  readonly key: string;
}

function populate(harness: BillingHarness, plan: readonly Ingestion[]): void {
  for (const step of plan) {
    const minutes = 1 + (step.key.length % 60);
    harness.clock.advance(minutes * 60 * 1000);
    if (step.kind === 'job-event' && step.eventKind !== undefined && step.jobId !== undefined) {
      const sequence = 1 + Number(step.key.split('-')[1]);
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({
          kind: step.eventKind,
          sequence,
          occurredAt: new Date(harness.clock.now()).toISOString(),
          jobId: step.jobId,
          envelopeId: `env-${step.key}`,
        }),
      );
    } else if (step.units !== undefined) {
      harness.service.ingestRecordUsageCommand(
        makeRecordUsageCommandRaw({
          tenantId: TENANT_ACME,
          featureKey: FEATURE_COMPUTE,
          units: step.units,
          idempotencyKey: step.key,
        }),
      );
    }
  }
}

describe('property: ledger and window invariants', () => {
  it('ledger sequences stay contiguous 1..n per (tenant, feature) stream (30 seeded plans)', () => {
    const random = mulberry32(0xa033);
    for (let round = 0; round < 30; round += 1) {
      const harness = createBillingHarness();
      seedQuotaGrant(harness, { limit: 1_000_000 });
      seedQuotaGrant(harness, { grantId: 'grant-quota-002', featureKey: FEATURE_EVALUATE, limit: 1_000_000 });
      harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
      harness.jobIndex.register(JOB_BETA, { tenantId: TENANT_ACME, featureKey: FEATURE_EVALUATE });
      const plan: Ingestion[] = [];
      let key = 0;
      const steps = 3 + Math.floor(random() * 8);
      for (let index = 0; index < steps; index += 1) {
        key += 1;
        const metered = random() < 0.7;
        if (metered) {
          plan.push({
            kind: 'job-event',
            eventKind: METERED_KINDS[Math.floor(random() * METERED_KINDS.length)]!,
            jobId: random() < 0.5 ? JOB_ALPHA : JOB_BETA,
            key: `k-${key}`,
          });
        } else {
          plan.push({
            kind: 'job-event',
            eventKind: UNMETERED_KINDS[Math.floor(random() * UNMETERED_KINDS.length)]!,
            jobId: random() < 0.5 ? JOB_ALPHA : JOB_BETA,
            key: `k-${key}`,
          });
        }
      }
      populate(harness, plan);
      for (const featureKey of [FEATURE_COMPUTE, FEATURE_EVALUATE]) {
        const records = harness.service.listUsageRecords(TENANT_ACME, featureKey);
        expect(records.map((record) => record.sequence)).toEqual(
          records.map((_, index) => index + 1),
        );
        for (const record of records) {
          expect(record.units).toBe(1);
          expect(record.occurredAt >= T0).toBe(true);
        }
      }
    }
  });

  it('day-window summaries always reconcile with the raw ledger (30 seeded plans)', () => {
    const random = mulberry32(0xb033);
    for (let round = 0; round < 30; round += 1) {
      const harness = createBillingHarness();
      seedQuotaGrant(harness, { limit: 1_000_000 });
      const plan: Ingestion[] = [];
      let key = 0;
      const steps = 2 + Math.floor(random() * 6);
      for (let index = 0; index < steps; index += 1) {
        key += 1;
        plan.push({ kind: 'command', units: 1 + Math.floor(random() * 5), key: `k-${key}` });
      }
      populate(harness, plan);
      const summary = harness.service.summarizeWindow(TENANT_ACME, FEATURE_COMPUTE, 'day', DAY_WINDOW_START);
      const records = harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE);
      const expectedUnits = records.reduce((sum, record) => sum + record.units, 0);
      expect(summary.recordCount).toBe(records.length);
      expect(summary.unitsTotal).toBe(expectedUnits);
    }
  });
});

describe('property: reproducible statements', () => {
  it('two identically-populated fabrics seal identical statement digests (20 seeded plans)', async () => {
    const random = mulberry32(0xc033);
    for (let round = 0; round < 20; round += 1) {
      const plan: Ingestion[] = [];
      let key = 0;
      const steps = 2 + Math.floor(random() * 5);
      for (let index = 0; index < steps; index += 1) {
        key += 1;
        plan.push({ kind: 'command', units: 1 + Math.floor(random() * 3), key: `k-${key}` });
      }
      const one = createBillingHarness();
      const two = createBillingHarness();
      for (const harness of [one, two]) {
        seedQuotaGrant(harness, { limit: 1_000_000 });
        populate(harness, plan);
      }
      const draftOne = await one.service.draftStatement({
        tenantId: TENANT_ACME,
        featureKey: FEATURE_COMPUTE,
        window: 'day',
        windowStart: DAY_WINDOW_START,
      });
      const draftTwo = await two.service.draftStatement({
        tenantId: TENANT_ACME,
        featureKey: FEATURE_COMPUTE,
        window: 'day',
        windowStart: DAY_WINDOW_START,
      });
      expect(draftOne.statementDigest).toBe(draftTwo.statementDigest);
      expect(draftOne.statementId).toBe(draftTwo.statementId);
      const issuedOne = await one.service.issueStatement(draftOne.statementId);
      const issuedTwo = await two.service.issueStatement(draftTwo.statementId);
      expect(issuedOne.statementDigest).toBe(issuedTwo.statementDigest);
    }
  });
});
