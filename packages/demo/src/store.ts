/**
 * The demo lifecycle port + in-memory fake (Work Order B006; issue #73).
 *
 * `DemoStore` is the lifecycle port: `seed()` (idempotent — re-running
 * produces the identical corpus), `reset()` (drops and reseeds —
 * deterministic reset), `isSeeded()`. It is defined over the B002
 * `ControlPlaneRepository` port so the SAME implementation runs over the
 * in-memory fake now (full local parity, zero providers) and over a
 * hosted adapter later (B015 wiring) — only the repository injection
 * changes.
 *
 * `DemoReadSession` is the demo READ surface: every read goes THROUGH a
 * B005 `CanonicalReadModel` (never a parallel demo-only API), always
 * scoped to the reserved demo tenant, and any demo-state request from
 * OUTSIDE the demo tenant surface fails with the typed
 * DEMO_SCOPE_VIOLATION error.
 */

import type { CanonicalReadModel, CanonicalRead, KindInventory, ReadPage } from '@arena/read-model';
import type { ReadModelKind } from '@arena/read-model';
import { FakeControlPlaneRepository } from '@arena/persistence';
import type { Clock, ControlPlaneRepository } from '@arena/persistence';
import { ManualClock } from '@arena/persistence';

import { buildDemoCorpus, computeDemoCorpusHash, DEMO_CORPUS_VERSION } from './corpus.js';
import { DEMO_ERROR_CODES, DemoError } from './errors.js';
import { DEMO_NARRATIVE_EPOCH_MS, DEMO_TENANT_ID, isDemoTenant } from './shared.js';

/** Wire version of the demo lifecycle contract records. */
export const DEMO_STORE_RECORD_VERSION = DEMO_CORPUS_VERSION;

/** The report a seed()/reset() call returns (deterministic by construction). */
export interface DemoSeedReport {
  readonly recordVersion: typeof DEMO_STORE_RECORD_VERSION;
  /** Corpus record ids in canonical order. */
  readonly seeded: readonly string[];
  /** The corpus hash (identical across seeds/resets — the testable invariant). */
  readonly corpusHash: string;
  /** ids THIS call actually created (empty on idempotent re-seed). */
  readonly created: readonly string[];
}

/** The demo lifecycle port (fake now; ControlPlaneRepository-backed wiring later). */
export interface DemoStore {
  /** The control-plane repository the demo corpus is seeded into. */
  readonly repository: ControlPlaneRepository;
  /** Idempotently insert the demo corpus (re-running → identical corpus). */
  seed(): Promise<DemoSeedReport>;
  /** Drop the demo corpus and reseed (deterministic reset). */
  reset(): Promise<DemoSeedReport>;
  /** True iff every corpus record is currently present. */
  isSeeded(): Promise<boolean>;
}

export interface DemoStoreDeps {
  /** The B002 repository port to seed into (fake or hosted adapter). */
  readonly repository: ControlPlaneRepository;
}

function isRecordIdSet(repo: ControlPlaneRepository): Promise<Set<string>> {
  return (async () => {
    const present = new Set<string>();
    for (const item of buildDemoCorpus()) {
      const found = await repo.get(item.recordId);
      if (found !== null) present.add(found.recordId);
    }
    return present;
  })();
}

/**
 * Construct a DemoStore over an injected ControlPlaneRepository. The
 * store only ever inserts/deletes the demo corpus's own record ids under
 * the reserved demo tenant.
 */
