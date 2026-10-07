/**
 * Negative/adversarial tests (Work Order C012, services/human-data) —
 * cross-tenant access fails closed, the consent wall holds at the service
 * boundary, non-ACCEPTED sources never deliver, the typed lifecycle refuses
 * illegal steps, and failures are normalized fail-closed.
 */

import { describe, expect, it } from 'vitest';

import { HUMAN_DATA_ERROR_CODES } from '@arena/human-data';
import { HumanDataService } from './service.js';
import { createHumanDataReferenceFabric } from './fabric.js';
import type { HumanDataReferenceFabric } from './fabric.js';
import {
  CONSENT,
  NOW,
  TENANT_A,
  TENANT_B,
  makeAdjudicationOutcome,
  makeCommissionInput,
  makeResult,
} from './test-support.js';

function setup(atMs: number = NOW): { readonly fabric: HumanDataReferenceFabric; readonly service: HumanDataService } {
  const fabric = createHumanDataReferenceFabric(atMs);
  const service = new HumanDataService({
    clock: fabric.clock,
    store: fabric.store,
    escalations: fabric.escalations,
    sources: fabric.sources,
    events: fabric.events,
  });
  return { fabric, service };
}

async function submittedCommission(service: HumanDataService, quantity = 1) {
  const commission = await service.createCommission(makeCommissionInput({ quantity }));
  const submitted = await service.submitCommission({
    commissionId: commission.commissionId,
    tenantId: TENANT_A,
  });
  return { commission, submitted };
}

describe('cross-tenant isolation (customer data never crosses tenants)', () => {
  it('every tenant-scoped operation fails closed for the wrong tenant', async () => {
    const { service } = setup();
    const { commission } = await submittedCommission(service);
    for (const attempt of [
      () => service.getCommission({ commissionId: commission.commissionId, tenantId: TENANT_B }),
      () => service.submitCommission({ commissionId: commission.commissionId, tenantId: TENANT_B }),
      () =>
        service.trackProduction({ commissionId: commission.commissionId, tenantId: TENANT_B }),
      () =>
        service.assembleCommission({ commissionId: commission.commissionId, tenantId: TENANT_B }),
      () => service.abandonCommission({ commissionId: commission.commissionId, tenantId: TENANT_B }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: HUMAN_DATA_ERROR_CODES.CROSS_TENANT,
      });
    }
  });

  it('a cross-tenant deliverable source is never collected', async () => {
    const { fabric, service } = setup();
    const { submitted } = await submittedCommission(service, 1);
    const requestId = (submitted.escalationRequestIds ?? [])[0];
    fabric.sources.script(requestId, {
      result: makeResult(),
      adjudication: makeAdjudicationOutcome({ requestId, tenantId: TENANT_B }),
      consent: CONSENT,
    });
    // The scripted source is tenant-b: the port returns undefined for
    // tenant-a, the item counts as not accepted, and the commission fails
    // its acceptance criteria honestly (never a cross-tenant derivation).
    const result = await service.assembleCommission({
      commissionId: submitted.commissionId,
      tenantId: TENANT_A,
    });
    expect(result.outcome).toBe('failed');
  });
});

describe('the walls hold at the service boundary (fail closed)', () => {
  it('ADVERSARIAL: a source without granted consent NEVER enters the delivered bundle', async () => {
    const { fabric, service } = setup();
    const { submitted } = await submittedCommission(service, 1);
    const requestId = (submitted.escalationRequestIds ?? [])[0];
    fabric.sources.script(requestId, {
      result: makeResult(),
      adjudication: makeAdjudicationOutcome({ requestId }),
      consent: { granted: false, statement: 'expert declined reuse rights' },
    });
    await expect(
      service.assembleCommission({ commissionId: submitted.commissionId, tenantId: TENANT_A }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.CONSENT_WALL });
  });

  it('ADVERSARIAL: a REVISION_REQUIRED outcome never becomes a deliverable', async () => {
    const { fabric, service } = setup();
    const { submitted } = await submittedCommission(service, 1);
    const requestId = (submitted.escalationRequestIds ?? [])[0];
    fabric.sources.script(requestId, {
      result: makeResult(),
      adjudication: makeAdjudicationOutcome({ requestId, verdict: 'REVISION_REQUIRED' }),
      consent: CONSENT,
    });
    await expect(
      service.assembleCommission({ commissionId: submitted.commissionId, tenantId: TENANT_A }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.VALIDATION_GATE });
  });

  it('assembly on a draft commission is refused (typed lifecycle)', async () => {
    const { service } = setup();
    const commission = await service.createCommission(makeCommissionInput({ quantity: 1 }));
    await expect(
      service.assembleCommission({ commissionId: commission.commissionId, tenantId: TENANT_A }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.INVALID_STATE });
  });

  it('an unknown commission id fails closed (indistinguishable from cross-tenant)', async () => {
    const { service } = setup();
    await expect(
      service.getCommission({ commissionId: 'hd_33333333333333333333333333333333', tenantId: TENANT_A }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.CROSS_TENANT });
  });

  it('unexpected failures are normalized fail-closed (never swallowed)', async () => {
    const fabric = createHumanDataReferenceFabric(NOW);
    const breaking = {
      ...fabric,
      escalations: {
        create: () => Promise.reject(new Error('C001 seam unavailable')),
        get: () => Promise.resolve(undefined),
      },
    };
    const service = new HumanDataService({
      clock: breaking.clock,
      store: breaking.store,
      escalations: breaking.escalations,
      sources: breaking.sources,
      events: breaking.events,
    });
    const commission = await service.createCommission(makeCommissionInput({ quantity: 1 }));
    await expect(
      service.submitCommission({ commissionId: commission.commissionId, tenantId: TENANT_A }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.UNKNOWN_ERROR });
  });
});
