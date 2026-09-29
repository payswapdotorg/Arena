/**
 * @arena/compatibility — compatibility record registry tests
 * (Work Order A022; requirements R2, R20; spec AB1.0).
 */

import { describe, it, expect } from 'vitest';
import { CompatibilityRegistry, createCompatibilityRegistry } from './registry';
import { createCompatibilityResult } from './shared';

describe('Compatibility Registry', () => {
  let registry: CompatibilityRegistry;

  beforeEach(() => {
    registry = createCompatibilityRegistry();
  });

  it('should create and register compatibility records', () => {
    const record = registry.register({
      recordVersion: 1,
      recordDigest: 'b2a0f454c9e0d6929c166ae4512355954d21448c30a9474d69ab34cbb70458a3',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: ['all good'],
      details: {},
    });

    expect(record.recordVersion).toBe(1);
    expect(record.bodyVersionRef).toBe('body-1');
    expect(record.substrateRef).toBe('substrate-1');
    expect(record.verdict).toBe('compatible');
    expect(record.reasons).toEqual(['all good']);
    expect(record.details).toEqual({});
  });

  it('should register records with tenant and workspace', () => {
    const record = registry.register({
      recordVersion: 1,
      recordDigest: '1111c40225bbce563f847e03dc2375bf0c3ae83bc4887620f9ef477c17552883',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: ['all good'],
      details: {},
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
    });

    expect((record as any).tenantId).toBe('tenant-1');
    expect((record as any).workspaceId).toBe('workspace-1');
  });

  it('should get records by digest', () => {
    const original = registry.register({
      recordVersion: 1,
      recordDigest: '74e44768239d20e283c7508ff6ac49f0c615a399940a40e4e607d2d93bda6c53',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: ['all good'],
      details: {},
    });

    const retrieved = registry.getRecord(original.recordDigest);
    expect(retrieved).toEqual(original);
  });

  it('should list records by body version', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-2',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'incompatible-with-reasons',
      reasons: ['bad'],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "3c4d5e6f789012345678901234567890abcdef1234567890abcdef1234567a" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-03T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });

    const body1Records = registry.listRecordsByBody('body-1');
    expect(body1Records).toHaveLength(2);
    expect(body1Records.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-1']);
  });

  it('should list records by substrate', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "3c4d5e6f789012345678901234567890abcdef1234567890abcdef1234567a" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-2',
      evaluatedAt: '2024-01-03T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });

    const substrate1Records = registry.listRecordsBySubstrate('substrate-1');
    expect(substrate1Records).toHaveLength(2);
    expect(substrate1Records.map(r => r.substrateRef)).toEqual(['substrate-1', 'substrate-1']);
  });

  it('should list records by tenant', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
      tenantId: 'tenant-1',
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
      tenantId: 'tenant-1',
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "3c4d5e6f789012345678901234567890abcdef1234567890abcdef1234567a" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-2',
      evaluatedAt: '2024-01-03T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
      tenantId: 'tenant-2',
    });

    const tenant1Records = registry.listRecordsByTenant('tenant-1');
    expect(tenant1Records).toHaveLength(2);
    expect(tenant1Records.map(r => (r as any).tenantId)).toEqual(['tenant-1', 'tenant-1']);
  });

  it('should list records by workspace', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
      workspaceId: 'workspace-1',
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
      workspaceId: 'workspace-1',
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "3c4d5e6f789012345678901234567890abcdef1234567890abcdef1234567a" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-2',
      evaluatedAt: '2024-01-03T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
      workspaceId: 'workspace-2',
    });

    const workspace1Records = registry.listRecordsByWorkspace('workspace-1');
    expect(workspace1Records).toHaveLength(2);
    expect(workspace1Records.map(r => (r as any).workspaceId)).toEqual(['workspace-1', 'workspace-1']);
  });

  it('should list all records', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });

    const allRecords = registry.listRecords();
    expect(allRecords).toHaveLength(2);
    expect(allRecords.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-2']);
  });

  it('should filter records by verdict', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'incompatible-with-reasons',
      reasons: ['bad'],
      details: {},
    });

    const compatibleRecords = registry.listRecordsByVerdict('compatible');
    expect(compatibleRecords).toHaveLength(1);
    expect(compatibleRecords[0].verdict).toBe('compatible');

    const incompatibleRecords = registry.listRecordsByVerdict('incompatible-with-reasons');
    expect(incompatibleRecords).toHaveLength(1);
    expect(incompatibleRecords[0].verdict).toBe('incompatible-with-reasons');
  });

  it('should filter records by time range', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "3c4d5e6f789012345678901234567890abcdef1234567890abcdef1234567a" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-3',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-03T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });

    const rangeRecords = registry.listRecordsByTimeRange({
      from: '2024-01-01T12:00:00.000Z',
      to: '2024-01-02T12:00:00.000Z'
    });
    expect(rangeRecords).toHaveLength(1);
    expect(rangeRecords[0].bodyVersionRef).toBe('body-2');
  });

  it('should get latest record for body/substrate pair', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'incompatible-with-reasons',
      reasons: ['changed'],
      details: {},
    });

    const latest = registry.getLatestRecord('body-1', 'substrate-1');
    expect(latest?.verdict).toBe('incompatible-with-reasons');
    expect(latest?.reasons).toEqual(['changed']);
  });

  it('should get body compatibility history', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-2',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "3c4d5e6f789012345678901234567890abcdef1234567890abcdef1234567a" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-03T00:00:00.000Z',
      verdict: 'incompatible-with-reasons',
      reasons: ['changed'],
      details: {},
    });

    const history = registry.getBodyCompatibilityHistory('body-1');
    expect(history).toHaveLength(3);
    expect(history.map(r => r.substrateRef)).toEqual(['substrate-1', 'substrate-2', 'substrate-1']);
  });

  it('should get substrate compatibility history', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });

    const history = registry.getSubstrateCompatibilityHistory('substrate-1');
    expect(history).toHaveLength(2);
    expect(history.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-2']);
  });

  it('should check if record exists', () => {
    const record = registry.register({
      recordVersion: 1,
      recordDigest: 'b2a0f454c9e0d6929c166ae4512355954d21448c30a9474d69ab34cbb70458a3',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    
    expect(registry.hasRecord(record.recordDigest)).toBe(true);
    expect(registry.hasRecord('nonexistent')).toBe(false);
  });

  it('should get record count', () => {
    expect(registry.getRecordCount()).toBe(0);
    
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    expect(registry.getRecordCount()).toBe(1);
    
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    expect(registry.getRecordCount()).toBe(2);
  });

  it('should clear all records', () => {
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "1a2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345678" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    registry.register({
      recordVersion: 1,
      recordDigest: 'echo "2b3c4d5e6f789012345678901234567890abcdef1234567890abcdef12345679" | xargs -I {} node -e "console.log(crypto.createHash('sha256').update('{}').digest('hex'))" | tail -1',
      bodyVersionRef: 'body-2',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-02T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    
    expect(registry.getRecordCount()).toBe(2);
    registry.clear();
    expect(registry.getRecordCount()).toBe(0);
  });

  it('should prevent duplicate records by digest', () => {
    const record1 = registry.register({
      recordVersion: 1,
      recordDigest: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    const record2 = registry.register({
      recordVersion: 1,
      recordDigest: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: '2024-01-01T00:00:00.000Z',
      verdict: 'compatible',
      reasons: [],
      details: {},
    });
    
    expect(record1.recordDigest).toBe(record2.recordDigest);
    expect(registry.getRecordCount()).toBe(1);
  });
});
