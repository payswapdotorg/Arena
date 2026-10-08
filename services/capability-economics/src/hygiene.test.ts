/**
 * Service hygiene tests (Work Order C016): fail-closed source handling
 * (a broken port is a typed denial, never a silent skip into figures)
 * and the exported surface discipline.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityEconomicsService } from './service.js';
import {
  FixedClock,
  InMemoryPaymentLedgerSource,
  InMemoryValidationOutcomeSource,
} from './fabric.js';
import { acceptedValidationFixture, settledLedgerFixture, TENANT } from './test-support.js';

describe('capability-economics service hygiene', () => {
  it('a THROWING validation source degrades to a missing-input reason (never silent figures)', async () => {
    const ledger = await settledLedgerFixture();
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(Date.parse('2026-10-08T12:00:00.000Z')),
      ledgerSource: new InMemoryPaymentLedgerSource([ledger]),
      validationSource: {
        async loadValidationOutcome() {
          throw new Error('C009 surface down');
        },
      },
    });
    const result = await service.computeInterventionEconomics('req-econ-0001', TENANT);
    expect(result.record.validation).toBeNull();
    expect(result.record.missingInputs).toContain('validation-outcome-unavailable');
    // The commercial figures still ride the ledger truth.
    expect(result.record.commercial.grossCapturedMinorUnits).toBe('25000');
  });

  it('a THROWING ledger source is a typed fail-closed denial (cost figures never fabricated)', async () => {
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(0),
      ledgerSource: {
        async loadLedger() {
          throw new Error('C010 surface down');
        },
      },
    });
    await expect(
      service.computeInterventionEconomics('req-econ-0001', TENANT),
    ).rejects.toMatchObject({ name: 'CapabilityEconomicsError' });
  });

  it('the reference fabric wires deterministic defaults (empty sources, fixed clock)', async () => {
    const service = new CapabilityEconomicsService();
    expect(service.clock.now()).toBe(0);
    expect(await service.validationSource.loadValidationOutcome('req', 'tenant')).toBeNull();
    expect(await service.routingSource.loadRoutingDecision('demand', 'tenant')).toBeNull();
    expect(await service.effortSource.loadEffortSignals('req', 'tenant')).toBeNull();
    expect(await service.valueSource.loadValueRecord('req', 'tenant')).toBeNull();
    expect(await service.recordStore.listByTenant('tenant')).toEqual([]);
    const policy = await service.policyStore.current();
    expect(policy.policyId).toBe('arena-economics-reference');
  });

  it('validation views are tenant-keyed (no cross-tenant leakage in the fabric)', async () => {
    const source = new InMemoryValidationOutcomeSource([
      { ...acceptedValidationFixture(), tenantId: TENANT, requestId: 'req-econ-0001' },
    ]);
    expect(await source.loadValidationOutcome('req-econ-0001', TENANT)).not.toBeNull();
    expect(await source.loadValidationOutcome('req-econ-0001', 'tenant-other')).toBeNull();
  });
});
