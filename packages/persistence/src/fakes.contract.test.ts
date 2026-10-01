/**
 * Local parity (FT2.0): the shared persistence contract suite runs against
 * every in-memory fake. Hosted adapters run the SAME suite in
 * adapters/hosted/* (through their injected transport seams, or live when
 * credentials exist). Parity is executed, not asserted.
 */

import { describe, expect, it } from 'vitest';
import {
  definePersistenceContractSuite,
  FakeBlobStore,
  FakeCapacityMeter,
  FakeControlPlaneRepository,
  FakeCoordinationStore,
  FakeMigrationRunner,
  ManualClock,
} from './index.js';

const T0 = 1_700_000_000_000;

definePersistenceContractSuite('local fakes', () => {
  const clock = new ManualClock(T0);
  return {
    controlPlane: new FakeControlPlaneRepository({ clock }),
    blobStore: new FakeBlobStore({ clock }),
    coordination: new FakeCoordinationStore({ clock }),
    migrationRunner: new FakeMigrationRunner({ clock }),
    capacityMeter: new FakeCapacityMeter({
      clock,
      dimensions: [{ dimension: 'storage', used: 1, limit: 10, remaining: 9 }],
    }),
    clock,
  };
});

describe('fake capacity meter scenarios (FT2.0 cost safety: fake meters, no live credentials)', () => {
  it('derives EXHAUSTED from a used-up dimension', async () => {
    const meter = new FakeCapacityMeter({
      dimensions: [{ dimension: 'requests', used: 10, limit: 10, remaining: 0 }],
    });
    const snapshot = await meter.probe();
    expect(snapshot.status).toBe('EXHAUSTED');
    expect(snapshot.reasons).toContainEqual({ code: 'quota-exhausted', dimension: 'requests' });
  });

  it('accepts an explicit DISABLED status (missing configuration posture)', async () => {
    const meter = new FakeCapacityMeter({
      status: 'DISABLED',
      reasons: [{ code: 'configuration-missing' }],
    });
    const snapshot = await meter.probe();
    expect(snapshot.status).toBe('DISABLED');
    expect(snapshot.dimensions).toEqual([]);
  });

  it('rejects malformed scenarios fail-closed', () => {
    expect(
      () =>
        new FakeCapacityMeter({
          dimensions: [{ dimension: 'storage', used: 5, limit: 4, remaining: -1 }],
        }),
    ).toThrow();
  });
});
