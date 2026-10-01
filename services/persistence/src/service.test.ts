/**
 * Persistence service tests (Work Order B002; issue #64): positive +
 * adversarial. Quota behavior is exercised ONLY through fake meters
 * (FT2.0 "Cost safety": tests never require live provider credentials).
 */

import { describe, expect, it } from 'vitest';
import {
  FakeCapacityMeter,
  FakeControlPlaneRepository,
  FakeMigrationRunner,
  isPersistenceCapacityError,
  isPersistenceError,
  ManualClock,
  PERSISTENCE_ERROR_CODES,
} from '@arena/persistence';
import type { CapacitySnapshot, Migration } from '@arena/persistence';
import type { RegisteredPersistenceProvider, SeedStep } from './ports.js';
import {
  BootstrapService,
  CapacityService,
  ProviderHealthService,
} from './service.js';
import {
  createLocalPersistenceStack,
  createLocalProviderRegistry,
} from './in-memory.js';
import {
  PERSISTENCE_SERVICE_RECORD_VERSION,
  toBootstrapReport,
  toCapacityReport,
  toHealthReport,
} from './shared.js';

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Fixtures (fake meters only — zero live credentials anywhere)
// ---------------------------------------------------------------------------

type ProviderSpec = {
  readonly providerId: string;
  readonly meter: FakeCapacityMeter;
};

function makeProvider(
  spec: Omit<ProviderSpec, 'meter'> & {
    readonly meterOptions?: ConstructorParameters<typeof FakeCapacityMeter>[0];
  },
  clock: ManualClock,
): RegisteredPersistenceProvider {
  const meter = new FakeCapacityMeter({ clock, ...spec.meterOptions });
  return { providerId: spec.providerId, probe: { capacityProbe: async () => meter.probe() }, meter };
}

function asyncErrorOf(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => new Error('expected the operation to reject'),
    (error: unknown) => error,
  );
}

