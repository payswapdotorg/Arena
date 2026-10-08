/**
 * Integration tests (Work Order C016): unit economics assembled over
 * injected C009/C010/C015 fakes on the reference fabric — the full
 * compute → append → idempotent replay → supersession → read-model
 * loop, plus the Q1.0 value join.
 */

import { describe, expect, it } from 'vitest';
import { createCapabilityLiftValueRecord } from '@arena/capability-economics';
import { CapabilityEconomicsService } from './service.js';
import {
  FixedClock,
  InMemoryCapabilityLiftValueSource,
  InMemoryEconomicsRecordStore,
  InMemoryEffortSignalSource,
  InMemoryPaymentLedgerSource,
  InMemoryRoutingDecisionSource,
  InMemoryValidationOutcomeSource,
  InMemoryEconomicsPolicyStore,
} from './fabric.js';
import {
  acceptedValidationFixture,
  effortFixture,
  expertRoutingFixture,
  settledLedgerFixture,
  TENANT,
} from './test-support.js';

async function buildService() {
  const ledger = await settledLedgerFixture();
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
    valueSource: new InMemoryCapabilityLiftValueSource([]),
    recordStore: new InMemoryEconomicsRecordStore(),
    policyStore: new InMemoryEconomicsPolicyStore(),
  });
  return { service, ledger, clock };
}

