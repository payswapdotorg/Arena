/**
 * Persistence contract test kit (Work Order B002; issue #64).
 *
 * `definePersistenceContractSuite(name, factory)` runs the SAME contract
 * tests against ANY persistence implementation — the local fakes in CI
 * and the hosted adapters (via their injected transport seams, or live
 * when provider auth exists). This is the FT2.0 "Local parity" enforcement
 * mechanism: parity is not a claim, it is an executed suite.
 *
 * Two entry forms:
 *   - single fixture factory: `definePersistenceContractSuite('fakes',
 *     () => ({ controlPlane, blobStore, ... }))` — a synchronous probe
 *     registers only the suites for the ports the fixture provides;
 *   - per-port factories: `definePersistenceContractSuite('hosted', {
 *     controlPlane: () => ({ port, clock }), ... })` — only the listed
 *     suites run (hosted adapters use this form; per-port suites are also
 *     exported individually).
 *
 * Every suite creates a FRESH fixture per test (`beforeEach`), so tests
 * are order-independent. Fixtures may provide a ControllableClock — when
 * present, TTL/expiry tests are fully deterministic; when absent they
 * fall back to short real-time TTLs (suitable for live hosted runs).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { isProviderCapacityStatus, toCapacityDimensionReading } from '../capacity.js';
import type { CapacitySnapshot } from '../capacity.js';
import { isPersistenceError } from '../errors.js';
import type { PersistenceErrorCode } from '../errors.js';
import type { CapacityMeter } from '../ports/capacity-meter.js';
import type { ControllableClock } from '../ports/clock.js';
import type {
  ControlPlaneInsertInput,
  ControlPlaneRepository,
} from '../ports/control-plane-repository.js';
import { contentAddressedBlobKey } from '../ports/blob-store.js';
import type { BlobStore } from '../ports/blob-store.js';
import type { CoordinationStore } from '../ports/coordination-store.js';
import type { Migration, MigrationRunner } from '../ports/migration-runner.js';
import type { CoordinationKey, JsonSafeValue } from '../shared.js';
import { newIdempotencyKey } from '@arena/protocol-core';

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

/** One fixture per test: the implementation under test + optional clock. */
export interface PersistenceContractFixture {
  readonly controlPlane?: ControlPlaneRepository;
  readonly blobStore?: BlobStore;
  readonly coordination?: CoordinationStore;
  readonly migrationRunner?: MigrationRunner;
  readonly capacityMeter?: CapacityMeter;
  /** Deterministic time for TTL/expiry assertions when available. */
  readonly clock?: ControllableClock;
}

export type PersistenceContractFixtureFactory =
  () => PersistenceContractFixture | Promise<PersistenceContractFixture>;

/** Per-port fixture form used by the options entry point. */
export interface PersistenceContractSuiteOptions {
  readonly controlPlane?: PersistenceContractFixtureFactory;
  readonly blobStore?: PersistenceContractFixtureFactory;
  readonly coordination?: PersistenceContractFixtureFactory;
  readonly migrationRunner?: PersistenceContractFixtureFactory;
  readonly capacityMeter?: PersistenceContractFixtureFactory;
}

/** Mutable builder form used internally to register provided suites. */
type MutableSuiteOptions = {
  -readonly [K in keyof PersistenceContractSuiteOptions]: PersistenceContractFixtureFactory | undefined;
};

function toOptions(options: MutableSuiteOptions): PersistenceContractSuiteOptions {
  return {
    ...(options.controlPlane !== undefined ? { controlPlane: options.controlPlane } : {}),
    ...(options.blobStore !== undefined ? { blobStore: options.blobStore } : {}),
    ...(options.coordination !== undefined ? { coordination: options.coordination } : {}),
    ...(options.migrationRunner !== undefined ? { migrationRunner: options.migrationRunner } : {}),
    ...(options.capacityMeter !== undefined ? { capacityMeter: options.capacityMeter } : {}),
  };
}