describe('ProviderHealthService (aggregated health)', () => {
  it('reports AVAILABLE overall for the local provider registry (positive)', async () => {
    const clock = new ManualClock(T0);
    const stack = createLocalPersistenceStack({ clock });
    const service = new ProviderHealthService({
      clock,
      providers: createLocalProviderRegistry(stack),
    });
    const report = await service.health();
    expect(report.recordVersion).toBe(PERSISTENCE_SERVICE_RECORD_VERSION);
    expect(report.overall).toBe('AVAILABLE');
    expect(report.checkedAt).toBe(T0);
    expect(report.providers.map((entry) => entry.providerId)).toEqual([
      'control-plane',
      'blob-store',
      'coordination',
    ]);
    for (const entry of report.providers) {
      expect(entry.status).toBe('AVAILABLE');
    }
  });

  it('aggregates worst-of severity: DEGRADED beats AVAILABLE (positive)', async () => {
    const clock = new ManualClock(T0);
    const service = new ProviderHealthService({
      clock,
      providers: [
        makeProvider(
          {
            providerId: 'healthy',
            meterOptions: { dimensions: [{ dimension: 'requests', used: 1, limit: 100, remaining: 99 }] },
          },
          clock,
        ),
        makeProvider(
          {
            providerId: 'near-limit',
            meterOptions: {
              dimensions: [{ dimension: 'requests', used: 95, limit: 100, remaining: 5 }],
            },
          },
          clock,
        ),
      ],
    });
    const report = await service.health();
    expect(report.overall).toBe('DEGRADED');
  });

  it('aggregates worst-of severity: EXHAUSTED beats DEGRADED, DISABLED beats everything', async () => {
    const clock = new ManualClock(T0);
    const exhausted = new ProviderHealthService({
      clock,
      providers: [
        makeProvider(
          {
            providerId: 'near-limit',
            meterOptions: {
              dimensions: [{ dimension: 'requests', used: 95, limit: 100, remaining: 5 }],
            },
          },
          clock,
        ),
        makeProvider(
          {
            providerId: 'used-up',
            meterOptions: {
              dimensions: [{ dimension: 'storage', used: 10, limit: 10, remaining: 0 }],
            },
          },
          clock,
        ),
      ],
    });
    expect((await exhausted.health()).overall).toBe('EXHAUSTED');

    const disabled = new ProviderHealthService({
      clock,
      providers: [
        makeProvider(
          {
            providerId: 'used-up',
            meterOptions: {
              dimensions: [{ dimension: 'storage', used: 10, limit: 10, remaining: 0 }],
            },
          },
          clock,
        ),
        makeProvider(
          {
            providerId: 'unconfigured',
            meterOptions: { status: 'DISABLED', reasons: [{ code: 'configuration-missing' }] },
          },
          clock,
        ),
      ],
    });
    expect((await disabled.health()).overall).toBe('DISABLED');
  });

  it('a THROWING probe degrades the provider instead of crashing, with no transport detail leak (adversarial)', async () => {
    const clock = new ManualClock(T0);
    const service = new ProviderHealthService({
      clock,
      providers: [
        {
          providerId: 'throwing-probe',
          probe: {
            async capacityProbe(): Promise<CapacitySnapshot> {
              throw new Error('secret transport detail xyz');
            },
          },
        },
      ],
    });
    const report = await service.health();
    expect(report.overall).toBe('DEGRADED');
    expect(report.providers[0]?.status).toBe('DEGRADED');
    expect(report.providers[0]?.reasons).toEqual([{ code: 'probe-failed' }]);
    expect(JSON.stringify(report)).not.toContain('secret transport detail xyz');
  });

  it('providerHealth returns one entry, or null for an unregistered id (positive + negative)', async () => {
    const clock = new ManualClock(T0);
    const stack = createLocalPersistenceStack({ clock });
    const service = new ProviderHealthService({
      clock,
      providers: createLocalProviderRegistry(stack),
    });
    const entry = await service.providerHealth('control-plane');
    expect(entry?.providerId).toBe('control-plane');
    expect(await service.providerHealth('not-registered')).toBeNull();
  });

  it('rejects malformed registries at composition time (fail closed)', () => {
    const clock = new ManualClock(T0);
    expect(
      () =>
        new ProviderHealthService({
          clock,
          providers: [
            makeProvider({ providerId: 'dupe' }, clock),
            makeProvider({ providerId: 'dupe' }, clock),
          ],
        }),
    ).toThrow();
    expect(
      () =>
        new ProviderHealthService({
          clock,
          providers: [{ providerId: 'NO-UPPERCASE', probe: { capacityProbe: async () => new FakeCapacityMeter().probe() } }],
        }),
    ).toThrow();
    expect(
      () =>
        new ProviderHealthService({
          clock,
          providers: [{ providerId: 'no-probe' } as unknown as RegisteredPersistenceProvider],
        }),
    ).toThrow();
  });

  it('the health report round-trips through the versioned parser; tampering is rejected (adversarial)', async () => {
    const clock = new ManualClock(T0);
    const stack = createLocalPersistenceStack({ clock });
    const service = new ProviderHealthService({
      clock,
      providers: createLocalProviderRegistry(stack),
    });
    const report = await service.health();
    const parsed = toHealthReport(JSON.parse(JSON.stringify(report)));
    expect(parsed).toEqual(report);

    // An overall that is NOT the worst-of aggregate of the entries is
    // unparseable, as is a wrong record version or a non-object.
    const tampered = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    tampered['overall'] = 'DISABLED';
    expect(() => toHealthReport(tampered)).toThrow();
    expect(() => toHealthReport({ ...report, overall: 'DISABLED' as const })).toThrow();
    expect(() => toHealthReport({ ...report, recordVersion: 2 })).toThrow();
    expect(() => toHealthReport('not-an-object')).toThrow();
  });
});

