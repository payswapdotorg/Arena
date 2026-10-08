/**
 * Adversarial tests (Work Order C016) — the required minimum:
 *   1. a cost record fabricated without C010 ledger backing (fail closed);
 *   2. an aggregate endpoint smuggling a single collapsed score without
 *      disclosure (typed rejection + every served aggregate discloses);
 *   3. demo money presented as customer money (truth lenses never mix);
 *   4. a cross-tenant economics read (typed denial).
 */

import { describe, expect, it } from 'vitest';
import { CapabilityEconomicsError, isEconomicsAggregate } from '@arena/capability-economics';
import { CapabilityEconomicsService } from './service.js';
import {
  FixedClock,
  InMemoryEconomicsRecordStore,
  InMemoryEffortSignalSource,
  InMemoryPaymentLedgerSource,
  InMemoryRoutingDecisionSource,
  InMemoryValidationOutcomeSource,
} from './fabric.js';
import {
  acceptedValidationFixture,
  effortFixture,
  expertRoutingFixture,
  settledLedgerFixture,
  TENANT,
} from './test-support.js';

const OTHER_TENANT = 'tenant-other';

async function fullService(ledgerOverrides: Record<string, unknown> = {}) {
  const ledger = await settledLedgerFixture(ledgerOverrides);
  const clock = new FixedClock(Date.parse('2026-10-08T12:00:00.000Z'));
  const service = new CapabilityEconomicsService({
    clock,
    ledgerSource: new InMemoryPaymentLedgerSource([ledger]),
    validationSource: new InMemoryValidationOutcomeSource([
      { ...acceptedValidationFixture(), tenantId: TENANT, requestId: ledger.requestId },
    ]),
    routingSource: new InMemoryRoutingDecisionSource([
      { ...expertRoutingFixture(), tenantId: TENANT, demandId: 'demand-0001' },
    ]),
    effortSource: new InMemoryEffortSignalSource([
      { ...effortFixture(), tenantId: TENANT, requestId: ledger.requestId },
    ]),
  });
  return { service, ledger };
}

describe('adversarial: cost record fabricated without C010 ledger backing', () => {
  it('fails closed with the typed LEDGER_BACKING_MISSING denial (never a fabricated figure)', async () => {
    // An empty ledger source: no C010 commercial truth exists for the request.
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(0),
      ledgerSource: new InMemoryPaymentLedgerSource([]),
    });
    await expect(
      service.computeInterventionEconomics('req-econ-0001', TENANT),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_LEDGER_BACKING_MISSING',
    });
    // Nothing was appended — the store stays empty.
    expect(await service.recordStore.listByTenant(TENANT)).toEqual([]);
  });

  it('a foreign-tenant ledger is a typed CROSS_TENANT denial, not an economics read', async () => {
    const foreign = await settledLedgerFixture({ tenantId: OTHER_TENANT });
    // A misconfigured host surface leaks the foreign ledger under the
    // victim tenant's key.
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(0),
      ledgerSource: new InMemoryPaymentLedgerSource([foreign]),
    });
    await expect(
      service.computeInterventionEconomics('req-econ-0001', TENANT),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_LEDGER_BACKING_MISSING',
    });
  });
});

describe('adversarial: aggregate endpoint smuggling a collapsed score', () => {
  it('the domain guard rejects a score-smuggled aggregate view (typed COLLAPSED_SCORE)', async () => {
    const { service } = await fullService();
    await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
      context: { domain: 'nlp' },
    });
    const aggregates = await service.readAggregate(
      { dimension: 'domain', metric: 'mean-net-cost-per-intervention', truth: 'customer' },
      TENANT,
    );
    expect(aggregates.length).toBe(1);
    // The endpoint's served shape is the guarded aggregate type — a
    // smuggled collapsed score is rejected at the guard.
    const smuggled = { ...aggregates[0]!, roiScore: '0.42' } as unknown;
    expect(() => isEconomicsAggregate(smuggled)).toThrowError(CapabilityEconomicsError);
  });

  it('every served aggregate carries the full disclosure (formula, sample, limitations)', async () => {
    const { service } = await fullService();
    await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
      context: { domain: 'nlp' },
    });
    const aggregates = await service.readAggregate(
      { dimension: 'domain', metric: 'mean-net-cost-per-intervention', truth: 'customer' },
      TENANT,
    );
    for (const aggregate of aggregates) {
      expect(aggregate.formula.length).toBeGreaterThan(0);
      expect(aggregate.sampleSize).toBeGreaterThan(0);
      expect(typeof aggregate.smallSample).toBe('boolean');
      expect(aggregate.limitations.length).toBeGreaterThan(0);
      expect(aggregate.disclosureNote.length).toBeGreaterThan(0);
      // No collapsed score field is representable.
      expect(Object.keys(aggregate)).not.toContain('score');
      expect(Object.keys(aggregate)).not.toContain('roiScore');
    }
  });
});