/** Run the contract suites for the ports a fixture factory provides. */
export function definePersistenceContractSuite(
  name: string,
  factoryOrOptions: PersistenceContractFixtureFactory | PersistenceContractSuiteOptions,
): void {
  if (typeof factoryOrOptions === 'function') {
    const probe = factoryOrOptions();
    const syncProbe: PersistenceContractFixture | null =
      probe !== null &&
      typeof probe === 'object' &&
      typeof (probe as PromiseLike<PersistenceContractFixture>).then !== 'function'
        ? (probe as PersistenceContractFixture)
        : null;
    const options: MutableSuiteOptions = {};
    if (syncProbe === null) {
      // Async factory (e.g. live hosted runs): all suites are registered;
      // beforeEach enforces that the fixture provides each port.
      options.controlPlane = factoryOrOptions;
      options.blobStore = factoryOrOptions;
      options.coordination = factoryOrOptions;
      options.migrationRunner = factoryOrOptions;
      options.capacityMeter = factoryOrOptions;
    } else {
      if (syncProbe.controlPlane !== undefined) options.controlPlane = factoryOrOptions;
      if (syncProbe.blobStore !== undefined) options.blobStore = factoryOrOptions;
      if (syncProbe.coordination !== undefined) options.coordination = factoryOrOptions;
      if (syncProbe.migrationRunner !== undefined) options.migrationRunner = factoryOrOptions;
      if (syncProbe.capacityMeter !== undefined) options.capacityMeter = factoryOrOptions;
    }
    defineFromOptions(name, toOptions(options));
    return;
  }
  defineFromOptions(name, factoryOrOptions);
}

export function defineControlPlaneRepositoryContractSuite(
  name: string,
  factory: PersistenceContractFixtureFactory,
): void {
  defineFromOptions(name, { controlPlane: factory });
}

export function defineBlobStoreContractSuite(
  name: string,
  factory: PersistenceContractFixtureFactory,
): void {
  defineFromOptions(name, { blobStore: factory });
}

export function defineCoordinationStoreContractSuite(
  name: string,
  factory: PersistenceContractFixtureFactory,
): void {
  defineFromOptions(name, { coordination: factory });
}

export function defineMigrationRunnerContractSuite(
  name: string,
  factory: PersistenceContractFixtureFactory,
): void {
  defineFromOptions(name, { migrationRunner: factory });
}

export function defineCapacityMeterContractSuite(
  name: string,
  factory: PersistenceContractFixtureFactory,
): void {
  defineFromOptions(name, { capacityMeter: factory });
}

