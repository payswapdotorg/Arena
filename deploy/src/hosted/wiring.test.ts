/**
 * B015 wiring tests: strict fail-fast resolution (names only), dry-run
 * resolution, adapter instantiation glue against the local fakes, the
 * DISABLED fail-closed posture, and the deterministic hosted bootstrap.
 */

import { describe, expect, it } from 'vitest';
import { isPersistenceCapacityError, ManualClock, PERSISTENCE_ERROR_CODES } from '@arena/persistence';
import type { Clock } from '@arena/persistence';
import { SQL_MIGRATION_SOURCES } from '@arena/hosted-neon-postgres';
import {
  composeHostedBootstrap,
  composeHostedPersistenceStack,
  createHostedPreviewSeedStep,
  HOSTED_PREVIEW_PROVIDER_IDS,
  resolveHostedWiring,
} from './wiring.js';
import { FakeObjectStorageTransport, FakeRestTransport, FakeSqlTransport } from './fakes.js';
import { DRY_RUN_PLACEHOLDER_ENV } from './dry-run.js';

const CLOCK: Clock = new ManualClock(1_000);

function fakeTransports() {
  return {
    sql: new FakeSqlTransport({ enforceTables: true }),
    objectStorage: new FakeObjectStorageTransport(),
    rest: new FakeRestTransport({ clock: CLOCK }),
  };
}

describe('B015 wiring resolution — strict mode (fail fast, names only)', () => {
  it('fails fast on an empty env with one entry per required surface', () => {
    const resolution = resolveHostedWiring({}, 'strict');
    expect(resolution.failures.map((failure) => failure.providerId)).toEqual([
      HOSTED_PREVIEW_PROVIDER_IDS.controlPlane,
      HOSTED_PREVIEW_PROVIDER_IDS.objectStore,
      HOSTED_PREVIEW_PROVIDER_IDS.coordination,
      'session-boundary',
    ]);
    expect(resolution.failures[0]?.missingEnvVarNames).toContain('DATABASE_URL');
  });

  it('never leaks env VALUES into failures (names-only discipline)', () => {
    const canary = 'canary-secret-value-that-must-never-appear';
    const resolution = resolveHostedWiring(
      {
        DATABASE_URL: 'not-a-postgres-scheme',
        ARENA_SESSION_SECRET: canary,
      },
      'strict',
    );
    const serialized = JSON.stringify(resolution.failures);
    expect(serialized).not.toContain(canary);
    expect(serialized).toContain('DATABASE_URL');
  });

  it('passes with placeholder-shaped values (the real adapter readers accept them)', () => {
    const resolution = resolveHostedWiring(DRY_RUN_PLACEHOLDER_ENV, 'strict');
    expect(resolution.failures).toEqual([]);
    expect(resolution.controlPlane.configured).toBe(true);
    expect(resolution.objectStore.configured).toBe(true);
    expect(resolution.coordination.configured).toBe(true);
    expect(resolution.sessionSecret.lengthOk).toBe(true);
  });

  it('treats an unusable DATABASE_URL scheme as unconfigured (adapter reader is the source of truth)', () => {
    const resolution = resolveHostedWiring({ DATABASE_URL: 'mysql://nope' }, 'strict');
    expect(resolution.controlPlane.configured).toBe(false);
    expect(resolution.failures.map((f) => f.providerId)).toContain(HOSTED_PREVIEW_PROVIDER_IDS.controlPlane);
  });

  it('fails on a short session secret (B004 AUTH_DISABLED parity)', () => {
    const resolution = resolveHostedWiring(
      { ...DRY_RUN_PLACEHOLDER_ENV, ARENA_SESSION_SECRET: 'short' },
      'strict',
    );
    expect(resolution.failures.map((f) => f.providerId)).toContain('session-boundary');
  });
});

describe('B015 wiring resolution — dry-run mode', () => {
  it('never collects failures (missing config is reported, not fatal)', () => {
    const resolution = resolveHostedWiring({}, 'dry-run');
    expect(resolution.failures).toEqual([]);
    expect(resolution.controlPlane.configured).toBe(false);
    expect(resolution.apify.enabled).toBe(false);
  });
});

