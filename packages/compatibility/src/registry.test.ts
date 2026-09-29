/**
 * @arena/compatibility — compatibility record registry tests
 * (Work Order A022; requirements R2, R20; spec AB1.0).
 *
 * Every recordDigest is a valid sha256 content digest (64 lowercase hex
 * chars) — the registry validates digests against the agent-body
 * content-digest pattern and fails closed on anything else.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CompatibilityRegistry, createCompatibilityRegistry } from './registry.js';
import type { CompatibilityRecord } from './shared.js';

// Pre-computed sha256 digests (distinct per record).
const D1 = 'c3f834f3f77f6b7ac4b9639153c88dad83d6ed23ee018f45f9972e12f480c4d3';
const D2 = '2b38a89d30121000093e4060c359000de29024f95c585097d198632f102724bd';
const D3 = 'd50b340bb9bfa7b3d800aaee0702daacf231b2db9b2ad0ee43fe6b70fbc8704c';
const D4 = '42c16ab4e09cc32db9e14536d2a737e175b407aae946095c60df0235efa26737';
const D5 = 'b74443ad28c9b92c1af4e2b2beffbac6105eca2e0009963cf60a87b6116290e9';
const D6 = '4ab72e39ee4bb306f3734ccc67cb4673e4f702030aeba21601c4e0e2bb58c016';
const D7 = '0a32d5f2bc329726179220f45943ba2d36c1fb47c5336ed642b920f4647a1007';
const D8 = 'da3157cb9b374e32c5f9be78326404a9b86974a33edd0ef17db78e8ebe8ff616';
const D9 = '764f45ace85de29faa9708e45ba6d3823ab96c709c3454f6e5a15ff8373cd643';
const D10 = 'e466a2971cfd06a36872041924312867a794228e142cdbebf5078090cfa6e7c9';
const D11 = '1880929718e26f099dff2fedb94cc62e9a742cf320ff94a3ee85e5230c0bcc11';
const D12 = '4865bb5a903b2c50ee6f18a437a63f79d862a2da4fdd95c19b25d17d11397897';

function makeRecord(
  overrides: Partial<CompatibilityRecord> & { recordDigest: string },
): CompatibilityRecord {
  return {
    recordVersion: 1,
    bodyVersionRef: 'body-1',
    substrateRef: 'substrate-1',
    evaluatedAt: '2024-01-01T00:00:00.000Z',
    verdict: 'compatible',
    reasons: [],
    details: {},
    ...overrides,
  };
}

describe('Compatibility Registry', () => {
  let registry: CompatibilityRegistry;

  beforeEach(() => {
    registry = createCompatibilityRegistry();
  });

  it('should create and register compatibility records', () => {
    const record = registry.register(makeRecord({ recordDigest: D1 }));

    expect(record.recordVersion).toBe(1);
    expect(record.bodyVersionRef).toBe('body-1');
    expect(record.substrateRef).toBe('substrate-1');
    expect(record.verdict).toBe('compatible');
    expect(record.reasons).toEqual([]);
    expect(record.details).toEqual({});
  });

  it('should register records with tenant and workspace', () => {
    const record = registry.register(
      makeRecord({ recordDigest: D2, tenantId: 'tenant-1', workspaceId: 'workspace-1' }),
    );

    expect(record.tenantId).toBe('tenant-1');
    expect(record.workspaceId).toBe('workspace-1');
  });

  it('should get records by digest', () => {
    const original = registry.register(makeRecord({ recordDigest: D3 }));

    const retrieved = registry.getRecord(original.recordDigest);
    expect(retrieved).toEqual(original);
  });

  it('should list records by body version', () => {
    registry.register(makeRecord({ recordDigest: D1, bodyVersionRef: 'body-1', substrateRef: 'substrate-1' }));
    registry.register(makeRecord({ recordDigest: D2, bodyVersionRef: 'body-1', substrateRef: 'substrate-2', verdict: 'incompatible-with-reasons', reasons: ['bad'] }));
    registry.register(makeRecord({ recordDigest: D3, bodyVersionRef: 'body-2', substrateRef: 'substrate-1' }));

    const body1Records = registry.listRecordsByBody('body-1');
    expect(body1Records).toHaveLength(2);
    expect(body1Records.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-1']);
  });

  it('should list records by substrate', () => {
    registry.register(makeRecord({ recordDigest: D1, bodyVersionRef: 'body-1', substrateRef: 'substrate-1' }));
    registry.register(makeRecord({ recordDigest: D2, bodyVersionRef: 'body-2', substrateRef: 'substrate-1' }));
    registry.register(makeRecord({ recordDigest: D3, bodyVersionRef: 'body-1', substrateRef: 'substrate-2' }));

    const substrate1Records = registry.listRecordsBySubstrate('substrate-1');
    expect(substrate1Records).toHaveLength(2);
    expect(substrate1Records.map(r => r.substrateRef)).toEqual(['substrate-1', 'substrate-1']);
  });

  it('should list records by tenant', () => {
    registry.register(makeRecord({ recordDigest: D1, tenantId: 'tenant-1' }));
    registry.register(makeRecord({ recordDigest: D2, bodyVersionRef: 'body-2', tenantId: 'tenant-1' }));
    registry.register(makeRecord({ recordDigest: D3, substrateRef: 'substrate-2', tenantId: 'tenant-2' }));

    const tenant1Records = registry.listRecordsByTenant('tenant-1');
    expect(tenant1Records).toHaveLength(2);
    expect(tenant1Records.map(r => r.tenantId)).toEqual(['tenant-1', 'tenant-1']);
  });

  it('should list records by workspace', () => {
    registry.register(makeRecord({ recordDigest: D1, workspaceId: 'workspace-1' }));
    registry.register(makeRecord({ recordDigest: D2, bodyVersionRef: 'body-2', workspaceId: 'workspace-1' }));
    registry.register(makeRecord({ recordDigest: D3, substrateRef: 'substrate-2', workspaceId: 'workspace-2' }));

    const workspace1Records = registry.listRecordsByWorkspace('workspace-1');
    expect(workspace1Records).toHaveLength(2);
    expect(workspace1Records.map(r => r.workspaceId)).toEqual(['workspace-1', 'workspace-1']);
  });

  it('should list all records', () => {
    registry.register(makeRecord({ recordDigest: D1, bodyVersionRef: 'body-1' }));
    registry.register(makeRecord({ recordDigest: D2, bodyVersionRef: 'body-2' }));

    const allRecords = registry.listRecords();
    expect(allRecords).toHaveLength(2);
    expect(allRecords.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-2']);
  });

  it('should filter records by verdict', () => {
    registry.register(makeRecord({ recordDigest: D1, verdict: 'compatible' }));
    registry.register(makeRecord({ recordDigest: D2, bodyVersionRef: 'body-2', verdict: 'incompatible-with-reasons', reasons: ['bad'] }));

    const compatibleRecords = registry.listRecordsByVerdict('compatible');
    expect(compatibleRecords).toHaveLength(1);
    expect(compatibleRecords[0]?.verdict).toBe('compatible');

    const incompatibleRecords = registry.listRecordsByVerdict('incompatible-with-reasons');
    expect(incompatibleRecords).toHaveLength(1);
    expect(incompatibleRecords[0]?.verdict).toBe('incompatible-with-reasons');
  });

  it('should filter records by time range', () => {
    registry.register(makeRecord({ recordDigest: D1, evaluatedAt: '2024-01-01T00:00:00.000Z' }));
    registry.register(makeRecord({ recordDigest: D2, bodyVersionRef: 'body-2', evaluatedAt: '2024-01-02T00:00:00.000Z' }));
    registry.register(makeRecord({ recordDigest: D3, bodyVersionRef: 'body-3', evaluatedAt: '2024-01-03T00:00:00.000Z' }));

    const rangeRecords = registry.listRecordsByTimeRange({
      from: '2024-01-01T12:00:00.000Z',
      to: '2024-01-02T12:00:00.000Z',
    });
    expect(rangeRecords).toHaveLength(1);
    expect(rangeRecords[0]?.bodyVersionRef).toBe('body-2');
  });

  it('should get latest record for body/substrate pair', () => {
    registry.register(makeRecord({ recordDigest: D1, evaluatedAt: '2024-01-01T00:00:00.000Z' }));
    registry.register(makeRecord({ recordDigest: D2, evaluatedAt: '2024-01-02T00:00:00.000Z', verdict: 'incompatible-with-reasons', reasons: ['changed'] }));

    const latest = registry.getLatestRecord('body-1', 'substrate-1');
    expect(latest?.verdict).toBe('incompatible-with-reasons');
    expect(latest?.reasons).toEqual(['changed']);
  });

  it('should get body compatibility history', () => {
    registry.register(makeRecord({ recordDigest: D1, substrateRef: 'substrate-1', evaluatedAt: '2024-01-01T00:00:00.000Z' }));
    registry.register(makeRecord({ recordDigest: D2, substrateRef: 'substrate-2', evaluatedAt: '2024-01-02T00:00:00.000Z' }));
    registry.register(makeRecord({ recordDigest: D3, substrateRef: 'substrate-1', evaluatedAt: '2024-01-03T00:00:00.000Z', verdict: 'incompatible-with-reasons', reasons: ['changed'] }));

    const history = registry.getBodyCompatibilityHistory('body-1');
    expect(history).toHaveLength(3);
    expect(history.map(r => r.substrateRef)).toEqual(['substrate-1', 'substrate-2', 'substrate-1']);
  });

  it('should get substrate compatibility history', () => {
    registry.register(makeRecord({ recordDigest: D1, bodyVersionRef: 'body-1', substrateRef: 'substrate-1', evaluatedAt: '2024-01-01T00:00:00.000Z' }));
    registry.register(makeRecord({ recordDigest: D2, bodyVersionRef: 'body-2', substrateRef: 'substrate-1', evaluatedAt: '2024-01-02T00:00:00.000Z' }));

    const history = registry.getSubstrateCompatibilityHistory('substrate-1');
    expect(history).toHaveLength(2);
    expect(history.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-2']);
  });

  it('should check if record exists', () => {
    const record = registry.register(makeRecord({ recordDigest: D4 }));

    expect(registry.hasRecord(record.recordDigest)).toBe(true);
    expect(registry.hasRecord('nonexistent')).toBe(false);
  });

  it('should get record count', () => {
    expect(registry.getRecordCount()).toBe(0);

    registry.register(makeRecord({ recordDigest: D5 }));
    expect(registry.getRecordCount()).toBe(1);

    registry.register(makeRecord({ recordDigest: D6, bodyVersionRef: 'body-2' }));
    expect(registry.getRecordCount()).toBe(2);
  });

  it('should clear all records', () => {
    registry.register(makeRecord({ recordDigest: D7 }));
    registry.register(makeRecord({ recordDigest: D8, bodyVersionRef: 'body-2' }));

    expect(registry.getRecordCount()).toBe(2);
    registry.clear();
    expect(registry.getRecordCount()).toBe(0);
  });

  it('should prevent duplicate records by digest', () => {
    const record1 = registry.register(makeRecord({ recordDigest: D9 }));
    const record2 = registry.register(makeRecord({ recordDigest: D9 }));

    expect(record1.recordDigest).toBe(record2.recordDigest);
    expect(registry.getRecordCount()).toBe(1);
  });

  it('should reject records with invalid digests (fail closed)', () => {
    expect(() =>
      registry.register(makeRecord({ recordDigest: 'not-a-digest' as unknown as string })),
    ).toThrow('COMPATIBILITY_INVALID_RECORD');
  });

  it('should reject records with unknown verdicts (fail closed)', () => {
    expect(() =>
      registry.register(makeRecord({ recordDigest: D10, verdict: 'maybe' as unknown as CompatibilityRecord['verdict'] })),
    ).toThrow('COMPATIBILITY_INVALID_RECORD');
  });
});
