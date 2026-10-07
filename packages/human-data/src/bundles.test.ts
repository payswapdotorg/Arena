/**
 * Dataset assembly tests (Work Order C012) — the A014 manifest vocabulary,
 * bundle assembly determinism, the rights wall at assembly time
 * (adversarial: a deliverable without consent entering a bundle MUST fail
 * closed), cross-tenant assembly, supersession lineage, and the delivery
 * descriptor's download permission.
 */

import { describe, expect, it } from 'vitest';

import { verifyDatasetManifest } from '@arena/datasets';

import type { HumanDataCommission, DeliverableRecord } from './index.js';
import {
  HUMAN_DATA_ERROR_CODES,
  assembleHumanDataset,
  describeHumanDatasetDelivery,
  deriveDeliverable,
} from './index.js';
import { makeAdjudicationOutcome, makeCommission, makeResult } from './test-support.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const CONSENT = {
  granted: true,
  statement: 'Expert grants reuse rights for the produced records.',
};

async function makeDeliverableFor(
  commission: HumanDataCommission,
  index: number,
): Promise<DeliverableRecord> {
  const requestId = `esc_${String(index).padStart(32, '0')}`;
  return deriveDeliverable({
    commission,
    result: makeResult('correction'),
    adjudication: makeAdjudicationOutcome({ requestId, tenantId: commission.tenantId }),
    consent: CONSENT,
    originalSnapshot: { priority: 'P3' },
    now: NOW,
  });
}

describe('assembleHumanDataset (the A014 vocabulary, walled)', () => {
  it('assembles a verifiable immutable manifest with spec, output and eval entries', async () => {
    const commission = await makeCommission({ quantity: 2 });
    const deliverables = [
      await makeDeliverableFor(commission, 1),
      await makeDeliverableFor(commission, 2),
    ];
    const assembly = await assembleHumanDataset({ commission, deliverables, now: NOW });
    expect(assembly.deliverableCount).toBe(2);
    // 1 input (spec) + 2 output + 2 eval entries.
    expect(assembly.manifest.entries).toHaveLength(5);
    expect(assembly.manifest.entries.filter((entry) => entry.role === 'input')).toHaveLength(1);
    expect(assembly.manifest.entries.filter((entry) => entry.role === 'output')).toHaveLength(2);
    expect(assembly.manifest.entries.filter((entry) => entry.role === 'eval')).toHaveLength(2);
    expect(assembly.artifacts).toHaveLength(5);
    await expect(verifyDatasetManifest(assembly.manifest)).resolves.toBe(assembly.manifest.digest);
    expect(assembly.manifest.identity).toEqual({
      namespace: 'tenant-a',
      name: 'triage-corrections',
      version: '1.0.0',
    });
  });

  it('the manifest carries tenant-scoped provenance, the declared rights and C009 verification refs', async () => {
    const commission = await makeCommission({ quantity: 1 });
    const deliverables = [await makeDeliverableFor(commission, 1)];
    const assembly = await assembleHumanDataset({ commission, deliverables, now: NOW });
    expect(assembly.manifest.provenance.creator).toEqual({
      type: 'user',
      tenant: 'tenant-a',
      principalId: 'studio-app',
    });
    expect(assembly.manifest.provenance.rights).toEqual(commission.rights);
    expect(assembly.manifest.provenance.verification).toHaveLength(1);
    expect(assembly.manifest.provenance.verification[0].kind).toBe('verification');
    expect(assembly.manifest.provenance.verification[0].evidence.namespace).toBe('tenant-a');
    expect(assembly.manifest.provenance.parents).toEqual([]);
  });

  it('assembly is DETERMINISTIC: same commission + deliverables ⇒ same manifest digest', async () => {
    const commission = await makeCommission({ quantity: 2 });
    const deliverables = [
      await makeDeliverableFor(commission, 1),
      await makeDeliverableFor(commission, 2),
    ];
    const first = await assembleHumanDataset({ commission, deliverables, now: NOW });
    const second = await assembleHumanDataset({ commission, deliverables, now: NOW });
    expect(second.manifest.digest).toBe(first.manifest.digest);
    expect(second.manifest.entriesChecksum).toBe(first.manifest.entriesChecksum);
  });

  it('ADVERSARIAL: a deliverable without consent entering a bundle FAILS CLOSED', async () => {
    const commission = await makeCommission({ quantity: 2 });
    const deliverables = [
      await makeDeliverableFor(commission, 1),
      await makeDeliverableFor(commission, 2),
    ];
    // A record whose consent statement was flipped to not-granted after
    // derivation (the wall must hold at ASSEMBLY, not only at derivation).
    const unconsented: DeliverableRecord = {
      ...deliverables[1],
      consent: { granted: false, statement: 'expert declined reuse rights' },
    };
    await expect(
      assembleHumanDataset({ commission, deliverables: [deliverables[0], unconsented], now: NOW }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.CONSENT_WALL });
  });

  it('ADVERSARIAL: cross-tenant assembly is rejected', async () => {
    const commission = await makeCommission({ quantity: 1 });
    const foreignCommission = await makeCommission({ tenantId: 'tenant-b', quantity: 1 });
    const foreign = await makeDeliverableFor(foreignCommission, 1);
    await expect(assembleHumanDataset({ commission, deliverables: [foreign], now: NOW })).rejects.toMatchObject(
      { code: HUMAN_DATA_ERROR_CODES.CROSS_TENANT },
    );
  });

  it('ADVERSARIAL: a deliverable of a DIFFERENT commission is rejected', async () => {
    const commission = await makeCommission({ quantity: 1 });
    const otherCommission = await makeCommission({ quantity: 1, datasetName: 'other-corrections' });
    const other = await makeDeliverableFor(otherCommission, 1);
    await expect(assembleHumanDataset({ commission, deliverables: [other], now: NOW })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE,
    });
  });

  it('ADVERSARIAL: a tampered deliverable digest is rejected at assembly', async () => {
    const commission = await makeCommission({ quantity: 1 });
    const tampered: DeliverableRecord = {
      ...(await makeDeliverableFor(commission, 1)),
      digest: '0'.repeat(64),
    };
    await expect(assembleHumanDataset({ commission, deliverables: [tampered], now: NOW })).rejects.toMatchObject(
      { code: HUMAN_DATA_ERROR_CODES.TAMPERED },
    );
  });

  it('empty assemblies are rejected (the honest state is not-yet-delivered, not an empty dataset)', async () => {
    const commission = await makeCommission({ quantity: 1 });
    await expect(assembleHumanDataset({ commission, deliverables: [], now: NOW })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE,
    });
  });

  it('SUPERSESSION: a corrected composition is a NEW manifest derived-from its parent', async () => {
    const commission = await makeCommission({ quantity: 2 });
    const deliverables = [
      await makeDeliverableFor(commission, 1),
      await makeDeliverableFor(commission, 2),
    ];
    const first = await assembleHumanDataset({ commission, deliverables, now: NOW });
    const second = await assembleHumanDataset({
      commission,
      deliverables,
      now: NOW,
      version: '1.1.0',
      supersedes: {
        namespace: first.manifest.identity.namespace,
        name: first.manifest.identity.name,
        version: first.manifest.identity.version,
        digest: first.manifest.digest,
      },
    });
    expect(second.manifest.identity.version).toBe('1.1.0');
    expect(second.manifest.digest).not.toBe(first.manifest.digest);
    expect(second.manifest.provenance.parents).toHaveLength(1);
    expect(second.manifest.provenance.parents[0].relation).toBe('derived-from');
    expect(second.manifest.provenance.parents[0].parent.digest).toBe(first.manifest.digest);
    await expect(verifyDatasetManifest(second.manifest)).resolves.toBe(second.manifest.digest);
  });
});