describe('CapacityService (quota visibility + fail-closed guard)', () => {
  it('surfaces per-provider dimension readings for later UI display (positive)', async () => {
    const clock = new ManualClock(T0);
    const service = new CapacityService({
      clock,
      providers: [
        makeProvider(
          {
            providerId: 'blob-store',
            meterOptions: {
              dimensions: [
                { dimension: 'storage', used: 2, limit: 10, remaining: 8, windowMs: null },
                { dimension: 'requests', used: 40, limit: 1000, remaining: 960, windowMs: 60_000 },
              ],
            },
          },
          clock,
        ),
      ],
    });
    const report = await service.capacity();
    expect(report.recordVersion).toBe(PERSISTENCE_SERVICE_RECORD_VERSION);
    expect(report.overall).toBe('AVAILABLE');
    const entry = report.providers[0];
    expect(entry?.dimensions.map((dimension) => dimension.dimension)).toEqual([
      'storage',
      'requests',
    ]);
    expect(entry?.dimensions[0]?.remaining).toBe(8);
  });

  it('guard() returns the report while every provider is usable (AVAILABLE or DEGRADED)', async () => {
    const clock = new ManualClock(T0);
    const service = new CapacityService({
      clock,
      providers: [
        makeProvider(
          {
            providerId: 'healthy',
            meterOptions: { dimensions: [{ dimension: 'requests', used: 1, limit: 10, remaining: 9 }] },
          },
          clock,
        ),
        makeProvider(
          {
            providerId: 'near-limit',
            meterOptions: {
              dimensions: [{ dimension: 'requests', used: 95, limit: 100, remaining: 5 }],
            },
          },
          clock,
        ),
      ],
    });
    const report = await service.guard();
    expect(report.overall).toBe('DEGRADED');
  });

  it('guard() throws the TYPED exhaustion error when a fake meter reports a used-up dimension — no alternate route (adversarial, FT2.0)', async () => {
    const clock = new ManualClock(T0);
    const service = new CapacityService({
      clock,
      providers: [
        // A healthy provider registered FIRST: the guard must NOT route
        // around the exhausted one — the typed error IS the outcome.
        makeProvider(
          {
            providerId: 'healthy',
            meterOptions: { dimensions: [{ dimension: 'requests', used: 1, limit: 10, remaining: 9 }] },
          },
          clock,
        ),
        makeProvider(
          {
            providerId: 'used-up',
            meterOptions: {
              dimensions: [{ dimension: 'storage', used: 10, limit: 10, remaining: 0 }],
            },
          },
          clock,
        ),
      ],
    });
    const caught = await asyncErrorOf(() => service.guard());
    expect(isPersistenceCapacityError(caught)).toBe(true);
    const capacityError = caught as {
      code?: string;
      capacityStatus?: string;
      details?: Readonly<Record<string, unknown>>;
      capacityReasons?: readonly unknown[];
    };
    expect(capacityError.code).toBe(PERSISTENCE_ERROR_CODES.CAPACITY_EXHAUSTED);
    expect(capacityError.capacityStatus).toBe('EXHAUSTED');
    expect(capacityError.details?.['providerId']).toBe('used-up');
    expect(capacityError.details?.['policy']).toBe('fail-closed');
    expect(capacityError.capacityReasons).toContainEqual({
      code: 'quota-exhausted',
      dimension: 'storage',
    });
  });

  it('guard() throws the TYPED disabled error for an unconfigured provider (adversarial)', async () => {
    const clock = new ManualClock(T0);
    const service = new CapacityService({
      clock,
      providers: [
        makeProvider(
          { providerId: 'unconfigured', meterOptions: { status: 'DISABLED' } },
          clock,
        ),
      ],
    });
    const caught = await asyncErrorOf(() => service.guard());
    expect(isPersistenceCapacityError(caught)).toBe(true);
    const capacityError = caught as { code?: string; capacityStatus?: string; capacityReasons?: unknown[] };
    expect(capacityError.code).toBe(PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED);
    expect(capacityError.capacityStatus).toBe('DISABLED');
    expect(capacityError.capacityReasons).toContainEqual({ code: 'configuration-missing' });
  });

  it('guard() fails on the FIRST blocking provider in registration order, structurally deriving the blocking reason (adversarial)', async () => {
    const clock = new ManualClock(T0);
    const snapshot: CapacitySnapshot = {
      status: 'EXHAUSTED',
      checkedAt: T0,
      dimensions: [
        { dimension: 'bandwidth', used: 5, limit: 5, remaining: 0, windowMs: 60_000 },
      ],
      reasons: [],
    };
    const service = new CapacityService({
      clock,
      providers: [
        {
          providerId: 'first-blocking',
          probe: { capacityProbe: async () => snapshot },
        },
        {
          providerId: 'second-blocking',
          probe: {
            capacityProbe: async () => ({
              ...snapshot,
              status: 'DISABLED' as const,
              dimensions: [],
            }),
          },
        },
      ],
    });
    const caught = await asyncErrorOf(() => service.guard());
    expect(isPersistenceCapacityError(caught)).toBe(true);
    const capacityError = caught as {
      details?: { providerId?: string; reasons?: unknown[] };
    };
    expect(capacityError.details?.['providerId']).toBe('first-blocking');
    // No reasons reported -> the structured blocking reason carries the
    // single dimension that is exhausted.
    expect(capacityError.details?.['reasons']).toEqual([
      { code: 'quota-exhausted', dimension: 'bandwidth' },
    ]);
  });

  it('the capacity report round-trips through the versioned parser; tampered aggregates are rejected (adversarial)', async () => {
    const clock = new ManualClock(T0);
    const service = new CapacityService({
      clock,
      providers: [
        makeProvider(
          {
            providerId: 'used-up',
            meterOptions: {
              dimensions: [{ dimension: 'storage', used: 10, limit: 10, remaining: 0 }],
            },
          },
          clock,
        ),
      ],
    });
    const report = await service.capacity();
    const parsed = toCapacityReport(JSON.parse(JSON.stringify(report)));
    expect(parsed).toEqual(report);
    // Stating an overall that is NOT the worst-of aggregate is unparseable.
    expect(() => toCapacityReport({ ...report, overall: 'AVAILABLE' })).toThrow();
    expect(() => toCapacityReport({ ...report, recordVersion: 99 })).toThrow();
    expect(() => toCapacityReport('not-an-object')).toThrow();
  });
});

