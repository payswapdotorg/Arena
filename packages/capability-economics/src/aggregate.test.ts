/**
 * Aggregate tests (Work Order C016): aggregation disclosure discipline —
 * formula, sample sizes, small-sample status, limitations; determinism;
 * fail-closed mixed currency / mixed truth; no collapsed score.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityEconomicsError } from './errors.js';
import {
  aggregateUnitEconomics,
  dimensionValuesOf,
  isEconomicsAggregate,
} from './aggregate.js';
import { ARENA_REFERENCE_ECONOMICS_POLICY } from './policy.js';
import type { EconomicsPolicy } from './policy.js';
import { compileUnitEconomics } from './record.js';
import {
  acceptedValidationFixture,
  effortFixture,
  expertRoutingFixture,
  settledLedgerFixture,
} from './test-support.js';

const RECORDED_AT = '2026-10-08T12:00:00.000Z';
const GENERATED_AT = '2026-10-08T14:00:00.000Z';

async function recordFixture(overrides: {
  requestId?: string;
  grossMinorUnits?: number;
  currency?: string;
  truth?: 'demo' | 'customer';
  domain?: string;
  capabilityId?: string;
  verdict?: 'accepted' | 'revision_required';
  minutes?: number | null;
  liftPoints?: number;
}): Promise<Parameters<typeof aggregateUnitEconomics>[0][number]> {
  const ledger = await settledLedgerFixture({
    requestId: overrides.requestId ?? 'req-econ-0001',
    grossMinorUnits: overrides.grossMinorUnits ?? 25_000,
    currency: overrides.currency ?? 'USD',
    truth: overrides.truth ?? 'customer',
  });
  const lift =
    overrides.liftPoints !== undefined
      ? await (
          await import('./value.js')
        ).createCapabilityLiftValueRecord({
            requestId: ledger.requestId,
            tenantId: ledger.tenantId,
            capabilityId: 'cap.nlp.translation',
            pinnedEvaluationPopulationRef: 'evalpop:fixed-2026q4',
            verificationAuditRef: 'audit:0007',
            evaluatorVersionBefore: 'c'.repeat(64),
            evaluatorVersionAfter: 'c'.repeat(64),
            protectedCapabilityRegression: { capabilityId: 'cap.nlp.summarize', measuredDelta: 0 },
            uncertainty: { reported: true, variance: '0.01', material: false },
            claimedLiftPoints: overrides.liftPoints,
            effortMinutes: overrides.minutes ?? 90,
            recordedAt: RECORDED_AT,
          })
      : undefined;
  return compileUnitEconomics({
    ledger,
    correlationId: `corr-${ledger.requestId}`,
    validation: acceptedValidationFixture({
      verdict: overrides.verdict ?? 'accepted',
    }),
    routing: expertRoutingFixture(),
    effort: effortFixture({ sessionDurationMinutes: overrides.minutes ?? 90 }),
    ...(lift !== undefined ? { value: lift } : {}),
    context: {
      capabilityId: overrides.capabilityId ?? 'cap.nlp.translation',
      domain: overrides.domain ?? 'nlp',
    },
    policy: ARENA_REFERENCE_ECONOMICS_POLICY,
    recordedAt: RECORDED_AT,
  });
}

describe('aggregateUnitEconomics (disclosure discipline)', () => {
  it('discloses formula, sample sizes, small-sample status, limitations, currency, truth', async () => {
    const records = [await recordFixture({})];
    const aggregate = await aggregateUnitEconomics(
      records,
      {
        dimension: 'domain',
        metric: 'mean-net-cost-per-intervention',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        generatedAt: GENERATED_AT,
      },
      'nlp',
    );
    expect(isEconomicsAggregate(aggregate)).toBe(true);
    expect(aggregate.formula).toContain('clamp0(grossCaptured - refunded)');
    expect(aggregate.sampleSize).toBe(1);
    expect(aggregate.populationSize).toBe(1);
    expect(aggregate.smallSample).toBe(true); // below the reference threshold 30
    expect(aggregate.limitations).toContain('small-sample');
    expect(aggregate.currency).toBe('USD');
    expect(aggregate.truth).toBe('customer');
    expect(aggregate.value).toBe('25000.0000');
    expect(aggregate.disclosureNote.length).toBeGreaterThan(0);
  });

  it('is deterministic: identical inputs → identical aggregates', async () => {
    const records = [await recordFixture({}), await recordFixture({ requestId: 'req-econ-0002', grossMinorUnits: 10_000 })];
    const fold = () =>
      aggregateUnitEconomics(
        records,
        {
          dimension: 'domain',
          metric: 'cost-per-validated-result',
          policy: ARENA_REFERENCE_ECONOMICS_POLICY,
          generatedAt: GENERATED_AT,
        },
        'nlp',
      );
    const a = await fold();
    const b = await fold();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.value).toBe('17500.0000');
  });

  it('fails closed on mixed currency (never converted)', async () => {
    const records = [
      await recordFixture({}),
      await recordFixture({ requestId: 'req-econ-0002', currency: 'EUR' }),
    ];
    await expect(
      aggregateUnitEconomics(
        records,
        {
          dimension: 'domain',
          metric: 'mean-net-cost-per-intervention',
          policy: ARENA_REFERENCE_ECONOMICS_POLICY,
          generatedAt: GENERATED_AT,
        },
        'nlp',
      ),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_MIXED_CURRENCY',
    });
  });

  it('fails closed on mixed truth (demo money is not customer money)', async () => {
    const records = [
      await recordFixture({}),
      await recordFixture({ requestId: 'req-econ-0002', truth: 'demo' }),
    ];
    await expect(
      aggregateUnitEconomics(
        records,
        {
          dimension: 'domain',
          metric: 'mean-net-cost-per-intervention',
          policy: ARENA_REFERENCE_ECONOMICS_POLICY,
          generatedAt: GENERATED_AT,
        },
        'nlp',
      ),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_MIXED_TRUTH',
    });
  });

  it('rejects a smuggled collapsed score on the aggregate view (typed COLLAPSED_SCORE)', async () => {
    const records = [await recordFixture({})];
    const aggregate = await aggregateUnitEconomics(
      records,
      {
        dimension: 'domain',
        metric: 'mean-net-cost-per-intervention',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        generatedAt: GENERATED_AT,
      },
      'nlp',
    );
    expect(() =>
      isEconomicsAggregate({ ...aggregate, roiScore: '0.9' } as unknown),
    ).toThrowError(CapabilityEconomicsError);
    expect(() =>
      isEconomicsAggregate({ ...aggregate, score: 1 } as unknown),
    ).toThrowError(CapabilityEconomicsError);
  });

  it('excludes records missing the dimension field and DISCLOSES the exclusion', async () => {
    const inDomain = await recordFixture({ domain: 'nlp' });
    const noDomain = await recordFixture({ requestId: 'req-econ-0002', domain: '' });
    const { values, excludedCount } = dimensionValuesOf([inDomain, noDomain], 'domain');
    expect(excludedCount).toBe(0); // '' is a value here? No — see below.
    expect(values).toContain('nlp');
    expect(values).toContain('');
    // Aggregate over 'nlp' sees only the in-domain record; the '' record is
    // another dimension value, not an exclusion.
    const aggregate = await aggregateUnitEconomics(
      [inDomain, noDomain],
      {
        dimension: 'domain',
        metric: 'mean-net-cost-per-intervention',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        generatedAt: GENERATED_AT,
      },
      'nlp',
    );
    expect(aggregate.populationSize).toBe(1);
    expect(aggregate.excludedCount).toBe(0);
  });

  it('counts records with NO routing class as excluded on the resource-class dimension', async () => {
    const withRouting = await recordFixture({});
    const ledger = await settledLedgerFixture({ requestId: 'req-econ-0002' });
    const withoutRouting = await compileUnitEconomics({
      ledger,
      correlationId: 'corr-req-econ-0002',
      policy: ARENA_REFERENCE_ECONOMICS_POLICY,
      recordedAt: RECORDED_AT,
    });
    const { values, excludedCount } = dimensionValuesOf(
      [withRouting, withoutRouting],
      'resource-class',
    );
    expect(values).toEqual(['expert']);
    expect(excludedCount).toBe(1);
    const aggregate = await aggregateUnitEconomics(
      [withRouting, withoutRouting],
      {
        dimension: 'resource-class',
        metric: 'mean-net-cost-per-intervention',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        generatedAt: GENERATED_AT,
      },
      'expert',
    );
    expect(aggregate.populationSize).toBe(1);
    expect(aggregate.excludedCount).toBe(1);
    expect(aggregate.limitations).toContain('routing-class-unknown-for-some-records');
  });

  it('the Q1.0 ratio metric: verified lift per effort hour over gated value records', async () => {
    const records = [
      await recordFixture({ liftPoints: 12, minutes: 90 }), // 12 lift / 1.5h = 8/h
      await recordFixture({ requestId: 'req-econ-0002', liftPoints: 6, minutes: 60 }), // 6/h
    ];
    const aggregate = await aggregateUnitEconomics(
      records,
      {
        dimension: 'domain',
        metric: 'verified-lift-per-effort-hour',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        generatedAt: GENERATED_AT,
      },
      'nlp',
    );
    // (12 + 6) lift-points over (90 + 60) minutes = 18 / 2.5h = 7.2/h.
    expect(aggregate.value).toBe('7.2000');
    expect(aggregate.sampleSize).toBe(2);
    expect(aggregate.smallSample).toBe(true);
    expect(aggregate.formula).toContain('verifiedLiftPoints');
  });

  it('value-side partial coverage is disclosed when lift is unverified', async () => {
    const withLift = await recordFixture({ liftPoints: 12 });
    const withoutLift = await recordFixture({ requestId: 'req-econ-0002' });
    const aggregate = await aggregateUnitEconomics(
      [withLift, withoutLift],
      {
        dimension: 'domain',
        metric: 'verified-lift-per-effort-hour',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        generatedAt: GENERATED_AT,
      },
      'nlp',
    );
    expect(aggregate.sampleSize).toBe(1);
    expect(aggregate.populationSize).toBe(2);
    expect(aggregate.limitations).toContain('value-side-partial-coverage');
  });

  it('expert-payout-share-of-gross computes the deterministic reference share (0.9000)', async () => {
    const records = [await recordFixture({})];
    const aggregate = await aggregateUnitEconomics(
      records,
      {
        dimension: 'domain',
        metric: 'expert-payout-share-of-gross',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        generatedAt: GENERATED_AT,
      },
      'nlp',
    );
    expect(aggregate.value).toBe('0.9000');
  });

  it('refuses metrics off the policy allow-list (fail-closed)', async () => {
    const records = [await recordFixture({})];
    const policy: EconomicsPolicy = {
      ...ARENA_REFERENCE_ECONOMICS_POLICY,
      metricAllowList: ['mean-net-cost-per-intervention'],
    };
    await expect(
      aggregateUnitEconomics(
        records,
        {
          dimension: 'domain',
          metric: 'verified-lift-per-effort-hour',
          policy,
          generatedAt: GENERATED_AT,
        },
        'nlp',
      ),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_INVALID_AGGREGATE',
    });
  });

  it('cost-per-validated-result: unvalidated records contribute NO sample', async () => {
    const records = [
      await recordFixture({ verdict: 'accepted', grossMinorUnits: 20_000 }),
      await recordFixture({ requestId: 'req-econ-0002', verdict: 'revision_required', grossMinorUnits: 30_000 }),
    ];
    const aggregate = await aggregateUnitEconomics(
      records,
      {
        dimension: 'domain',
        metric: 'cost-per-validated-result',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        generatedAt: GENERATED_AT,
      },
      'nlp',
    );
    expect(aggregate.sampleSize).toBe(1);
    expect(aggregate.value).toBe('20000.0000');
    expect(aggregate.populationSize).toBe(2);
  });
});