describe('describeHumanDatasetDelivery (rights/lineage view + download permission)', () => {
  it('exposes the manifest digest, rights, lineage and the download permission', async () => {
    const commission = await makeCommission({ quantity: 1 });
    const deliverables = [await makeDeliverableFor(commission, 1)];
    const assembly = await assembleHumanDataset({ commission, deliverables, now: NOW });
    const descriptor = describeHumanDatasetDelivery(assembly.manifest, assembly.deliverableCount);
    expect(descriptor.manifestDigest).toBe(assembly.manifest.digest);
    expect(descriptor.identity.name).toBe('triage-corrections');
    expect(descriptor.deliverableCount).toBe(1);
    expect(descriptor.verificationCount).toBe(1);
    expect(descriptor.downloadPermitted).toBe(true); // redistribution: tenant-only
    expect(descriptor.lineage).toEqual([]);
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it('download is NOT permitted when redistribution is prohibited', async () => {
    const commission = await makeCommission({
      quantity: 1,
      rights: {
        license: 'Proprietary',
        commercialUse: 'requires-license',
        redistribution: 'prohibited',
        customerData: 'contains',
      },
    });
    const deliverables = [await makeDeliverableFor(commission, 1)];
    const assembly = await assembleHumanDataset({ commission, deliverables, now: NOW });
    const descriptor = describeHumanDatasetDelivery(assembly.manifest, assembly.deliverableCount);
    expect(descriptor.downloadPermitted).toBe(false);
  });
});