describe('BootstrapService (deterministic migrations -> seed-check)', () => {
  function migrations(log: number[]): readonly Migration[] {
    return [
      { version: 1, name: 'create-records', apply: async () => { log.push(1); } },
      { version: 2, name: 'create-ledger', apply: async () => { log.push(2); } },
    ];
  }

  function seedStep(counters: { checks: number; applies: number }): SeedStep {
    return {
      async isSeeded(controlPlane) {
        counters.checks += 1;
        return (await controlPlane.count({ kind: 'seed' })) > 0;
      },
      async apply(controlPlane) {
        counters.applies += 1;
        await controlPlane.insert({
          recordId: 'seed-demo',
          tenantId: 'demo',
          kind: 'seed',
          version: 1,
          data: { seeded: true },
        });
      },
    };
  }

  it('bootstraps in the deterministic order: migrations applied first, then the seed (positive)', async () => {
    const clock = new ManualClock(T0);
    const runner = new FakeMigrationRunner({ clock });
    const controlPlane = new FakeControlPlaneRepository({ clock });
    const counters = { checks: 0, applies: 0 };
    const service = new BootstrapService({
      clock,
      migrationRunner: runner,
      controlPlane,
      seed: seedStep(counters),
    });
    const applied: number[] = [];
    const report = await service.bootstrap(migrations(applied));

    expect(applied).toEqual([1, 2]);
    expect(report.steps).toEqual([
      { step: 'migrations', status: 'applied' },
      { step: 'seed-check', status: 'seeded' },
    ]);
    expect(report.migrations.fromVersion).toBeNull();
    expect(report.migrations.toVersion).toBe(2);
    expect(report.migrations.applied.map((entry) => entry.version)).toEqual([1, 2]);
    expect(report.seedCheck.outcome).toBe('seeded');
    expect(counters.applies).toBe(1);
    expect(await controlPlane.count({ kind: 'seed' })).toBe(1);
  });

  it('re-running bootstrap is a reproducible no-op (skipped migrations, already-seeded)', async () => {
    const clock = new ManualClock(T0);
    const runner = new FakeMigrationRunner({ clock });
    const controlPlane = new FakeControlPlaneRepository({ clock });
    const counters = { checks: 0, applies: 0 };
    const service = new BootstrapService({
      clock,
      migrationRunner: runner,
      controlPlane,
      seed: seedStep(counters),
    });
    const applied: number[] = [];
    await service.bootstrap(migrations(applied));
    clock.advance(1_000);
    const rerun = await service.bootstrap(migrations(applied));

    expect(applied).toEqual([1, 2]); // apply thunks never re-ran
    expect(rerun.steps).toEqual([
      { step: 'migrations', status: 'skipped' },
      { step: 'seed-check', status: 'already-seeded' },
    ]);
    expect(rerun.migrations.applied).toEqual([]);
    expect(rerun.migrations.skipped.map((entry) => entry.version)).toEqual([1, 2]);
    expect(rerun.migrations.fromVersion).toBe(2);
    expect(rerun.migrations.toVersion).toBe(2);
    expect(counters.applies).toBe(1); // the seed applied exactly once
    expect(await controlPlane.count({ kind: 'seed' })).toBe(1);
  });

  it('reports not-configured when no seed step is given (positive)', async () => {
    const clock = new ManualClock(T0);
    const service = new BootstrapService({
      clock,
      migrationRunner: new FakeMigrationRunner({ clock }),
    });
    const applied: number[] = [];
    const report = await service.bootstrap(migrations(applied));
    expect(report.steps[1]).toEqual({ step: 'seed-check', status: 'not-configured' });
    expect(report.seedCheck.outcome).toBe('not-configured');
  });

  it('a failing migration ABORTS the bootstrap before the seed ever runs (adversarial, fail closed)', async () => {
    const clock = new ManualClock(T0);
    const runner = new FakeMigrationRunner({ clock });
    const controlPlane = new FakeControlPlaneRepository({ clock });
    const counters = { checks: 0, applies: 0 };
    const service = new BootstrapService({
      clock,
      migrationRunner: runner,
      controlPlane,
      seed: seedStep(counters),
    });
    const failing: readonly Migration[] = [
      { version: 1, name: 'boom', apply: async () => { throw new Error('sql exploded'); } },
    ];
    const caught = await asyncErrorOf(() => service.bootstrap(failing));
    expect(isPersistenceError(caught)).toBe(true);
    expect((caught as { code?: string }).code).toBe(PERSISTENCE_ERROR_CODES.MIGRATION_FAILED);
    // The seed never ran and was never even CHECKED.
    expect(counters.checks).toBe(0);
    expect(counters.applies).toBe(0);
    expect(await controlPlane.count({})).toBe(0);
  });

  it('a seed step without a control plane fails closed at construction (adversarial)', () => {
    const clock = new ManualClock(T0);
    expect(
      () =>
        new BootstrapService({
          clock,
          migrationRunner: new FakeMigrationRunner({ clock }),
          seed: seedStep({ checks: 0, applies: 0 }),
        }),
    ).toThrow();
  });

  it('the bootstrap report round-trips through the versioned parser; malformed reports are rejected (adversarial)', async () => {
    const clock = new ManualClock(T0);
    const service = new BootstrapService({
      clock,
      migrationRunner: new FakeMigrationRunner({ clock }),
      controlPlane: new FakeControlPlaneRepository({ clock }),
      seed: seedStep({ checks: 0, applies: 0 }),
    });
    const report = await service.bootstrap(migrations([]));
    expect(toBootstrapReport(JSON.parse(JSON.stringify(report)))).toEqual(report);

    // Reordered steps violate the deterministic order -> rejected.
    const reordered = {
      ...report,
      steps: [...report.steps].reverse(),
    };
    expect(() => toBootstrapReport(reordered)).toThrow();
    expect(() => toBootstrapReport({ ...report, recordVersion: 7 })).toThrow();
    expect(() => toBootstrapReport({ ...report, steps: [report.steps[0]] })).toThrow();
  });
});

describe('local composition (FT2.0 local parity)', () => {
  it('creates the local stack over the same ports and a deterministic clock', () => {
    const clock = new ManualClock(0);
    const stack = createLocalPersistenceStack({ clock });
    expect(stack.controlPlane).toBeInstanceOf(FakeControlPlaneRepository);
    expect(stack.migrationRunner).toBeInstanceOf(FakeMigrationRunner);
    expect(stack.clock.now()).toBe(0);
    expect(clock.advance(5)).toBe(5);
    expect(stack.clock.now()).toBe(5);
  });

  it('the local registry probes AVAILABLE for the three neutral logical provider ids', async () => {
    const clock = new ManualClock(T0);
    const stack = createLocalPersistenceStack({ clock });
    const registry = createLocalProviderRegistry(stack);
    expect(registry.map((provider) => provider.providerId)).toEqual([
      'control-plane',
      'blob-store',
      'coordination',
    ]);
    for (const provider of registry) {
      const snapshot = await provider.probe.capacityProbe();
      expect(snapshot.status).toBe('AVAILABLE');
    }
  });
});
