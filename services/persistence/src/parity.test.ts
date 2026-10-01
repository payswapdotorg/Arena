/**
 * Executed local parity (FT2.0): the shared persistence contract suite
 * from @arena/persistence runs against the SERVICE's own local
 * composition (`createLocalPersistenceStack`) — the exact port set the
 * hosted adapters implement. Parity is executed, not asserted.
 */

import { definePersistenceContractSuite, FakeCapacityMeter, ManualClock } from '@arena/persistence';
import { createLocalPersistenceStack } from './in-memory.js';

const T0 = 1_700_000_000_000;

definePersistenceContractSuite('local persistence stack (service composition)', () => {
  const clock = new ManualClock(T0);
  const stack = createLocalPersistenceStack({ clock });
  return {
    controlPlane: stack.controlPlane,
    blobStore: stack.blobStore,
    coordination: stack.coordination,
    migrationRunner: stack.migrationRunner,
    capacityMeter: new FakeCapacityMeter({
      clock,
      dimensions: [{ dimension: 'storage', used: 1, limit: 10, remaining: 9 }],
    }),
    clock,
  };
});