describe('B015 adapter instantiation glue (B002 adapters + local fakes)', () => {
  it('registers the B014 neutral logical provider ids', () => {
    const stack = composeHostedPersistenceStack({
      env: DRY_RUN_PLACEHOLDER_ENV,
      clock: CLOCK,
      transports: fakeTransports(),
    });
    expect(stack.providers.map((provider) => provider.providerId)).toEqual([
      'control-plane-store',
      'object-store',
      'coordination-store',
    ]);
  });

  it('probes AVAILABLE with the declared free-tier dimensions surfaced', async () => {
    const stack = composeHostedPersistenceStack({
      env: DRY_RUN_PLACEHOLDER_ENV,
      clock: CLOCK,
      transports: fakeTransports(),
    });
    const controlPlane = await stack.controlPlane.capacityProbe();
    expect(controlPlane.status).toBe('AVAILABLE');
    expect(controlPlane.dimensions.map((d) => d.dimension)).toEqual([
      'storage',
      'compute-hours',
      'transfer',
    ]);
    expect(controlPlane.dimensions.every((d) => d.limit !== null)).toBe(true);

    const objectStore = await stack.objectStore.capacityProbe();
    expect(objectStore.status).toBe('AVAILABLE');
    expect(objectStore.dimensions.map((d) => d.dimension)).toEqual([
      'storage',
      'class-a-operations',
      'class-b-operations',
    ]);

    const coordination = await stack.coordination.capacityProbe();
    expect(coordination.status).toBe('AVAILABLE');
    expect(coordination.dimensions.map((d) => d.dimension)).toEqual([
      'commands',
      'storage',
      'bandwidth',
    ]);
  });

  it('constructs DISABLED (fail closed) from an empty env — probes report configuration-missing', async () => {
    const stack = composeHostedPersistenceStack({ env: {}, clock: CLOCK });
    for (const probe of [stack.controlPlane, stack.objectStore, stack.coordination]) {
      const snapshot = await probe.capacityProbe();
      expect(snapshot.status).toBe('DISABLED');
      expect(snapshot.reasons).toEqual([{ code: 'configuration-missing' }]);
    }
    expect(stack.controlPlane.enabled).toBe(false);
  });

  it('refuses operations on the DISABLED stack with the typed capacity error', async () => {
    const stack = composeHostedPersistenceStack({ env: {}, clock: CLOCK });
    await expect(stack.controlPlane.get('some-record')).rejects.toSatisfy((error: unknown) => {
      return (
        isPersistenceCapacityError(error) &&
        error.capacityStatus === 'DISABLED' &&
        error.code === PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED
      );
    });
  });
});

describe('B015 deterministic hosted bootstrap (migrations -> seed)', () => {
  it('applies the versioned SQL migrations and the seed exactly once; re-runs are no-ops', async () => {
    const bootstrapStack = composeHostedBootstrap({
      env: DRY_RUN_PLACEHOLDER_ENV,
      clock: CLOCK,
      transports: fakeTransports(),
    });
    expect(bootstrapStack.migrations.length).toBeGreaterThan(0);

    const first = await bootstrapStack.bootstrap.bootstrap(bootstrapStack.migrations);
    expect(first.migrations.applied.length).toBe(bootstrapStack.migrations.length);
    // The applied-version pin tracks the adapter's exported migration ledger
    // (SQL_MIGRATION_SOURCES) rather than a hardcoded list: the P002-series
    // work added migrations 0003-0006 and the B015-era [1, 2] pin went stale,
    // turning the whole Deploy preview workflow red on every main push after
    // 377e4fe (P008 diagnosis, 2026-10-09). Deriving the expectation keeps the
    // cross-check (deploy bootstrap applies EXACTLY the exported ledger, in
    // ascending order) without drifting on the next migration.
    expect(first.migrations.applied.map((entry) => entry.version)).toEqual(
      SQL_MIGRATION_SOURCES.map((source) => source.version),
    );
    expect(first.seedCheck.outcome).toBe('seeded');

    const second = await bootstrapStack.bootstrap.bootstrap(bootstrapStack.migrations);
    expect(second.migrations.applied).toEqual([]);
    expect(second.migrations.skipped.length).toBe(bootstrapStack.migrations.length);
    expect(second.seedCheck.outcome).toBe('already-seeded');
  });

  it('exposes the marker record through the control plane (hosted seed predicate)', async () => {
    const bootstrapStack = composeHostedBootstrap({
      env: DRY_RUN_PLACEHOLDER_ENV,
      clock: CLOCK,
      transports: fakeTransports(),
    });
    await bootstrapStack.bootstrap.bootstrap(bootstrapStack.migrations);
    const marker = await bootstrapStack.controlPlane.get('preview-bootstrap-marker');
    expect(marker).not.toBeNull();
    expect(marker?.tenantId).toBe('preview');
    expect(marker?.kind).toBe('preview-bootstrap');
  });
});

describe('B015 hosted seed step (standalone predicate)', () => {
  it('is idempotent: apply -> isSeeded; identical replay is a no-op', async () => {
    // ONE shared fake transport set: the repository and the bootstrap must
    // see the same in-memory database. A no-op seed keeps the table clean
    // so the STANDALONE predicate starts unseeded.
    const transports = fakeTransports();
    const bootstrapStack = composeHostedBootstrap({
      env: DRY_RUN_PLACEHOLDER_ENV,
      clock: CLOCK,
      transports,
      seed: { isSeeded: async () => true, apply: async () => undefined },
    });
    await bootstrapStack.bootstrap.bootstrap(bootstrapStack.migrations);
    const controlPlane = bootstrapStack.controlPlane;

    const seed = createHostedPreviewSeedStep();
    expect(await seed.isSeeded(controlPlane)).toBe(false);
    await seed.apply(controlPlane);
    expect(await seed.isSeeded(controlPlane)).toBe(true);
    await expect(
      controlPlane.insert({
        recordId: 'preview-bootstrap-marker',
        tenantId: 'preview',
        kind: 'preview-bootstrap',
        version: 1,
        data: { note: 'Arena hosted preview bootstrap marker (B015)', surface: 'hosted-preview' },
      }),
    ).resolves.toMatchObject({ created: false });
  });
});
