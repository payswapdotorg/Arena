/**
 * @arena/compatibility — compatibility record registry tests (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 */

import { CompatibilityRegistry } from '../src/registry.js';
import { CompatibilityError } from '../src/errors.js';
import {
  type CompatibilityRecord,
  createCompatibilityResult,
} from '../src/shared.js';

// Mock test data - using valid content digests (64-char lowercase hex)
const D1 = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234';
const D2 = 'efgh5678efgh5678efgh5678efgh5678efgh5678efgh5678efgh5678efgh5678efgh5678';
const D3 = 'ijkl9012ijkl9012ijkl9012ijkl9012ijkl9012ijkl9012ijkl9012ijkl9012ijkl9012ijkl9012';
const D10 = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234';

function makeRecord(overrides: Partial<CompatibilityRecord> = {}): CompatibilityRecord {
  const base: CompatibilityRecord = {
    recordVersion: 1,
    recordDigest: D1,
    bodyVersionRef: 'body-1',
    substrateRef: 'substrate-1',
    evaluatedAt: new Date().toISOString(),
    verdict: 'compatible',
    reasons: [],
    details: {},
    tenantId: 'test-tenant',
    workspaceId: 'test-workspace',
  };
  return { ...base, ...overrides };
}

describe('Compatibility Registry', () => {
  let registry: CompatibilityRegistry;

  beforeEach(() => {
    registry = new CompatibilityRegistry();
  });

  it('should create and register compatibility records', () => {
    const record = makeRecord();
    const registered = registry.register(record);
    
    expect(registered).toBe(record);
    expect(registry.getRecordCount()).toBe(1);
    expect(registry.getRecord(D1)).toBe(record);
  });

  it('should register records with tenant and workspace', () => {
    const record = makeRecord({ tenantId: 'tenant-1', workspaceId: 'workspace-1' });
    const registered = registry.register(record);
    
    expect((registered as any).tenantId).toBe('tenant-1');
    expect((registered as any).workspaceId).toBe('workspace-1');
  });

  it('should get records by digest', () => {
    const record = makeRecord();
    registry.register(record);
    
    const retrieved = registry.getRecord(D1);
    expect(retrieved).toBe(record);
  });

  it('should list records by body version', () => {
    const record1 = makeRecord({ bodyVersionRef: 'body-1', recordDigest: D1 });
    const record2 = makeRecord({ bodyVersionRef: 'body-2', recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const body1Records = registry.listRecordsByBody('body-1');
    expect(body1Records).toHaveLength(1);
    expect(body1Records[0]).toBe(record1);
  });

  it('should list records by substrate', () => {
    const record1 = makeRecord({ substrateRef: 'substrate-1', recordDigest: D1 });
    const record2 = makeRecord({ substrateRef: 'substrate-2', recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const substrate1Records = registry.listRecordsBySubstrate('substrate-1');
    expect(substrate1Records).toHaveLength(1);
    expect(substrate1Records[0]).toBe(record1);
  });

  it('should list records by tenant', () => {
    const record1 = makeRecord({ tenantId: 'tenant-1', recordDigest: D1 });
    const record2 = makeRecord({ tenantId: 'tenant-2', recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const tenant1Records = registry.listRecordsByTenant('tenant-1');
    expect(tenant1Records).toHaveLength(1);
    expect(tenant1Records[0]).toBe(record1);
  });

  it('should list records by workspace', () => {
    const record1 = makeRecord({ workspaceId: 'workspace-1', recordDigest: D1 });
    const record2 = makeRecord({ workspaceId: 'workspace-2', recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const workspace1Records = registry.listRecordsByWorkspace('workspace-1');
    expect(workspace1Records).toHaveLength(1);
    expect(workspace1Records[0]).toBe(record1);
  });

  it('should list all records', () => {
    const record1 = makeRecord({ recordDigest: D1 });
    const record2 = makeRecord({ recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const allRecords = registry.listRecords();
    expect(allRecords).toHaveLength(2);
    expect(allRecords).toContain(record1);
    expect(allRecords).toContain(record2);
  });

  it('should filter records by verdict', () => {
    const record1 = makeRecord({ verdict: 'compatible', recordDigest: D1 });
    const record2 = makeRecord({ verdict: 'incompatible-with-reasons', recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const compatibleRecords = registry.listRecordsByVerdict('compatible');
    expect(compatibleRecords).toHaveLength(1);
    expect(compatibleRecords[0]).toBe(record1);
  });

  it('should filter records by time range', () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1000).toISOString();
    const future = new Date(now.getTime() + 1000).toISOString();
    
    const record1 = makeRecord({ evaluatedAt: past, recordDigest: D1 });
    const record2 = makeRecord({ evaluatedAt: future, recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const recentRecords = registry.listRecordsByTimeRange({ from: now.toISOString(), to: future });
    expect(recentRecords).toHaveLength(1);
    expect(recentRecords[0]).toBe(record2);
  });

  it('should get latest record for body/substrate pair', () => {
    const record1 = makeRecord({ bodyVersionRef: 'body-1', substrateRef: 'substrate-1', recordDigest: D1 });
    const record2 = makeRecord({ bodyVersionRef: 'body-1', substrateRef: 'substrate-1', recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const latest = registry.getLatestRecord('body-1', 'substrate-1');
    expect(latest).toBe(record2); // Second one should be latest due to append-only ledger
  });

  it('should get body compatibility history', () => {
    const record1 = makeRecord({ bodyVersionRef: 'body-1', recordDigest: D1 });
    const record2 = makeRecord({ bodyVersionRef: 'body-1', recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const history = registry.getBodyCompatibilityHistory('body-1');
    expect(history).toHaveLength(2);
    expect(history).toContain(record1);
    expect(history).toContain(record2);
  });

  it('should get substrate compatibility history', () => {
    const record1 = makeRecord({ substrateRef: 'substrate-1', recordDigest: D1 });
    const record2 = makeRecord({ substrateRef: 'substrate-1', recordDigest: D2 });
    
    registry.register(record1);
    registry.register(record2);
    
    const history = registry.getSubstrateCompatibilityHistory('substrate-1');
    expect(history).toHaveLength(2);
    expect(history).toContain(record1);
    expect(history).toContain(record2);
  });

  it('should check if record exists', () => {
    const record = makeRecord();
    
    expect(registry.hasRecord(D1)).toBe(false);
    
    registry.register(record);
    
    expect(registry.hasRecord(D1)).toBe(true);
  });

  it('should get record count', () => {
    expect(registry.getRecordCount()).toBe(0);
    
    registry.register(makeRecord({ recordDigest: D1 }));
    registry.register(makeRecord({ recordDigest: D2 }));
    
    expect(registry.getRecordCount()).toBe(2);
  });

  it('should clear all records', () => {
    registry.register(makeRecord({ recordDigest: D1 }));
    registry.register(makeRecord({ recordDigest: D2 }));
    
    expect(registry.getRecordCount()).toBe(2);
    
    registry.clear();
    
    expect(registry.getRecordCount()).toBe(0);
  });

  it('should prevent duplicate records by digest', () => {
    const record = makeRecord();
    const registered1 = registry.register(record);
    const registered2 = registry.register(record);
    
    expect(registered1).toBe(registered2); // Should return the same record
    expect(registry.getRecordCount()).toBe(1);
  });

  it('should reject records with invalid digests (fail closed)', () => {
    expect(() =>
      registry.register(makeRecord({ recordDigest: 'invalid-digest-format' as unknown })),
    ).toThrow('invalid compatibility record structure');
  });

  it('should reject records with unknown verdicts (fail closed)', () => {
    expect(() =>
      registry.register(makeRecord({ recordDigest: D10, verdict: 'maybe' as unknown })),
    ).toThrow('invalid compatibility record structure');
  });
});