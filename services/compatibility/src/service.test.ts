import { describe, it, expect } from 'vitest';
import { createCompatibilityService } from './service';
import { toSubstrateCompatibilityProfile } from '@arena/agent-body';

// Mock substrate data
const mockSubstrate = {
  digest: 'substrate-123',
  capabilities: {
    modalities: ['text', 'image'],
    toolCallingLevel: 'advanced',
  },
  contextLimits: {
    maxContextUnits: 100000,
  },
  costPerMillionRequests: 0.5,
  conditions: [],
};

describe('Compatibility Service', () => {
  let service: ReturnType<typeof createCompatibilityService>;

  beforeEach(() => {
    service = createCompatibilityService();
  });

  it('should evaluate compatibility and create a record', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const record = await service.evaluateCompatibility(
      profile,
      mockSubstrate,
      {
        correlationId: 'test-correlation-1',
        idempotencyKey: 'test-idempotency-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      }
    );

    expect(record.recordVersion).toBe(1);
    expect(record.bodyVersionRef).toBe(profile.bodyVersionRef);
    expect(record.substrateRef).toBe(mockSubstrate.digest);
    expect(record.verdict).toBe('compatible');
    expect(record.reasons).toHaveLength(0);
    expect((record as any).tenantId).toBe('tenant-1');
    expect((record as any).workspaceId).toBe('workspace-1');
  });

  it('should batch evaluate compatibility', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const mockSubstrateLimited = {
      ...mockSubstrate,
      digest: 'substrate-limited',
      capabilities: {
        modalities: ['text'],
        toolCallingLevel: 'basic',
      },
    };

    const records = await service.batchEvaluateCompatibility(
      profile,
      [mockSubstrate, mockSubstrateLimited],
      {
        correlationId: 'test-correlation-2',
        idempotencyKey: 'test-idempotency-2',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      }
    );

    expect(records).toHaveLength(2);
    expect(records[0].verdict).toBe('compatible');
    expect(records[1].verdict).toBe('compatible');
  });

  it('should get body history', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    // Create multiple records for the same body
    await service.evaluateCompatibility(
      profile,
      mockSubstrate,
      { correlationId: 'test-1', idempotencyKey: 'test-1' }
    );

    const mockSubstrate2 = { ...mockSubstrate, digest: 'substrate-2' };
    await service.evaluateCompatibility(
      profile,
      mockSubstrate2,
      { correlationId: 'test-2', idempotencyKey: 'test-2' }
    );

    const history = await service.getBodyHistory(profile.bodyVersionRef);
    expect(history).toHaveLength(2);
    expect(history.map(r => r.substrateRef)).toEqual([mockSubstrate.digest, mockSubstrate2.digest]);
  });

  it('should get substrate history', async () => {
    const profile1 = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const profile2 = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 5000 },
    });

    await service.evaluateCompatibility(
      profile1,
      mockSubstrate,
      { correlationId: 'test-1', idempotencyKey: 'test-1' }
    );

    await service.evaluateCompatibility(
      profile2,
      mockSubstrate,
      { correlationId: 'test-2', idempotencyKey: 'test-2' }
    );

    const history = await service.getSubstrateHistory(mockSubstrate.digest);
    expect(history).toHaveLength(2);
    expect(history.map(r => r.bodyVersionRef)).toEqual([profile1.bodyVersionRef, profile2.bodyVersionRef]);
  });

  it('should get latest compatibility', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    // Create multiple records for the same body/substrate pair
    await service.evaluateCompatibility(
      profile,
      mockSubstrate,
      { correlationId: 'test-1', idempotencyKey: 'test-1' }
    );

    const latest = await service.getLatestCompatibility(
      profile.bodyVersionRef,
      mockSubstrate.digest
    );
    expect(latest).toBeDefined();
    expect(latest?.verdict).toBe('compatible');
  });

  it('should check compatibility', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const compatible = await service.checkCompatibility(
      profile,
      mockSubstrate,
      'test-correlation'
    );
    expect(compatible).toBe(true);
  });

  it('should get service statistics', () => {
    const stats = service.getStats();
    expect(stats.totalRecords).toBe(0);
    expect(stats.recordsByVerdict).toEqual({});
    expect(stats.registry).toBeDefined();
  });

  it('should filter by tenant and workspace', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    // Create records with different tenants/workspaces
    await service.evaluateCompatibility(
      profile,
      mockSubstrate,
      { correlationId: 'test-1', idempotencyKey: 'test-1', tenantId: 'tenant-1', workspaceId: 'workspace-1' }
    );

    await service.evaluateCompatibility(
      profile,
      mockSubstrate,
      { correlationId: 'test-2', idempotencyKey: 'test-2', tenantId: 'tenant-2', workspaceId: 'workspace-2' }
    );

    const tenant1History = await service.getBodyHistory(profile.bodyVersionRef, 'tenant-1');
    expect(tenant1History).toHaveLength(1);
    expect((tenant1History[0] as any).tenantId).toBe('tenant-1');

    const workspace2History = await service.getBodyHistory(profile.bodyVersionRef, undefined, 'workspace-2');
    expect(workspace2History).toHaveLength(1);
    expect((workspace2History[0] as any).workspaceId).toBe('workspace-2');
  });
});