describe('CapabilityEconomicsService (integration over injected fakes)', () => {
  it('computes the full record: C010 figures + C009 outcome + C015 class + effort', async () => {
    const { service } = await buildService();
    const result = await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
    });
    expect(result.outcome).toBe('appended');
    expect(result.record.commercial.grossCapturedMinorUnits).toBe('25000');
    expect(result.record.commercial.platformFeeMinorUnits).toBe('2500');
    expect(result.record.commercial.expertPayoutMinorUnits).toBe('22500');
    expect(result.record.validation?.verdict).toBe('accepted');
    expect(result.record.routing?.primaryResourceClass).toBe('expert');
    expect(result.record.effort?.sessionDurationMinutes).toBe(90);
    expect(result.record.missingInputs).toEqual(['value-record-not-linked']);
    expect(result.record.truth).toBe('customer');
  });

  it('recomputes IDEMPOTENTLY (same substantive state → replay)', async () => {
    const { service } = await buildService();
    const first = await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
    });
    const second = await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
    });
    expect(second.outcome).toBe('replay');
    expect(second.record.economicsId).toBe(first.record.economicsId);
    const history = await service.recordHistory('req-econ-0001', TENANT);
    expect(history.length).toBe(1);
  });

  it('recomputation with CHANGED state is a supersession APPEND (prior retained)', async () => {
    const { service, ledger, clock } = await buildService();
    await service.computeInterventionEconomics('req-econ-0001', TENANT, { demandId: 'demand-0001' });
    clock.advanceTo(Date.parse('2026-10-08T13:00:00.000Z'));
    // The C009 outcome changes (revision round 2) → new substantive state.
    const service2 = new CapabilityEconomicsService({
      clock,
      ledgerSource: new InMemoryPaymentLedgerSource([ledger]),
      validationSource: new InMemoryValidationOutcomeSource([
        {
          ...acceptedValidationFixture({ attemptNumber: 2, verdict: 'revision_required' }),
          tenantId: TENANT,
          requestId: ledger.requestId,
        },
      ]),
      routingSource: new InMemoryRoutingDecisionSource([
        { ...expertRoutingFixture(), tenantId: TENANT, demandId: 'demand-0001' },
      ]),
      effortSource: new InMemoryEffortSignalSource([
        { ...effortFixture(), tenantId: TENANT, requestId: ledger.requestId },
      ]),
      recordStore: service.recordStore,
      policyStore: service.policyStore,
    });
    const superseded = await service2.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
    });
    expect(superseded.outcome).toBe('appended');
    const history = await service.recordHistory('req-econ-0001', TENANT);
    expect(history.length).toBe(2);
    expect(history[0]?.validation?.attemptNumber).toBe(1);
    expect(history[1]?.validation?.attemptNumber).toBe(2);
  });

  it('joins the Q1.0 value record through the value source', async () => {
    const { service, ledger } = await buildService();
    const valueRecord = await createCapabilityLiftValueRecord({
      requestId: ledger.requestId,
      tenantId: TENANT,
      capabilityId: 'cap.nlp.translation',
      pinnedEvaluationPopulationRef: 'evalpop:fixed-2026q4',
      verificationAuditRef: 'audit:0007',
      evaluatorVersionBefore: 'c'.repeat(64),
      evaluatorVersionAfter: 'c'.repeat(64),
      protectedCapabilityRegression: { capabilityId: 'cap.nlp.summarize', measuredDelta: -0.01 },
      uncertainty: { reported: true, variance: '0.021', material: true },
      claimedLiftPoints: 12,
      effortMinutes: 90,
      recordedAt: '2026-10-08T12:00:00.000Z',
    });
    const serviceWith = new CapabilityEconomicsService({
      clock: service.clock,
      ledgerSource: service.ledgerSource,
      validationSource: service.validationSource,
      routingSource: service.routingSource,
      effortSource: service.effortSource,
      valueSource: new InMemoryCapabilityLiftValueSource([valueRecord]),
      recordStore: service.recordStore,
      policyStore: service.policyStore,
    });
    const result = await serviceWith.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
      context: { domain: 'nlp' },
    });
    expect(result.record.value?.liftPoints).toBe(12);
    expect(result.record.context.capabilityId).toBe('cap.nlp.translation');
    expect(result.record.missingInputs).toEqual([]);
  });

  it('serves the dimensional read models with full disclosure', async () => {
    const { service, ledger } = await buildService();
    await service.computeInterventionEconomics('req-econ-0001', TENANT, {
      demandId: 'demand-0001',
      context: { domain: 'nlp' },
    });
    // A second settled escalation of the same domain.
    const secondLedger = await settledLedgerFixture({
      requestId: 'req-econ-0002',
      grossMinorUnits: 10_000,
    });
    const service2 = new CapabilityEconomicsService({
      clock: service.clock,
      ledgerSource: new InMemoryPaymentLedgerSource([ledger, secondLedger]),
      validationSource: new InMemoryValidationOutcomeSource([
        { ...acceptedValidationFixture(), tenantId: TENANT, requestId: 'req-econ-0001' },
        { ...acceptedValidationFixture(), tenantId: TENANT, requestId: 'req-econ-0002' },
      ]),
      routingSource: new InMemoryRoutingDecisionSource([
        { ...expertRoutingFixture(), tenantId: TENANT, demandId: 'demand-0001' },
      ]),
      effortSource: new InMemoryEffortSignalSource([
        { ...effortFixture(), tenantId: TENANT, requestId: 'req-econ-0001' },
        { ...effortFixture({ sessionDurationMinutes: 60 }), tenantId: TENANT, requestId: 'req-econ-0002' },
      ]),
      recordStore: service.recordStore,
      policyStore: service.policyStore,
    });
    await service2.computeInterventionEconomics('req-econ-0002', TENANT, {
      context: { domain: 'nlp' },
    });
    const aggregates = await service2.readAggregate(
      { dimension: 'domain', metric: 'mean-net-cost-per-intervention', truth: 'customer' },
      TENANT,
    );
    expect(aggregates.length).toBe(1);
    const aggregate = aggregates[0]!;
    expect(aggregate.dimensionValue).toBe('nlp');
    expect(aggregate.value).toBe('17500.0000');
    expect(aggregate.sampleSize).toBe(2);
    expect(aggregate.smallSample).toBe(true);
    expect(aggregate.limitations).toContain('small-sample');
    expect(aggregate.formula).toContain('clamp0(grossCaptured - refunded)');
    // The Q1.0 ratio metric over the same population.
    const ratio = await service2.readAggregate(
      { dimension: 'domain', metric: 'mean-effort-minutes-per-intervention', truth: 'customer' },
      TENANT,
    );
    expect(ratio[0]?.value).toBe('75.0000');
  });

  it('absent optional sources degrade to missing-input reasons (fail-closed, honest)', async () => {
    const ledger = await settledLedgerFixture();
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(Date.parse('2026-10-08T12:00:00.000Z')),
      ledgerSource: new InMemoryPaymentLedgerSource([ledger]),
    });
    const result = await service.computeInterventionEconomics(ledger.requestId, TENANT);
    expect([...result.record.missingInputs]).toEqual([
      'validation-outcome-unavailable',
      'routing-decision-unavailable',
      'effort-signals-unavailable',
      'value-record-not-linked',
    ]);
  });
});