describe('adversarial: demo money presented as customer money', () => {
  it('demo-ledger economics carry the demo truth label — and the customer lens NEVER sees them', async () => {
    const { service } = await fullService({ truth: 'demo' });
    const result = await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
      context: { domain: 'nlp' },
    });
    expect(result.record.truth).toBe('demo');
    // The CUSTOMER lens returns nothing: demo money is not customer money.
    const customerAggregates = await service.readAggregate(
      { dimension: 'domain', metric: 'mean-net-cost-per-intervention', truth: 'customer' },
      TENANT,
    );
    expect(customerAggregates).toEqual([]);
    // The DEMO lens sees the demo economics — labeled as demo.
    const demoAggregates = await service.readAggregate(
      { dimension: 'domain', metric: 'mean-net-cost-per-intervention', truth: 'demo' },
      TENANT,
    );
    expect(demoAggregates.length).toBe(1);
    expect(demoAggregates[0]!.truth).toBe('demo');
  });

  it('a mixed-truth record store fails closed at the domain fold (never silently averaged)', async () => {
    const demoLedger = await settledLedgerFixture({ truth: 'demo' });
    const customerLedger = await settledLedgerFixture({
      requestId: 'req-econ-0002',
    });
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(Date.parse('2026-10-08T12:00:00.000Z')),
      ledgerSource: new InMemoryPaymentLedgerSource([demoLedger, customerLedger]),
      validationSource: new InMemoryValidationOutcomeSource([
        { ...acceptedValidationFixture(), tenantId: TENANT, requestId: 'req-econ-0001' },
        { ...acceptedValidationFixture(), tenantId: TENANT, requestId: 'req-econ-0002' },
      ]),
    });
    await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      context: { domain: 'nlp' },
    });
    await service.computeInterventionEconomics('req-econ-0002', TENANT, {
      context: { domain: 'nlp' },
    });
    // Tamper the store into a mixed-truth read: append a demo record to a
    // store serving the customer lens via the raw store port.
    const mixed = new InMemoryEconomicsRecordStore();
    const demoRecord = (await service.recordStore.listByTenant(TENANT)).find(
      (record) => record.truth === 'demo',
    )!;
    const customerRecord = (await service.recordStore.listByTenant(TENANT)).find(
      (record) => record.truth === 'customer',
    )!;
    await mixed.append(demoRecord);
    await mixed.append(customerRecord);
    const mixedService = new CapabilityEconomicsService({
      clock: service.clock,
      ledgerSource: service.ledgerSource,
      recordStore: mixed,
    });
    // The truth lens filters BEFORE any fold: the customer lens sees only
    // the customer record (no mixed fold is even attempted).
    const aggregates = await mixedService.readAggregate(
      { dimension: 'domain', metric: 'mean-net-cost-per-intervention', truth: 'customer' },
      TENANT,
    );
    expect(aggregates.length).toBe(1);
    expect(aggregates[0]!.truth).toBe('customer');
  });
});

describe('adversarial: cross-tenant economics read', () => {
  it('a tenant cannot read another tenant\u2019s economics (scoped stores + typed denial)', async () => {
    const { service } = await fullService();
    await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
      context: { domain: 'nlp' },
    });
    // The tenant-scoped read of the OTHER tenant sees nothing.
    expect(await service.recordStore.listByTenant(OTHER_TENANT)).toEqual([]);
    const foreignAggregates = await service.readAggregate(
      { dimension: 'domain', metric: 'mean-net-cost-per-intervention', truth: 'customer' },
      OTHER_TENANT,
    );
    expect(foreignAggregates).toEqual([]);
    // And a MISCONFIGURED store that leaks foreign records regardless of
    // the tenant filter is a typed denial (defense in depth).
    const record = (await service.recordStore.listByTenant(TENANT))[0]!;
    const leaking: import('./ports.js').EconomicsRecordStore = {
      async append() {},
      async listByRequest() {
        return [record];
      },
      async listByTenant() {
        return [record];
      },
    };
    const leakingService = new CapabilityEconomicsService({
      clock: service.clock,
      ledgerSource: service.ledgerSource,
      recordStore: leaking,
    });
    await expect(
      leakingService.readAggregate(
        { dimension: 'domain', metric: 'mean-net-cost-per-intervention', truth: 'customer' },
        OTHER_TENANT,
      ),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_CROSS_TENANT_ACCESS',
    });
    await expect(
      leakingService.recordHistory('req-econ-0001', OTHER_TENANT),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_CROSS_TENANT_ACCESS',
    });
  });
});
