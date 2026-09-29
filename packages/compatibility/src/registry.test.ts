import { describe, it, expect } from 'vitest';
import { CompatibilityRegistry, createCompatibilityRegistry } from './registry';
import { createCompatibilityResult } from './shared';

describe('Compatibility Registry', () => {
  let registry: CompatibilityRegistry;

  beforeEach(() => {
    registry = createCompatibilityRegistry();
  });

  it('should create and register compatibility records', () => {
    const record = registry.createAndRegister(
      'body-1',
      'substrate-1',
      createCompatibilityResult('compatible', ['all good']),
      '2024-01-01T00:00:00.000Z'
    );

    expect(record.recordVersion).toBe(1);
    expect(record.bodyVersionRef).toBe('body-1');
    expect(record.substrateRef).toBe('substrate-1');
    expect(record.verdict).toBe('compatible');
    expect(record.reasons).toEqual(['all good']);
    expect(record.details).toEqual({});
  });

  it('should register records with tenant and workspace', () => {
    const record = registry.createAndRegister(
      'body-1',
      'substrate-1',
      createCompatibilityResult('compatible', ['all good']),
      '2024-01-01T00:00:00.000Z',
      undefined,
      'tenant-1',
      'workspace-1'
    );

    expect((record as any).tenantId).toBe('tenant-1');
    expect((record as any).workspaceId).toBe('workspace-1');
  });

  it('should get records by digest', () => {
    const original = registry.createAndRegister(
      'body-1',
      'substrate-1',
      createCompatibilityResult('compatible', ['all good']),
      '2024-01-01T00:00:00.000Z'
    );

    const retrieved = registry.getRecord(original.recordDigest);
    expect(retrieved).toEqual(original);
  });

  it('should list records by body version', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-1', 'substrate-2', createCompatibilityResult('incompatible-with-reasons', ['bad']), '2024-01-02T00:00:00.000Z');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-03T00:00:00.000Z');

    const body1Records = registry.listRecordsByBody('body-1');
    expect(body1Records).toHaveLength(2);
    expect(body1Records.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-1']);
  });

  it('should list records by substrate', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z');
    registry.createAndRegister('body-1', 'substrate-2', createCompatibilityResult('compatible', []), '2024-01-03T00:00:00.000Z');

    const substrate1Records = registry.listRecordsBySubstrate('substrate-1');
    expect(substrate1Records).toHaveLength(2);
    expect(substrate1Records.map(r => r.substrateRef)).toEqual(['substrate-1', 'substrate-1']);
  });

  it('should list records by tenant', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z', undefined, 'tenant-1');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z', undefined, 'tenant-1');
    registry.createAndRegister('body-1', 'substrate-2', createCompatibilityResult('compatible', []), '2024-01-03T00:00:00.000Z', undefined, 'tenant-2');

    const tenant1Records = registry.listRecordsByTenant('tenant-1');
    expect(tenant1Records).toHaveLength(2);
    expect(tenant1Records.map(r => (r as any).tenantId)).toEqual(['tenant-1', 'tenant-1']);
  });

  it('should list records by workspace', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z', undefined, undefined, 'workspace-1');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z', undefined, undefined, 'workspace-1');
    registry.createAndRegister('body-1', 'substrate-2', createCompatibilityResult('compatible', []), '2024-01-03T00:00:00.000Z', undefined, undefined, 'workspace-2');

    const workspace1Records = registry.listRecordsByWorkspace('workspace-1');
    expect(workspace1Records).toHaveLength(2);
    expect(workspace1Records.map(r => (r as any).workspaceId)).toEqual(['workspace-1', 'workspace-1']);
  });

  it('should list all records', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z');

    const allRecords = registry.listRecords();
    expect(allRecords).toHaveLength(2);
    expect(allRecords.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-2']);
  });

  it('should filter records by verdict', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('incompatible-with-reasons', ['bad']), '2024-01-02T00:00:00.000Z');

    const compatibleRecords = registry.listRecordsByVerdict('compatible');
    expect(compatibleRecords).toHaveLength(1);
    expect(compatibleRecords[0].verdict).toBe('compatible');

    const incompatibleRecords = registry.listRecordsByVerdict('incompatible-with-reasons');
    expect(incompatibleRecords).toHaveLength(1);
    expect(incompatibleRecords[0].verdict).toBe('incompatible-with-reasons');
  });

  it('should filter records by time range', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z');
    registry.createAndRegister('body-3', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-03T00:00:00.000Z');

    const rangeRecords = registry.listRecordsByTimeRange({
      from: '2024-01-01T12:00:00.000Z',
      to: '2024-01-02T12:00:00.000Z'
    });
    expect(rangeRecords).toHaveLength(1);
    expect(rangeRecords[0].bodyVersionRef).toBe('body-2');
  });

  it('should get latest record for body/substrate pair', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('incompatible-with-reasons', ['changed']), '2024-01-02T00:00:00.000Z');

    const latest = registry.getLatestRecord('body-1', 'substrate-1');
    expect(latest?.verdict).toBe('incompatible-with-reasons');
    expect(latest?.reasons).toEqual(['changed']);
  });

  it('should get body compatibility history', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-1', 'substrate-2', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z');
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('incompatible-with-reasons', ['changed']), '2024-01-03T00:00:00.000Z');

    const history = registry.getBodyCompatibilityHistory('body-1');
    expect(history).toHaveLength(3);
    expect(history.map(r => r.substrateRef)).toEqual(['substrate-1', 'substrate-2', 'substrate-1']);
  });

  it('should get substrate compatibility history', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z');

    const history = registry.getSubstrateCompatibilityHistory('substrate-1');
    expect(history).toHaveLength(2);
    expect(history.map(r => r.bodyVersionRef)).toEqual(['body-1', 'body-2']);
  });

  it('should check if record exists', () => {
    const record = registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    
    expect(registry.hasRecord(record.recordDigest)).toBe(true);
    expect(registry.hasRecord('nonexistent')).toBe(false);
  });

  it('should get record count', () => {
    expect(registry.getRecordCount()).toBe(0);
    
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    expect(registry.getRecordCount()).toBe(1);
    
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z');
    expect(registry.getRecordCount()).toBe(2);
  });

  it('should clear all records', () => {
    registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    registry.createAndRegister('body-2', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-02T00:00:00.000Z');
    
    expect(registry.getRecordCount()).toBe(2);
    registry.clear();
    expect(registry.getRecordCount()).toBe(0);
  });

  it('should prevent duplicate records by digest', () => {
    const record1 = registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    const record2 = registry.createAndRegister('body-1', 'substrate-1', createCompatibilityResult('compatible', []), '2024-01-01T00:00:00.000Z');
    
    expect(record1.recordDigest).toBe(record2.recordDigest);
    expect(registry.getRecordCount()).toBe(1);
  });
});