function defineFromOptions(name: string, options: PersistenceContractSuiteOptions): void {
  describe(`${name} — persistence contract suite`, () => {
    if (options.controlPlane !== undefined) {
      controlPlaneContract(options.controlPlane);
    }
    if (options.blobStore !== undefined) {
      blobStoreContract(options.blobStore);
    }
    if (options.coordination !== undefined) {
      coordinationStoreContract(options.coordination);
    }
    if (options.migrationRunner !== undefined) {
      migrationRunnerContract(options.migrationRunner);
    }
    if (options.capacityMeter !== undefined) {
      capacityMeterContract(options.capacityMeter);
    }
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function expectErrorCode(
  promise: Promise<unknown>,
  code: PersistenceErrorCode,
): Promise<void> {
  let caught: unknown;
  let rejected = false;
  try {
    await promise;
  } catch (error) {
    caught = error;
    rejected = true;
  }
  expect(rejected, `expected the operation to reject with ${code}`).toBe(true);
  expect(
    isPersistenceError(caught),
    `expected a PersistenceError, got: ${String(caught)}`,
  ).toBe(true);
  if (isPersistenceError(caught)) {
    expect(caught.code).toBe(code);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function seedInput(recordId: string, data: JsonSafeValue = { value: 1 }): ControlPlaneInsertInput {
  return { recordId, tenantId: 'tenant-alpha', kind: 'capability-case', version: 1, data };
}

/** Brand a coordination key literal for port calls (the impl validates it). */
function key(value: string): CoordinationKey {
  return value as CoordinationKey;
}

// ---------------------------------------------------------------------------
// ControlPlaneRepository contract
// ---------------------------------------------------------------------------

function controlPlaneContract(factory: PersistenceContractFixtureFactory): void {
  describe('ControlPlaneRepository port contract', () => {
    let repo: ControlPlaneRepository;
    let clock: ControllableClock | undefined;

    beforeEach(async () => {
      const fixture = await factory();
      if (fixture.controlPlane === undefined) {
        throw new Error('fixture factory must provide controlPlane for this suite');
      }
      repo = fixture.controlPlane;
      clock = fixture.clock;
    });

    it('inserts a new record with revision 1 and createdAt === updatedAt', async () => {
      const result = await repo.insert(seedInput('record-1'));
      expect(result.created).toBe(true);
      expect(result.record.recordId).toBe('record-1');
      expect(result.record.tenantId).toBe('tenant-alpha');
      expect(result.record.kind).toBe('capability-case');
      expect(result.record.version).toBe(1);
      expect(result.record.revision).toBe(1);
      expect(result.record.data).toEqual({ value: 1 });
      expect(result.record.updatedAt).toBe(result.record.createdAt);
      if (clock !== undefined) {
        expect(result.record.createdAt).toBe(clock.now());
      }
    });

    it('replays an identical insert idempotently (created: false, same record)', async () => {
      const first = await repo.insert(seedInput('record-1'));
      const second = await repo.insert(seedInput('record-1', { value: 1 }));
      expect(second.created).toBe(false);
      expect(second.record).toEqual(first.record);
    });

    it('rejects a conflicting insert under the same record id (typed error)', async () => {
      await repo.insert(seedInput('record-1'));
      await expectErrorCode(
        repo.insert(seedInput('record-1', { value: 2 })),
        'PERSISTENCE_RECORD_EXISTS',
      );
    });

    it('validates insert inputs (typed errors, fail closed)', async () => {
      await expectErrorCode(
        repo.insert(seedInput('bad id with spaces')),
        'PERSISTENCE_INVALID_RECORD_ID',
      );
      await expectErrorCode(
        repo.insert({ ...seedInput('record-1'), tenantId: 'BAD_TENANT' }),
        'PERSISTENCE_INVALID_TENANT_ID',
      );
      await expectErrorCode(
        repo.insert({ ...seedInput('record-1'), kind: 'Bad Kind' }),
        'PERSISTENCE_INVALID_RECORD_KIND',
      );
      await expectErrorCode(
        repo.insert({ ...seedInput('record-1'), version: 0 }),
        'PERSISTENCE_INVALID_RECORD_VERSION',
      );
      await expectErrorCode(
        repo.insert({ ...seedInput('record-1'), data: undefined as unknown as JsonSafeValue }),
        'PERSISTENCE_INVALID_RECORD_DATA',
      );
    });

    it('get returns null for absent records and the exact record otherwise', async () => {
      expect(await repo.get('absent-1')).toBeNull();
      const inserted = await repo.insert(seedInput('record-1'));
      expect(await repo.get('record-1')).toEqual(inserted.record);
    });

    it('updates with optimistic concurrency: revision +1, identity preserved', async () => {
      const inserted = await repo.insert(seedInput('record-1'));
      const updated = await repo.update('record-1', {
        expectedRevision: inserted.record.revision,
        data: { value: 2 },
      });
      expect(updated.revision).toBe(2);
      expect(updated.data).toEqual({ value: 2 });
      expect(updated.recordId).toBe(inserted.record.recordId);
      expect(updated.tenantId).toBe(inserted.record.tenantId);
      expect(updated.kind).toBe(inserted.record.kind);
      expect(updated.createdAt).toBe(inserted.record.createdAt);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(inserted.record.updatedAt);
    });

    it('update rejects absent records (typed error)', async () => {
      await expectErrorCode(
        repo.update('absent-1', { expectedRevision: 1, data: { value: 1 } }),
        'PERSISTENCE_RECORD_NOT_FOUND',
      );
    });

    it('update rejects revision mismatches (typed conflict)', async () => {
      await repo.insert(seedInput('record-1'));
      await expectErrorCode(
        repo.update('record-1', { expectedRevision: 99, data: { value: 1 } }),
        'PERSISTENCE_REVISION_CONFLICT',
      );
    });

    it('update validates revision and payload (typed errors)', async () => {
      await expectErrorCode(
        repo.update('record-1', { expectedRevision: 0, data: { value: 1 } }),
        'PERSISTENCE_INVALID_REVISION',
      );
      await expectErrorCode(
        repo.update('record-1', {
          expectedRevision: 1,
          data: Symbol('nope') as unknown as JsonSafeValue,
        }),
        'PERSISTENCE_INVALID_RECORD_DATA',
      );
    });

    it('delete returns true once, then false; the record is gone', async () => {
      await repo.insert(seedInput('record-1'));
      expect(await repo.delete('record-1')).toBe(true);
      expect(await repo.get('record-1')).toBeNull();
      expect(await repo.delete('record-1')).toBe(false);
    });

    it('re-inserting after delete creates a fresh record', async () => {
      const first = await repo.insert(seedInput('record-1'));
      await repo.delete('record-1');
      const second = await repo.insert(seedInput('record-1'));
      expect(second.created).toBe(true);
      expect(second.record.createdAt).toBeGreaterThanOrEqual(first.record.createdAt);
    });

    it('lists deterministically (recordId ascending) with kind/tenant filters', async () => {
      await repo.insert(seedInput('record-b'));
      await repo.insert(seedInput('record-a'));
      await repo.insert({ ...seedInput('record-c'), tenantId: 'tenant-beta' });
      await repo.insert({ ...seedInput('record-d'), kind: 'job-record' });
      const listed = await repo.list({});
      expect(listed.map((record) => record.recordId)).toEqual([
        'record-a',
        'record-b',
        'record-c',
        'record-d',
      ]);
      const alpha = await repo.list({ tenantId: 'tenant-alpha' });
      expect(alpha.map((record) => record.recordId)).toEqual(['record-a', 'record-b', 'record-d']);
      const cases = await repo.list({ kind: 'capability-case' });
      expect(cases.map((record) => record.recordId)).toEqual(['record-a', 'record-b', 'record-c']);
      const scoped = await repo.list({ kind: 'capability-case', tenantId: 'tenant-beta' });
      expect(scoped.map((record) => record.recordId)).toEqual(['record-c']);
    });

    it('paginates with limit/offset', async () => {
      for (const id of ['record-a', 'record-b', 'record-c', 'record-d']) {
        await repo.insert(seedInput(id));
      }
      expect((await repo.list({ limit: 2 })).map((r) => r.recordId)).toEqual([
        'record-a',
        'record-b',
      ]);
      expect((await repo.list({ limit: 2, offset: 2 })).map((r) => r.recordId)).toEqual([
        'record-c',
        'record-d',
      ]);
      expect(await repo.list({ limit: 2, offset: 4 })).toEqual([]);
      expect((await repo.list({ offset: 3 })).map((r) => r.recordId)).toEqual(['record-d']);
    });

    it('count agrees with unpaginated list', async () => {
      await repo.insert(seedInput('record-a'));
      await repo.insert({ ...seedInput('record-b'), tenantId: 'tenant-beta' });
      expect(await repo.count({})).toBe(2);
      expect(await repo.count({ tenantId: 'tenant-alpha' })).toBe(1);
      expect(await repo.count({ kind: 'capability-case', tenantId: 'tenant-beta' })).toBe(1);
      expect(await repo.count({ kind: 'absent-kind' })).toBe(0);
    });

    it('returns frozen records (read discipline)', async () => {
      const inserted = await repo.insert(seedInput('record-1'));
      expect(Object.isFrozen(inserted.record)).toBe(true);
      const fetched = await repo.get('record-1');
      expect(Object.isFrozen(fetched)).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------
// BlobStore contract
// ---------------------------------------------------------------------------

function blobStoreContract(factory: PersistenceContractFixtureFactory): void {
  describe('BlobStore port contract', () => {
    let store: BlobStore;
    let clock: ControllableClock | undefined;

    beforeEach(async () => {
      const fixture = await factory();
      if (fixture.blobStore === undefined) {
        throw new Error('fixture factory must provide blobStore for this suite');
      }
      store = fixture.blobStore;
      clock = fixture.clock;
    });

    it('put derives a content-addressed key (sha256:<hex>) and receipt facts', async () => {
      const content = new TextEncoder().encode('arena-blob-content');
      const result = await store.put({ content, contentType: 'application/octet-stream' });
      expect(result.key).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.digest).toBe(result.key.slice('sha256:'.length));
      expect(result.byteLength).toBe(content.byteLength);
      expect(result.alreadyPresent).toBe(false);
      if (clock !== undefined) {
        expect(result.createdAt).toBe(clock.now());
      }
    });

    it('replaying identical content is an idempotent put (alreadyPresent: true)', async () => {
      const content = new TextEncoder().encode('arena-blob-content');
      const first = await store.put({
        content,
        contentType: 'application/json',
        metadata: { origin: 'test' },
      });
      const replay = await store.put({
        content: new TextEncoder().encode('arena-blob-content'),
        contentType: 'application/json',
        metadata: { origin: 'other' },
      });
      expect(replay.key).toBe(first.key);
      expect(replay.alreadyPresent).toBe(true);
      expect(replay.createdAt).toBe(first.createdAt);
      // Immutability: the FIRST write's metadata wins; content cannot be
      // overwritten through any operation of this port.
      const fetched = await store.get(first.key);
      expect(fetched?.metadata).toEqual({ origin: 'test' });
    });

    it('different content addresses to a different key; both remain readable', async () => {
      const a = await store.put({
        content: new TextEncoder().encode('a'),
        contentType: 'text/plain',
      });
      const b = await store.put({
        content: new TextEncoder().encode('b'),
        contentType: 'text/plain',
      });
      expect(a.key).not.toBe(b.key);
      expect((await store.get(a.key))?.content).toEqual(new TextEncoder().encode('a'));
      expect((await store.get(b.key))?.content).toEqual(new TextEncoder().encode('b'));
    });

    it('get round-trips content, content type, metadata, digest and byte length', async () => {
      const content = new TextEncoder().encode('{"kind":"trajectory"}');
      const put = await store.put({
        content,
        contentType: 'application/json',
        metadata: { lineage: 'case-1', step: '7' },
      });
      const record = await store.get(put.key);
      expect(record).not.toBeNull();
      expect(record?.content).toEqual(content);
      expect(record?.contentType).toBe('application/json');
      expect(record?.metadata).toEqual({ lineage: 'case-1', step: '7' });
      expect(record?.digest).toBe(put.digest);
      expect(record?.byteLength).toBe(content.byteLength);
      expect(record?.key).toBe(put.key);
    });

    it('get returns defensive copies (mutating a record cannot corrupt the store)', async () => {
      const content = new TextEncoder().encode('immutable-bytes');
      const put = await store.put({ content, contentType: 'text/plain' });
      const first = await store.get(put.key);
      first?.content.fill(0);
      const second = await store.get(put.key);
      expect(second?.content).toEqual(content);
    });

    it('get/exists/delete report absence as null/false/false', async () => {
      const absent = contentAddressedBlobKey('0'.repeat(64));
      expect(await store.get(absent)).toBeNull();
      expect(await store.exists(absent)).toBe(false);
      expect(await store.delete(absent)).toBe(false);
    });

    it('delete removes the blob (lifecycle, not in-place mutation)', async () => {
      const put = await store.put({
        content: new TextEncoder().encode('x'),
        contentType: 'text/plain',
      });
      expect(await store.exists(put.key)).toBe(true);
      expect(await store.delete(put.key)).toBe(true);
      expect(await store.exists(put.key)).toBe(false);
      expect(await store.get(put.key)).toBeNull();
    });

    it('put accepts no key parameter (content addressing is structural)', () => {
      // The port has no put(key, content) operation: the single put
      // parameter is the input object. This is the runtime witness that
      // in-place mutation is unrepresentable.
      expect(store.put.length).toBe(1);
    });

    it('validates put inputs (typed errors, fail closed)', async () => {
      await expectErrorCode(
        store.put({ content: new Uint8Array(0), contentType: 'text/plain' }),
        'PERSISTENCE_INVALID_BLOB_CONTENT',
      );
      await expectErrorCode(
        store.put({ content: new TextEncoder().encode('x'), contentType: 'not a type' }),
        'PERSISTENCE_INVALID_BLOB_CONTENT_TYPE',
      );
      await expectErrorCode(
        store.put({
          content: new TextEncoder().encode('x'),
          contentType: 'text/plain',
          metadata: { ['x'.repeat(200)]: 'v' },
        }),
        'PERSISTENCE_INVALID_BLOB_METADATA',
      );
    });

    it('validates blob keys on get/exists/delete (typed errors)', async () => {
      const bad = 'not-a-key' as unknown as ReturnType<typeof contentAddressedBlobKey>;
      await expectErrorCode(store.get(bad), 'PERSISTENCE_INVALID_BLOB_KEY');
      await expectErrorCode(store.exists(bad), 'PERSISTENCE_INVALID_BLOB_KEY');
      await expectErrorCode(store.delete(bad), 'PERSISTENCE_INVALID_BLOB_KEY');
    });
  });
}

// ---------------------------------------------------------------------------
// CoordinationStore contract
// ---------------------------------------------------------------------------

function coordinationStoreContract(factory: PersistenceContractFixtureFactory): void {
  describe('CoordinationStore port contract', () => {
    let store: CoordinationStore;
    let clock: ControllableClock | undefined;

    beforeEach(async () => {
      const fixture = await factory();
      if (fixture.coordination === undefined) {
        throw new Error('fixture factory must provide coordination for this suite');
      }
      store = fixture.coordination;
      clock = fixture.clock;
    });

    // -- TTL cache ----------------------------------------------------------

    it('cacheSet/cacheGet round-trip bounded values; absent keys read null', async () => {
      await store.cacheSet(key('cache:alpha'), 'value-1', 60_000);
      expect(await store.cacheGet(key('cache:alpha'))).toBe('value-1');
      expect(await store.cacheGet(key('cache:absent'))).toBeNull();
    });

    it('cacheDelete removes live entries', async () => {
      await store.cacheSet(key('cache:alpha'), 'value-1', 60_000);
      expect(await store.cacheDelete(key('cache:alpha'))).toBe(true);
      expect(await store.cacheGet(key('cache:alpha'))).toBeNull();
      expect(await store.cacheDelete(key('cache:alpha'))).toBe(false);
    });

    it('cache entries expire at their TTL (deterministic under a controllable clock)', async () => {
      if (clock === undefined) {
        await store.cacheSet(key('cache:alpha'), 'value-1', 20);
        await delay(60);
        expect(await store.cacheGet(key('cache:alpha'))).toBeNull();
        return;
      }
      await store.cacheSet(key('cache:alpha'), 'value-1', 1_000);
      clock.advance(999);
      expect(await store.cacheGet(key('cache:alpha'))).toBe('value-1');
      clock.advance(1);
      expect(await store.cacheGet(key('cache:alpha'))).toBeNull();
    });

    it('cacheSet validates key, value and TTL (typed errors)', async () => {
      await expectErrorCode(
        store.cacheSet(key('bad key!'), 'value', 1_000),
        'PERSISTENCE_INVALID_COORDINATION_KEY',
      );
      await expectErrorCode(
        store.cacheSet(key('cache:alpha'), '', 1_000),
        'PERSISTENCE_INVALID_COORDINATION_VALUE',
      );
      await expectErrorCode(store.cacheSet(key('cache:alpha'), 'value', 0), 'PERSISTENCE_INVALID_TTL');
    });

    // -- Idempotency windows -------------------------------------------------

    it('opens, replays and conflicts idempotency windows deterministically', async () => {
      const key = newIdempotencyKey();
      const digest = 'a'.repeat(64);
      const first = await store.openIdempotencyWindow(key, digest, 5_000);
      expect(first.outcome).toBe('opened');
      const replay = await store.openIdempotencyWindow(key, digest, 5_000);
      expect(replay.outcome).toBe('duplicate');
      expect(replay.expiresAt).toBe(first.expiresAt);
      await expectErrorCode(
        store.openIdempotencyWindow(key, 'b'.repeat(64), 5_000),
        'PERSISTENCE_IDEMPOTENCY_CONFLICT',
      );
    });

    it('expired idempotency windows reopen (bounded, rebuildable state)', async () => {
      const key = newIdempotencyKey();
      const digest = 'c'.repeat(64);
      if (clock === undefined) {
        await store.openIdempotencyWindow(key, digest, 20);
        await delay(60);
        const reopened = await store.openIdempotencyWindow(key, digest, 20);
        expect(reopened.outcome).toBe('opened');
        return;
      }
      const first = await store.openIdempotencyWindow(key, digest, 1_000);
      clock.advance(1_000);
      const reopened = await store.openIdempotencyWindow(key, digest, 1_000);
      expect(reopened.outcome).toBe('opened');
      expect(reopened.expiresAt).toBeGreaterThan(first.expiresAt);
    });

    it('idempotency windows validate digest and TTL (typed errors)', async () => {
      const key = newIdempotencyKey();
      await expectErrorCode(
        store.openIdempotencyWindow(key, 'NOT_HEX', 1_000),
        'PERSISTENCE_INVALID_COORDINATION_VALUE',
      );
      await expectErrorCode(
        store.openIdempotencyWindow(key, 'd'.repeat(64), 0),
        'PERSISTENCE_INVALID_TTL',
      );
    });

    // -- Rate-limit counters --------------------------------------------------

    it('enforces fixed-window rate limits with aligned resets', async () => {
      if (clock === undefined) {
        // Live mode (no injected clock): the window must be wide enough to
        // absorb real REST latency across the three hits below — a 1s
        // wall-clock window flakes whenever a boundary falls mid-test (each
        // hit is 1-2 network round trips). 60s keeps the identical
        // fixed-window semantics with a negligible boundary-crossing chance.
        const windowMs = 60_000;
        const first = await store.hitRateLimit(key('rl:alpha'), windowMs, 2);
        expect(first.allowed).toBe(true);
        expect(first.count).toBe(1);
        expect(first.remaining).toBe(1);
        expect(await store.hitRateLimit(key('rl:alpha'), windowMs, 2)).toMatchObject({
          allowed: true,
          count: 2,
          remaining: 0,
        });
        const denied = await store.hitRateLimit(key('rl:alpha'), windowMs, 2);
        expect(denied.allowed).toBe(false);
        expect(denied.count).toBe(3);
        expect(denied.remaining).toBe(0);
        return;
      }
      clock.advance(1_000 - (clock.now() % 1_000));
      const start = clock.now();
      const first = await store.hitRateLimit(key('rl:alpha'), 1_000, 2);
      expect(first.resetAt).toBe(start + 1_000);
      expect(first.allowed).toBe(true);
      expect(await store.hitRateLimit(key('rl:alpha'), 1_000, 2)).toMatchObject({
        allowed: true,
        count: 2,
        remaining: 0,
      });
      const denied = await store.hitRateLimit(key('rl:alpha'), 1_000, 2);
      expect(denied.allowed).toBe(false);
      expect(denied.count).toBe(3);
      clock.advance(1_000);
      const nextWindow = await store.hitRateLimit(key('rl:alpha'), 1_000, 2);
      expect(nextWindow.allowed).toBe(true);
      expect(nextWindow.count).toBe(1);
      expect(nextWindow.resetAt).toBe(start + 2_000);
    });

    it('rate-limit hits validate window and limit (typed errors)', async () => {
      await expectErrorCode(store.hitRateLimit(key('rl:alpha'), 0, 2), 'PERSISTENCE_INVALID_WINDOW');
      await expectErrorCode(store.hitRateLimit(key('rl:alpha'), 1_000, 0), 'PERSISTENCE_INVALID_LIMIT');
      await expectErrorCode(
        store.hitRateLimit(key('bad key!'), 1_000, 2),
        'PERSISTENCE_INVALID_COORDINATION_KEY',
      );
    });

    it('separates counters per key', async () => {
      await store.hitRateLimit(key('rl:alpha'), 60_000, 1);
      const denied = await store.hitRateLimit(key('rl:alpha'), 60_000, 1);
      expect(denied.allowed).toBe(false);
      const other = await store.hitRateLimit(key('rl:beta'), 60_000, 1);
      expect(other.allowed).toBe(true);
    });

    // -- Leases ----------------------------------------------------------------

    it('acquires, blocks, renews and releases leases with holder identity', async () => {
      expect(await store.acquireLease(key('lease:alpha'), 'holder-1', 60_000)).toBe(true);
      expect(await store.acquireLease(key('lease:alpha'), 'holder-2', 60_000)).toBe(false);
      expect(await store.leaseHolder(key('lease:alpha'))).toBe('holder-1');
      // Same-holder re-acquire extends the lease.
      expect(await store.acquireLease(key('lease:alpha'), 'holder-1', 60_000)).toBe(true);
      expect(await store.renewLease(key('lease:alpha'), 'holder-1', 60_000)).toBe(true);
      expect(await store.renewLease(key('lease:alpha'), 'holder-2', 60_000)).toBe(false);
      expect(await store.releaseLease(key('lease:alpha'), 'holder-2')).toBe(false);
      expect(await store.releaseLease(key('lease:alpha'), 'holder-1')).toBe(true);
      expect(await store.leaseHolder(key('lease:alpha'))).toBeNull();
      expect(await store.acquireLease(key('lease:alpha'), 'holder-2', 60_000)).toBe(true);
    });

    it('leases expire at their TTL and become re-acquirable', async () => {
      if (clock === undefined) {
        await store.acquireLease(key('lease:alpha'), 'holder-1', 20);
        await delay(60);
        expect(await store.leaseHolder(key('lease:alpha'))).toBeNull();
        expect(await store.acquireLease(key('lease:alpha'), 'holder-2', 20)).toBe(true);
        return;
      }
      expect(await store.acquireLease(key('lease:alpha'), 'holder-1', 1_000)).toBe(true);
      clock.advance(999);
      expect(await store.leaseHolder(key('lease:alpha'))).toBe('holder-1');
      clock.advance(1);
      expect(await store.leaseHolder(key('lease:alpha'))).toBeNull();
      expect(await store.acquireLease(key('lease:alpha'), 'holder-2', 1_000)).toBe(true);
      // The expired holder can no longer renew.
      expect(await store.renewLease(key('lease:alpha'), 'holder-1', 1_000)).toBe(false);
    });

    it('lease operations validate holder and TTL (typed errors)', async () => {
      await expectErrorCode(
        store.acquireLease(key('lease:alpha'), 'bad holder!', 1_000),
        'PERSISTENCE_INVALID_HOLDER',
      );
      await expectErrorCode(
        store.acquireLease(key('lease:alpha'), 'holder-1', 0),
        'PERSISTENCE_INVALID_TTL',
      );
    });
  });
}

// ---------------------------------------------------------------------------
// MigrationRunner contract
// ---------------------------------------------------------------------------

function migrationRunnerContract(factory: PersistenceContractFixtureFactory): void {
  describe('MigrationRunner port contract', () => {
    let runner: MigrationRunner;

    beforeEach(async () => {
      const fixture = await factory();
      if (fixture.migrationRunner === undefined) {
        throw new Error('fixture factory must provide migrationRunner for this suite');
      }
      runner = fixture.migrationRunner;
    });

    function makeMigrations(versions: readonly number[], log: number[]): Migration[] {
      return versions.map((version) => ({
        version,
        name: `migration-${String(version).padStart(4, '0')}`,
        apply: async () => {
          log.push(version);
        },
      }));
    }

    it('applies migrations in ascending version order and records the ledger', async () => {
      const log: number[] = [];
      const result = await runner.run(makeMigrations([2, 1, 3], log));
      expect(log).toEqual([1, 2, 3]);
      expect(result.applied.map((entry) => entry.version)).toEqual([1, 2, 3]);
      expect(result.skipped).toEqual([]);
      expect(result.fromVersion).toBeNull();
      expect(result.toVersion).toBe(3);
      expect(await runner.appliedMigrations()).toHaveLength(3);
    });

    it('re-running is idempotent (no re-apply, everything skipped)', async () => {
      const log: number[] = [];
      await runner.run(makeMigrations([1, 2], log));
      const second = await runner.run(makeMigrations([1, 2], log));
      expect(second.applied).toEqual([]);
      expect(second.skipped.map((entry) => entry.version)).toEqual([1, 2]);
      expect(log).toEqual([1, 2]);
      expect(second.fromVersion).toBe(2);
      expect(second.toVersion).toBe(2);
    });

    it('applies only the missing tail on a partial ledger', async () => {
      const log: number[] = [];
      await runner.run(makeMigrations([1], log));
      const second = await runner.run(makeMigrations([1, 2, 3], log));
      expect(log).toEqual([1, 2, 3]);
      expect(second.applied.map((entry) => entry.version)).toEqual([2, 3]);
      expect(second.skipped.map((entry) => entry.version)).toEqual([1]);
    });

    it('rejects duplicate versions before applying anything', async () => {
      const log: number[] = [];
      await expectErrorCode(
        runner.run(makeMigrations([1, 1], log)),
        'PERSISTENCE_INVALID_MIGRATION',
      );
      expect(log).toEqual([]);
    });

    it('rejects non-positive versions and malformed names', async () => {
      await expectErrorCode(runner.run(makeMigrations([0], [])), 'PERSISTENCE_INVALID_MIGRATION');
      await expectErrorCode(
        runner.run([{ version: 1, name: 'Bad Name', apply: async () => undefined }]),
        'PERSISTENCE_INVALID_MIGRATION',
      );
    });

    it('a failing migration throws the typed error and is NOT recorded', async () => {
      const log: number[] = [];
      await runner.run(makeMigrations([1], log));
      const failing: Migration = {
        version: 2,
        name: 'migration-0002',
        apply: async () => {
          throw new Error('boom');
        },
      };
      await expectErrorCode(runner.run([failing]), 'PERSISTENCE_MIGRATION_FAILED');
      const ledger = await runner.appliedMigrations();
      expect(ledger.map((entry) => entry.version)).toEqual([1]);
    });

    it('appliedMigrations is ordered ascending', async () => {
      const log: number[] = [];
      await runner.run(makeMigrations([3, 1, 2], log));
      const ledger = await runner.appliedMigrations();
      expect(ledger.map((entry) => entry.version)).toEqual([1, 2, 3]);
      for (const entry of ledger) {
        expect(typeof entry.appliedAt).toBe('number');
        expect(entry.appliedAt).toBeGreaterThanOrEqual(0);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// CapacityMeter contract
// ---------------------------------------------------------------------------

function capacityMeterContract(factory: PersistenceContractFixtureFactory): void {
  describe('CapacityMeter port contract', () => {
    let meter: CapacityMeter;

    beforeEach(async () => {
      const fixture = await factory();
      if (fixture.capacityMeter === undefined) {
        throw new Error('fixture factory must provide capacityMeter for this suite');
      }
      meter = fixture.capacityMeter;
    });

    it('probes a structurally valid, frozen capacity snapshot', async () => {
      const snapshot: CapacitySnapshot = await meter.probe();
      expect(isProviderCapacityStatus(snapshot.status)).toBe(true);
      expect(typeof snapshot.checkedAt).toBe('number');
      expect(snapshot.checkedAt).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(snapshot.dimensions)).toBe(true);
      expect(Array.isArray(snapshot.reasons)).toBe(true);
      expect(Object.isFrozen(snapshot)).toBe(true);
      for (const dimension of snapshot.dimensions) {
        // Re-validating each reading through the shared fail-closed parser.
        expect(() => toCapacityDimensionReading(dimension)).not.toThrow();
      }
    });

    it('probes consistently (same status and dimensions across calls)', async () => {
      const first = await meter.probe();
      const second = await meter.probe();
      expect(second.status).toBe(first.status);
      expect(second.dimensions).toEqual(first.dimensions);
      expect(second.checkedAt).toBeGreaterThanOrEqual(first.checkedAt);
    });
  });
}
