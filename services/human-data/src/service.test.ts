/**
 * Service integration tests (Work Order C012) — the full commission
 * lifecycle over injected C001/C006/C009/A014 ports on the reference
 * fabric: commission → escalations → C009-accepted sources → rights-gated
 * deliverables → delivered bundle, plus idempotency, production tracking,
 * the acceptance-criteria failure path and the event envelope.
 */

import { describe, expect, it } from 'vitest';

import { verifyDatasetManifest } from '@arena/datasets';
import { HumanDataService } from './service.js';
import { createHumanDataReferenceFabric } from './fabric.js';
import type { HumanDataReferenceFabric } from './fabric.js';
import {
  CONSENT,
  NOW,
  TENANT_A,
  makeAdjudicationOutcome,
  makeCommissionInput,
  makeResult,
} from './test-support.js';

/** The first escalation request id of a submitted commission (fail loudly if missing). */
function firstRequestId(commission: { readonly escalationRequestIds?: readonly string[] }): string {
  const requestId = (commission.escalationRequestIds ?? []).at(0);
  if (requestId === undefined) throw new Error('fixture: no escalation request ids');
  return requestId;
}

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

async function scriptAcceptedSources(
  fabric: HumanDataReferenceFabric,
  requestIds: readonly string[],
): Promise<void> {
  for (const requestId of requestIds) {
    fabric.sources.script(requestId, {
      result: makeResult(),
      adjudication: makeAdjudicationOutcome({ requestId }),
      consent: CONSENT,
      originalSnapshot: { priority: 'P3' },
    });
  }
}

describe('commission → escalation → validated result → delivered bundle', () => {
  it('walks the full lifecycle end-to-end over the injected ports', async () => {
    const { fabric, service } = setup();
    const commission = await service.createCommission(makeCommissionInput({ quantity: 2 }));
    expect(commission.state).toBe('draft');

    const submitted = await service.submitCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    expect(submitted.state).toBe('in_production');
    expect(submitted.escalationRequestIds).toHaveLength(2);
    for (const requestId of submitted.escalationRequestIds ?? []) {
      expect(requestId).toMatch(/^esc_[0-9a-f]{32}$/);
    }

    const projection = await service.trackProduction({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    expect(projection.rows).toHaveLength(2);
    expect(projection.rows.every((row) => row.state === 'created')).toBe(true);
    expect(projection.unreadable).toEqual([]);

    await scriptAcceptedSources(fabric, submitted.escalationRequestIds ?? []);
    const assembled = await service.assembleCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    expect(assembled.outcome).toBe('delivered');
    if (assembled.outcome !== 'delivered') return;
    expect(assembled.commission.state).toBe('delivered');
    expect(assembled.commission.bundleRef?.version).toBe('1.0.0');
    expect(assembled.commission.bundleRef?.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(assembled.deliverables).toHaveLength(2);
    expect(assembled.manifest).not.toBeNull();
    const manifest = assembled.manifest;
    if (manifest === null) throw new Error('fixture: the manifest must be assembled');
    // The delivered manifest verifies through the REUSED A014 guard.
    await expect(verifyDatasetManifest(manifest)).resolves.toBe(
      assembled.commission.bundleRef?.manifestDigest,
    );
    // The bundle ships the C009 verification evidence (no self-certification).
    expect(assembled.manifest?.provenance.verification).toHaveLength(2);

    const eventTypes = fabric.events.events.map((event) => event.eventType);
    expect(eventTypes).toEqual([
      'commission.created',
      'commission.submitted',
      'commission.assembling',
      'commission.delivered',
    ]);
    for (const event of fabric.events.events) {
      expect(event.tenantId).toBe(TENANT_A);
      expect(event.eventId).toBe(`hdev_${commission.commissionId}_${event.eventType}`);
    }
  });

  it('submission is IDEMPOTENT: re-submitting replays the same escalations', async () => {
    const { service } = setup();
    const commission = await service.createCommission(makeCommissionInput({ quantity: 2 }));
    const first = await service.submitCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    const second = await service.submitCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    expect(second.escalationRequestIds).toEqual(first.escalationRequestIds);
    expect(second.commissionId).toBe(first.commissionId);
  });

  it('assembly is IDEMPOTENT after delivery (the bundle ref is the address)', async () => {
    const { fabric, service } = setup();
    const commission = await service.createCommission(makeCommissionInput({ quantity: 1 }));
    const submitted = await service.submitCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    await scriptAcceptedSources(fabric, submitted.escalationRequestIds ?? []);
    const first = await service.assembleCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    expect(first.outcome).toBe('delivered');
    const replay = await service.assembleCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    expect(replay.outcome).toBe('delivered');
    if (replay.outcome !== 'delivered') return;
    expect(replay.manifest).toBeNull();
    expect(replay.commission.bundleRef).toEqual(
      first.outcome === 'delivered' ? first.commission.bundleRef : undefined,
    );
  });

  it('below-threshold acceptance is the honest FAILED outcome (not an exception)', async () => {
    const { fabric, service } = setup();
    const commission = await service.createCommission(
      makeCommissionInput({ quantity: 2, acceptanceCriteria: { criteria: ['c1'], minAcceptedRatio: 1 } }),
    );
    const submitted = await service.submitCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    await scriptAcceptedSources(fabric, [firstRequestId(submitted)]); // only 1 of 2 accepted
    const result = await service.assembleCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    expect(result.outcome).toBe('failed');
    if (result.outcome !== 'failed') return;
    expect(result.commission.state).toBe('failed');
    expect(result.acceptedCount).toBe(1);
    expect(result.quantity).toBe(2);
    expect(result.minAcceptedRatio).toBe(1);
    expect(fabric.events.events.map((event) => event.eventType)).toContain('commission.failed');
  });

  it('an abandoned commission is an explicit terminal state', async () => {
    const { service } = setup();
    const commission = await service.createCommission(makeCommissionInput({ quantity: 1 }));
    const abandoned = await service.abandonCommission({
      commissionId: commission.commissionId,
      tenantId: TENANT_A,
    });
    expect(abandoned.state).toBe('abandoned');
    // Terminal: no further lifecycle step is possible.
    await expect(
      service.submitCommission({ commissionId: commission.commissionId, tenantId: TENANT_A }),
    ).rejects.toMatchObject({ code: 'HUMAN_DATA_INVALID_STATE' });
  });

  it('listCommissions is tenant-scoped and honest (possibly empty)', async () => {
    const { service } = setup();
    expect(await service.listCommissions(TENANT_A)).toEqual([]);
    await service.createCommission(makeCommissionInput({ quantity: 1 }));
    const listed = await service.listCommissions(TENANT_A);
    expect(listed).toHaveLength(1);
    expect(await service.listCommissions('tenant-b')).toEqual([]);
  });
});
