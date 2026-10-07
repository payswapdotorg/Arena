/**
 * COI registry tests (Work Order C020): declared + derived records, the
 * typed COI-check closure (clear / conflicted-with-reasons /
 * unknown-insufficient-data), retraction-as-transition and tenant
 * isolation.
 */

import { describe, expect, it } from 'vitest';
import {
  NETWORK_QUALITY_ERROR_CODES,
  createCoiRecord,
  retractCoiRecord,
  checkConflictOfInterest,
  verifyCoiRecordDigest,
} from './index.js';

const AT = '2026-10-01T00:00:00.000Z';
const LATER = '2026-10-05T00:00:00.000Z';

async function declared(overrides: Record<string, unknown> = {}) {
  return createCoiRecord({
    coiId: 'nq-coi-001',
    tenant: 'tenant-1',
    party: 'expert-1',
    counterparty: 'expert-2',
    kind: 'prior-engagement',
    origin: 'declared',
    scope: 'software',
    observedAt: AT,
    recordedAt: AT,
    ...overrides,
  });
}

describe('createCoiRecord', () => {
  it('creates a declared COI record (frozen, content-addressed)', async () => {
    const record = await declared();
    expect(record.origin).toBe('declared');
    expect(record.kind).toBe('prior-engagement');
    expect(record.status).toBe('ACTIVE');
    expect(Object.isFrozen(record)).toBe(true);
    await expect(verifyCoiRecordDigest(record)).resolves.toBe(true);
  });

  it('creates a derived COI record citing owning-surface evidence', async () => {
    const record = await createCoiRecord({
      coiId: 'nq-coi-002',
      tenant: 'tenant-1',
      party: 'expert-3',
      counterparty: 'tenant-2-principal',
      kind: 'tenant-overlap',
      origin: 'derived',
      observedAt: AT,
      recordedAt: AT,
      derivedFrom: { surface: 'adversarial-evaluation', refDigest: 'c'.repeat(64) },
    });
    expect(record.origin).toBe('derived');
    expect(record.derivedFrom?.surface).toBe('adversarial-evaluation');
  });

  it('a derived record without derivedFrom evidence fails closed', async () => {
    await expect(
      createCoiRecord({
        coiId: 'nq-coi-003',
        tenant: 'tenant-1',
        party: 'expert-3',
        counterparty: 'expert-4',
        kind: 'marketplace-interest',
        origin: 'derived',
        observedAt: AT,
        recordedAt: AT,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_COI });
  });

  it('an unknown COI kind fails closed', async () => {
    await expect(declared({ kind: 'friendship' })).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_COI,
    });
  });

  it('a self-conflict fails closed', async () => {
    await expect(declared({ counterparty: 'expert-1' })).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_COI,
    });
  });
});

describe('retractCoiRecord (revocation is a status transition)', () => {
  it('retracts ACTIVE -> RETRACTED and keeps the record auditable', async () => {
    const record = await declared();
    const retracted = await retractCoiRecord(record, LATER, 'counterparty clarified');
    expect(retracted.status).toBe('RETRACTED');
    expect(retracted.coiId).toBe(record.coiId);
    expect(retracted.notes).toContain('RETRACTED');
    await expect(verifyCoiRecordDigest(retracted)).resolves.toBe(true);
    await expect(retractCoiRecord(retracted, LATER, 'twice')).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION,
    });
  });
});

describe('checkConflictOfInterest (the typed read port)', () => {
  it('returns conflicted-with-reasons citing every ACTIVE match', async () => {
    const registry = [
      await declared(),
      await createCoiRecord({
        coiId: 'nq-coi-010',
        tenant: 'tenant-1',
        party: 'expert-2',
        counterparty: 'expert-1',
        kind: 'tenant-overlap',
        origin: 'derived',
        observedAt: AT,
        recordedAt: AT,
        derivedFrom: { surface: 'expert-registry', refDigest: 'd'.repeat(64) },
      }),
    ];
    const result = checkConflictOfInterest(registry, {
      tenant: 'tenant-1',
      party: 'expert-1',
      counterparty: 'expert-2',
      at: LATER,
    });
    expect(result.verdict).toBe('conflicted-with-reasons');
    expect(result.reasons).toHaveLength(2);
    expect(result.examined).toBe(2);
    expect(result.reasons[0]?.kind).toBe('prior-engagement');
    expect(result.reasons[1]?.kind).toBe('tenant-overlap');
  });

  it('returns clear when the registry covers the tenant and no record implicates the pair', async () => {
    const registry = [await declared()];
    const result = checkConflictOfInterest(registry, {
      tenant: 'tenant-1',
      party: 'expert-5',
      counterparty: 'expert-6',
      at: LATER,
    });
    expect(result.verdict).toBe('clear');
    expect(result.reasons).toHaveLength(0);
    expect(result.examined).toBe(1);
  });

  it('returns unknown-insufficient-data on an empty registry (never a silent pass)', async () => {
    const result = checkConflictOfInterest([], {
      tenant: 'tenant-1',
      party: 'expert-5',
      counterparty: 'expert-6',
      at: LATER,
    });
    expect(result.verdict).toBe('unknown-insufficient-data');
  });

  it('RETRACTED records do not implicate but remain examinable', async () => {
    const retracted = await retractCoiRecord(await declared(), LATER, 'clarified');
    const result = checkConflictOfInterest([retracted], {
      tenant: 'tenant-1',
      party: 'expert-1',
      counterparty: 'expert-2',
      at: LATER,
    });
    expect(result.verdict).toBe('clear');
    expect(result.examined).toBe(1);
  });

  it('tenant isolation: another tenant\'s records never leak into the check', async () => {
    const foreign = await declared({ tenant: 'tenant-2' });
    const result = checkConflictOfInterest([foreign], {
      tenant: 'tenant-1',
      party: 'expert-1',
      counterparty: 'expert-2',
      at: LATER,
    });
    expect(result.verdict).toBe('unknown-insufficient-data');
    expect(result.examined).toBe(0);
  });

  it('a self-check fails closed', async () => {
    expect(() =>
      checkConflictOfInterest([], {
        tenant: 'tenant-1',
        party: 'expert-1',
        counterparty: 'expert-1',
        at: LATER,
      }),
    ).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_COI }),
    );
  });
});
