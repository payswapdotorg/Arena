/**
 * ForgeRecord unit tests (Work Order A021): construction, structural
 * checks, content-addressing, tamper detection, idempotency-key and
 * correlation-id requirements.
 */

import { describe, expect, it } from 'vitest';
import {
  BODY_FORGE_ERROR_CODES,
  FORGE_RECORD_FIELDS,
  FORGE_RECORD_VERSION,
  createForgeRecord,
  isForgeRecord,
  isForgeRecordProvenance,
  isForgeRecordView,
  verifyForgeRecord,
} from './index.js';
import { CORR_ID, DIGEST_A, DIGEST_B, DIGEST_C, T1 } from './test-support.js';

const RECORD_INPUT = {
  forgeKey: 'forge-key-0001',
  correlationId: CORR_ID,
  manifestDigest: DIGEST_A,
  policyDigest: DIGEST_B,
  bodyVersionDigest: DIGEST_C,
  bodyVersionRef: {
    tenant: 'tenant-a',
    name: 'ledger-reconciler',
    version: '1.0.0',
    digest: DIGEST_C,
  },
  provenance: {
    forgedBy: 'arena-body-forge-fabric',
    recordedAt: T1,
    notes: null,
  },
} as const;

describe('ForgeRecord construction (positive)', () => {
  it('creates a frozen, content-addressed record', async () => {
    const record = await createForgeRecord(RECORD_INPUT);
    expect(isForgeRecord(record)).toBe(true);
    expect(isForgeRecordView({ ...record })).toBe(true);
    expect(isForgeRecordProvenance(record.provenance)).toBe(true);
    expect(record.recordVersion).toBe(FORGE_RECORD_VERSION);
    expect(record.forgeKey).toBe('forge-key-0001');
    expect(record.correlationId).toBe(CORR_ID);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.provenance)).toBe(true);
    expect(Object.isFrozen(record.bodyVersionRef)).toBe(true);
  });

  it('content-addresses: identical inputs ⇒ identical digests; different content ⇒ different digests', async () => {
    const a = await createForgeRecord(RECORD_INPUT);
    const b = await createForgeRecord(RECORD_INPUT);
    expect(a.digest).toBe(b.digest);
    const c = await createForgeRecord({ ...RECORD_INPUT, forgeKey: 'forge-key-0002' });
    expect(c.digest).not.toBe(a.digest);
    const d = await createForgeRecord({
      ...RECORD_INPUT,
      provenance: { ...RECORD_INPUT.provenance, notes: 'a rerun with notes' },
    });
    expect(d.digest).not.toBe(a.digest);
  });

  it('mirrors the stable field list', () => {
    expect(FORGE_RECORD_FIELDS).toEqual([
      'recordVersion',
      'forgeKey',
      'correlationId',
      'manifestDigest',
      'policyDigest',
      'bodyVersionDigest',
      'bodyVersionRef',
      'provenance',
    ]);
  });
});

describe('ForgeRecord validation (negative)', () => {
  it('requires a valid idempotency key and correlation id', async () => {
    await expect(createForgeRecord({ ...RECORD_INPUT, forgeKey: '' })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_RECORD,
    });
    await expect(createForgeRecord({ ...RECORD_INPUT, correlationId: 'no pe' })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_RECORD,
    });
  });

  it('requires well-formed digests', async () => {
    await expect(createForgeRecord({ ...RECORD_INPUT, manifestDigest: 'zzz' })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_DIGEST,
    });
    await expect(createForgeRecord({ ...RECORD_INPUT, policyDigest: 42 as never })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_DIGEST,
    });
    await expect(createForgeRecord({ ...RECORD_INPUT, bodyVersionDigest: 'short' })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_DIGEST,
    });
  });

  it('requires well-formed provenance', async () => {
    await expect(
      createForgeRecord({ ...RECORD_INPUT, provenance: { ...RECORD_INPUT.provenance, forgedBy: 'bad id!' } }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECORD });
    await expect(
      createForgeRecord({ ...RECORD_INPUT, provenance: { ...RECORD_INPUT.provenance, recordedAt: 'soon' } }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_TIMESTAMP });
    await expect(
      createForgeRecord({ ...RECORD_INPUT, provenance: { ...RECORD_INPUT.provenance, notes: 5 as never } }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECORD });
    await expect(
      createForgeRecord({ ...RECORD_INPUT, provenance: undefined as never }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECORD });
  });

  it('structural checks reject malformed records', () => {
    expect(isForgeRecord({ nope: true })).toBe(false);
    expect(isForgeRecordView({ ...RECORD_INPUT })).toBe(false); // missing digest is fine for the VIEW? no: view requires recordVersion etc.
    expect(isForgeRecordProvenance({ forgedBy: 'x', recordedAt: 'nope', notes: null })).toBe(false);
  });
});

describe('tamper detection', () => {
  it('verifyForgeRecord fails closed with BODY_FORGE_TAMPERED on a mutated copy', async () => {
    const record = await createForgeRecord(RECORD_INPUT);
    expect(await verifyForgeRecord(record)).toBe(record.digest);
    const tampered = { ...record, forgeKey: 'forge-key-9999' } as typeof record;
    await expect(verifyForgeRecord(tampered)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.TAMPERED,
    });
  });
});