export function createDemoStore(deps: DemoStoreDeps): DemoStore {
  if (typeof deps.repository?.insert !== 'function' || typeof deps.repository?.delete !== 'function') {
    throw new DemoError(DEMO_ERROR_CODES.INVALID_INPUT, {
      message: 'createDemoStore requires an injected ControlPlaneRepository (insert + delete)',
    });
  }
  const repository = deps.repository;
  return {
    repository,
    async seed(): Promise<DemoSeedReport> {
      const corpus = buildDemoCorpus();
      const created: string[] = [];
      for (const item of corpus) {
        const result = await repository.insert({
          recordId: item.recordId,
          tenantId: item.tenantId,
          kind: item.kind,
          version: item.version,
          data: item.data,
        });
        if (result.created) created.push(item.recordId);
      }
      return Object.freeze({
        recordVersion: DEMO_STORE_RECORD_VERSION,
        seeded: corpus.map((item) => item.recordId),
        corpusHash: computeDemoCorpusHash(),
        created: Object.freeze([...created]),
      });
    },
    async reset(): Promise<DemoSeedReport> {
      const corpus = buildDemoCorpus();
      for (const item of corpus) {
        await repository.delete(item.recordId);
      }
      const created: string[] = [];
      for (const item of corpus) {
        const result = await repository.insert({
          recordId: item.recordId,
          tenantId: item.tenantId,
          kind: item.kind,
          version: item.version,
          data: item.data,
        });
        if (result.created) created.push(item.recordId);
      }
      return Object.freeze({
        recordVersion: DEMO_STORE_RECORD_VERSION,
        seeded: corpus.map((item) => item.recordId),
        corpusHash: computeDemoCorpusHash(),
        created: Object.freeze([...created]),
      });
    },
    async isSeeded(): Promise<boolean> {
      const present = await isRecordIdSet(repository);
      return buildDemoCorpus().every((item) => present.has(item.recordId));
    },
  };
}

/** Options for the in-memory demo composition (full local parity, zero providers). */
export interface InMemoryDemoStoreOptions {
  /** Overrides the fixed narrative clock (deterministic ManualClock default). */
  readonly clock?: Clock;
}

/**
 * The in-memory demo store fake: a FakeControlPlaneRepository stamped by
 * a ManualClock frozen at the narrative epoch — zero providers, zero
 * wall-clock, byte-identical records across every seed/reset.
 */
export function createInMemoryDemoStore(
  options: InMemoryDemoStoreOptions = {},
): DemoStore & { readonly clock: Clock } {
  const clock = options.clock ?? new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const repository = new FakeControlPlaneRepository({ clock });
  const store = createDemoStore({ repository });
  return Object.freeze({ ...store, clock });
}

// ---------------------------------------------------------------------------
// Demo reads: THROUGH the B005 canonical read path, demo-tenant-scoped
// ---------------------------------------------------------------------------

/**
 * Guard the demo tenant surface: demo state may only be requested as the
 * reserved demo tenant. Anything else fails with the typed
 * DEMO_SCOPE_VIOLATION (never a silent cross-tenant read).
 */
export function assertDemoTenantScope(tenantId: string): void {
  if (!isDemoTenant(tenantId)) {
    throw new DemoError(DEMO_ERROR_CODES.SCOPE_VIOLATION, {
      message: `demo state was requested outside the demo tenant surface: got ${JSON.stringify(String(tenantId))}, expected ${JSON.stringify(DEMO_TENANT_ID)}`,
      details: { requestedTenant: String(tenantId), demoTenant: DEMO_TENANT_ID },
    });
  }
}

/** The demo read surface: B005 canonical reads, scoped to the demo tenant. */
export interface DemoReadSession {
  /** One canonical read by record id (through the CanonicalReadModel). */
  read(recordId: string): Promise<CanonicalRead>;
  /** One bounded kind scroll (through the CanonicalReadModel). */
  scroll(kind: ReadModelKind): Promise<ReadPage>;
  /** The disclosed kind inventory for the demo tenant. */
  inventory(): Promise<KindInventory>;
}

export interface DemoReadSessionDeps {
  /** The B005 canonical read model — demo reads NEVER bypass it. */
  readonly readModel: CanonicalReadModel;
}

/** Compose the demo read session over a B005 canonical read model. */
export function createDemoReadSession(deps: DemoReadSessionDeps): DemoReadSession {
  if (typeof deps.readModel?.readCanonical !== 'function') {
    throw new DemoError(DEMO_ERROR_CODES.INVALID_INPUT, {
      message: 'createDemoReadSession requires an injected CanonicalReadModel (the B005 canonical read path)',
    });
  }
  const readModel = deps.readModel;
  return {
    async read(recordId: string): Promise<CanonicalRead> {
      assertDemoTenantScope(DEMO_TENANT_ID);
      return readModel.readCanonical(DEMO_TENANT_ID, recordId);
    },
    async scroll(kind: ReadModelKind): Promise<ReadPage> {
      assertDemoTenantScope(DEMO_TENANT_ID);
      return readModel.scrollByKind(DEMO_TENANT_ID, kind);
    },
    async inventory(): Promise<KindInventory> {
      assertDemoTenantScope(DEMO_TENANT_ID);
      return readModel.listKinds(DEMO_TENANT_ID);
    },
  };
}
