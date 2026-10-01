/**
 * Local composition for @arena/persistence-service (Work Order B002;
 * FT2.0 "Local parity": every hosted adapter has a local fake/in-memory
 * implementation exercising the same contract).
 *
 * `createLocalPersistenceStack` composes the domain fakes into the same
 * port set the hosted adapters implement — the stack B004/B005/B016
 * consume for local install and Demo mode, with ZERO provider
 * configuration (no env vars, nothing to configure).
 * `createLocalProviderRegistry` wraps the stack into
 * `RegisteredPersistenceProvider` entries (neutral logical ids) for the
 * health/capacity services — mirroring how B015 will register the hosted
 * adapters at composition time.
 */

import {
  FakeBlobStore,
  FakeCapacityMeter,
  FakeControlPlaneRepository,
  FakeCoordinationStore,
  FakeMigrationRunner,
} from '@arena/persistence';
import type {
  ControllableClock,
  SystemClock,
} from '@arena/persistence';
import { ManualClock } from '@arena/persistence';
import type { RegisteredPersistenceProvider } from './ports.js';

/** The local in-memory persistence stack (full port parity). */
export interface LocalPersistenceStack {
  readonly controlPlane: FakeControlPlaneRepository;
  readonly blobStore: FakeBlobStore;
  readonly coordination: FakeCoordinationStore;
  readonly migrationRunner: FakeMigrationRunner;
  readonly clock: ControllableClock | SystemClock;
}

export interface LocalPersistenceStackOptions {
  /**
   * Deterministic clock for tests/demo replay; defaults to a manual
   * clock at epoch 0 (fully deterministic local composition).
   */
  readonly clock?: ControllableClock | SystemClock;
}

/**
 * Compose the local in-memory persistence stack (FT2.0 local parity).
 * Every surface implements the SAME port contract as the hosted
 * adapters; the shared contract suite runs against this stack in the
 * service tests (parity is executed, not asserted).
 */
export function createLocalPersistenceStack(
  options: LocalPersistenceStackOptions = {},
): LocalPersistenceStack {
  const clock = options.clock ?? new ManualClock(0);
  return {
    controlPlane: new FakeControlPlaneRepository({ clock }),
    blobStore: new FakeBlobStore({ clock }),
    coordination: new FakeCoordinationStore({ clock }),
    migrationRunner: new FakeMigrationRunner({ clock }),
    clock,
  };
}

/**
 * Wrap a local stack into the provider registry the health/capacity
 * services consume (neutral logical ids — no provider names). Every
 * local provider probes AVAILABLE with no quota dimensions.
 */
export function createLocalProviderRegistry(
  stack: LocalPersistenceStack,
): readonly RegisteredPersistenceProvider[] {
  const provider = (providerId: string): RegisteredPersistenceProvider => {
    const meter = new FakeCapacityMeter({ clock: stack.clock });
    return { providerId, probe: { capacityProbe: async () => meter.probe() }, meter };
  };
  return [
    provider('control-plane'),
    provider('blob-store'),
    provider('coordination'),
  ];
}
