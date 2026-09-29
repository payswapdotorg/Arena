/**
 * @arena/compatibility-fabric — compatibility service tests (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 */

import { createCompatibilityService } from '../src/service.js';
import { toSubstrateCompatibilityProfile } from '@arena/agent-body';

// Mock test data
const mockSubstrate = {
  recordVersion: 1,
  adapterId: 'test-adapter',
  adapterVersion: '1.0.0',
  modelFamily: 'test-family',
  modelId: 'test-model',
  modelRevision: 'v1',
  modalityProfile: ['text-input', 'text-output'],
  toolCallingProfile: 'text-protocol',
  contextLimits: {
    maxContextUnits: 100000,
    maxOutputUnits: 4000,
  },
  conditions: ['stable'],
  integrity: {
    digestAlgorithm: 'sha256',
    contentDigest: 'mock-digest',
  },
};

describe('Compatibility Service', () => {
  let service: ReturnType<typeof createCompatibilityService>;

  beforeEach(() => {
    service = createCompatibilityService();
  });

  it('should evaluate compatibility and create a record', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const record = await service.evaluateAndRecord(
      'body-version-ref',
      profile,
      mockSubstrate,
      {
        correlationId: 'test-correlation-1',
        idempotencyKey: 'test-idempotency-1',
      }
    );

    expect(record.recordVersion).toBe(1);
    expect(record.bodyVersionRef).toBe('body-version-ref');
    expect(record.substrateRef).toBe(mockSubstrate.integrity.contentDigest);
    expect(record.verdict).toBe('compatible');
    expect(record.reasons).toHaveLength(0);
  });

  it('should batch evaluate compatibility', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const mockSubstrateLimited = {
      ...mockSubstrate,
      integrity: {
        ...mockSubstrate.integrity,
        contentDigest: 'substrate-limited',
      },
      modelId: 'test-model-limited',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'text-protocol',
    };

    const records = await service.batchEvaluateAndRecord(
      'body-version-ref',
      profile,
      [mockSubstrate, mockSubstrateLimited],
      {
        correlationId: 'test-correlation-2',
        idempotencyKey: 'test-idempotency-2',
      }
    );

    expect(records).toHaveLength(2);
    expect(records[0]?.verdict).toBe('compatible');
    expect(records[1]?.verdict).toBe('compatible');
    expect(records[0]?.substrateRef).toBe(mockSubstrate.integrity.contentDigest);
    expect(records[1]?.substrateRef).toBe('substrate-limited');
  });

  it('should get body history', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    await service.evaluateAndRecord(
      'body-version-ref',
      profile,
      mockSubstrate,
      {
        correlationId: 'test-correlation-3',
        idempotencyKey: 'test-idempotency-3',
      }
    );

    const history = service.getHistory({ bodyVersionRef: 'body-version-ref' });
    expect(history).toHaveLength(1);
    expect(history[0].bodyVersionRef).toBe('body-version-ref');
  });

  it('should get substrate history', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    await service.evaluateAndRecord(
      'body-version-ref',
      profile,
      mockSubstrate,
      {
        correlationId: 'test-correlation-4',
        idempotencyKey: 'test-idempotency-4',
      }
    );

    const history = service.getHistory({ substrateRef: 'substrate-ref' });
    expect(history).toHaveLength(1);
    expect(history[0].substrateRef).toBe('substrate-ref');
  });

  it('should get latest compatibility', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    await service.evaluateAndRecord(
      'body-version-ref',
      profile,
      mockSubstrate,
      {
        correlationId: 'test-correlation-5',
        idempotencyKey: 'test-idempotency-5',
      }
    );

    const latest = service.getLatest('body-version-ref', 'substrate-ref');
    expect(latest).toBeDefined();
    expect(latest?.bodyVersionRef).toBe('body-version-ref');
    expect(latest?.substrateRef).toBe('substrate-ref');
  });

  it('should check compatibility', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const record = await service.evaluateAndRecord(
      'body-version-ref',
      profile,
      mockSubstrate,
      {
        correlationId: 'test-correlation-6',
        idempotencyKey: 'test-idempotency-6',
      }
    );

    expect(record.verdict).toBe('compatible');
  });

  it('should get service statistics', async () => {
    const stats = service.getStats();
    expect(stats.totalRecords).toBe(0);
    expect(stats.recordsByVerdict).toEqual({});
  });

  it('should filter by tenant and workspace', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    await service.evaluateAndRecord(
      'body-version-ref',
      profile,
      mockSubstrate,
      {
        correlationId: 'test-correlation-7',
        idempotencyKey: 'test-idempotency-7',
      }
    );

    const allHistory = service.getHistory();
    expect(allHistory).toHaveLength(1);
  });
});