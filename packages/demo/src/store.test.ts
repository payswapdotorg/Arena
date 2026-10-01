import { describe, expect, it } from 'vitest';

import { FakeControlPlaneRepository, ManualClock } from '@arena/persistence';
import {
  READ_MODEL_ERROR_CODES,
  ReadModelError,
  toCanonicalRead,
  type CanonicalRead,
  type CanonicalReadModel,
  type KindInventory,
  type ReadPage,
  type TenantListingPage,
} from '@arena/read-model';

import {
  DEMO_ERROR_CODES,
  DEMO_NARRATIVE_EPOCH_MS,
  DEMO_TENANT_ID,
  DemoError,
  assertDemoTenantScope,
  computeDemoCorpusHash,
  createDemoReadSession,
  createDemoStore,
  createInMemoryDemoStore,
  describeDemoRecord,
} from './index.js';

/**
 * A test-local CanonicalReadModel over the B002 fake, built with the
 * REAL @arena/read-model projections (toCanonicalRead) — the same port
 * contract services/read-model implements. The service-level integration
 * (demo reads through the B005 ReadModelService) is covered by the web
 * layer tests in apps/web/src/demo.
 */
class TestCanonicalReadModel implements CanonicalReadModel {
  constructor(private readonly repository: FakeControlPlaneRepository) {}

  async readCanonical(tenantId: string, recordId: string): Promise<CanonicalRead> {
    const record = await this.repository.get(recordId);
    if (record === null) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND, {
        message: `no control-plane record ${JSON.stringify(recordId)} exists`,
        details: { recordId },
      });
    }
    if (record.tenantId !== tenantId) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
        message: `record ${JSON.stringify(recordId)} exists but belongs to tenant ${JSON.stringify(record.tenantId)}`,
        details: { recordId, recordTenant: record.tenantId, authenticatedTenant: tenantId },
      });
    }
    return toCanonicalRead(record, DEMO_NARRATIVE_EPOCH_MS);
  }

  async scrollByKind(
    tenantId: string,
    recordKind: Parameters<CanonicalReadModel['scrollByKind']>[1],
  ): Promise<ReadPage> {
    const rows = (await this.repository.list({ tenantId, kind: recordKind })).map((record) =>
      toCanonicalRead(record, DEMO_NARRATIVE_EPOCH_MS),
    );
    return {
      recordVersion: 1,
      kind: 'by-kind',
      recordKind,
      records: rows,
      readAt: DEMO_NARRATIVE_EPOCH_MS,
    };
  }

  async listByTenant(): Promise<TenantListingPage> {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
      message: 'not needed by the demo test model',
    });
  }

  async listKinds(tenantId: string): Promise<KindInventory> {
    const kinds = new Map<string, number>();
    for (const record of await this.repository.list({ tenantId })) {
      kinds.set(record.kind, (kinds.get(record.kind) ?? 0) + 1);
    }
    return {
      recordVersion: 1,
      kinds: [...kinds.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([kind, count]) => ({ kind: kind as KindInventory['kinds'][number]['kind'], count })),
    };
  }
}

/** Compose the local test stack: fake repo + fixed clock + canonical read model. */
function compose() {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const repository = new FakeControlPlaneRepository({ clock });
  const readModel = new TestCanonicalReadModel(repository);
  return { clock, repository, readModel };
}

describe('demo lifecycle (B006: seed is idempotent, reset is deterministic)', () => {
  it('seed() inserts the corpus and reports the corpus hash', async () => {
    const store = createInMemoryDemoStore();
    const report = await store.seed();
    expect(report.corpusHash).toBe(computeDemoCorpusHash());
    expect(report.seeded.length).toBe(5);
    expect(report.created.length).toBe(5);
    expect(await store.isSeeded()).toBe(true);
  });

  it('re-running seed() is idempotent: nothing new created, identical corpus', async () => {
    const store = createInMemoryDemoStore();
    const first = await store.seed();
    const second = await store.seed();
    expect(second.created).toEqual([]);
    expect(second.corpusHash).toBe(first.corpusHash);
    expect(await store.isSeeded()).toBe(true);
  });

  it('reset() drops and reseeds to the IDENTICAL corpus hash', async () => {
    const store = createInMemoryDemoStore();
    await store.seed();
    // Mutate the seeded state so reset has something to drop.
    await store.repository.delete('demo.capability-case.payments-reliability');
    expect(await store.isSeeded()).toBe(false);
    const report = await store.reset();
    expect(report.corpusHash).toBe(computeDemoCorpusHash());
    expect(report.created.length).toBe(5);
    expect(await store.isSeeded()).toBe(true);
    const read = await store.repository.get('demo.capability-case.payments-reliability');
    expect(read?.revision).toBe(1);
    expect(read?.createdAt).toBe(DEMO_NARRATIVE_EPOCH_MS);
  });

  it('the in-memory fake is fully provider-free and deterministic across instances', async () => {
    const left = createInMemoryDemoStore();
    const right = createInMemoryDemoStore();
    await left.seed();
    await right.seed();
    const leftRecords = await left.repository.list({ tenantId: DEMO_TENANT_ID });
    const rightRecords = await right.repository.list({ tenantId: DEMO_TENANT_ID });
    expect(JSON.stringify(leftRecords)).toBe(JSON.stringify(rightRecords));
  });

  it('createDemoStore fails closed without a repository', () => {
    expect(() => createDemoStore({ repository: undefined as never })).toThrow(DemoError);
  });
});

describe('demo scope guard (B006: DEMO_SCOPE_VIOLATION outside the demo tenant surface)', () => {
  it('accepts the demo tenant', () => {
    expect(() => assertDemoTenantScope(DEMO_TENANT_ID)).not.toThrow();
  });

  it('rejects any other tenant with the typed error', () => {
    for (const tenant of ['arena-reference', 'acme', '']) {
      expect(() => assertDemoTenantScope(tenant)).toThrow(DemoError);
      try {
        assertDemoTenantScope(tenant);
      } catch (error) {
        expect((error as DemoError).code).toBe(DEMO_ERROR_CODES.SCOPE_VIOLATION);
        expect((error as DemoError).code).toBe('DEMO_SCOPE_VIOLATION');
      }
    }
  });
});

describe('demo reads (B006: THROUGH the B005 canonical read path)', () => {
  it('read() returns canonical reads projected by the canonical read model', async () => {
    const { repository, readModel } = compose();
    await createDemoStore({ repository }).seed();
    const session = createDemoReadSession({ readModel });
    const read = await session.read('demo.agent-body.software-engineer');
    expect(read.recordId).toBe('demo.agent-body.software-engineer');
    expect(read.tenantId).toBe(DEMO_TENANT_ID);
    expect(read.kind).toBe('agent-body');
    expect(read.sourceRevision).toBe(1);
    expect(read.readAt).toBe(DEMO_NARRATIVE_EPOCH_MS);
  });

  it('scroll() pages the demo tenant through the canonical kind scroll', async () => {
    const { repository, readModel } = compose();
    await createDemoStore({ repository }).seed();
    const session = createDemoReadSession({ readModel });
    const page = await session.scroll('agent-body');
    expect(page.kind).toBe('by-kind');
    expect(page.records.map((record) => record.recordId)).toEqual([
      'demo.agent-body.software-engineer',
      'demo.agent-body.structural-engineer',
    ]);
  });

  it('inventory() discloses the demo kind inventory through the canonical path', async () => {
    const { repository, readModel } = compose();
    await createDemoStore({ repository }).seed();
    const inventory = await createDemoReadSession({ readModel }).inventory();
    expect(inventory.kinds).toEqual([
      { kind: 'agent-body', count: 2 },
      { kind: 'capability-case', count: 1 },
      { kind: 'certification', count: 1 },
      { kind: 'expert-qualification', count: 1 },
    ]);
  });

  it('a missing record surfaces the canonical typed NOT_FOUND error (no parallel API)', async () => {
    const { repository, readModel } = compose();
    await createDemoStore({ repository }).seed();
    const session = createDemoReadSession({ readModel });
    await expect(session.read('demo.agent-body.nope')).rejects.toMatchObject({
      code: READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND,
    });
  });

  it('demo corpus records are tenant-scoped: another tenant gets the canonical scope error', async () => {
    const { repository, readModel } = compose();
    await createDemoStore({ repository }).seed();
    await expect(
      readModel.readCanonical('some-other-tenant', 'demo.agent-body.software-engineer'),
    ).rejects.toMatchObject({ code: READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION });
  });

  it('createDemoReadSession fails closed without a canonical read model', () => {
    expect(() => createDemoReadSession({ readModel: undefined as never })).toThrow(DemoError);
  });
});

describe('demo record summaries (every demo-rendered datum displays its label)', () => {
  it('projects every corpus record with a valid product-truth label and non-empty title', async () => {
    const { repository, readModel } = compose();
    await createDemoStore({ repository }).seed();
    const session = createDemoReadSession({ readModel });
    for (const recordId of [
      'demo.agent-body.software-engineer',
      'demo.agent-body.structural-engineer',
      'demo.capability-case.payments-reliability',
      'demo.certification.software-engineer-v1-1-0',
      'demo.expert-qualification.structural-review',
    ]) {
      const summary = describeDemoRecord(await session.read(recordId));
      expect(summary.title.length).toBeGreaterThan(0);
      expect(summary.summary.length).toBeGreaterThan(0);
      expect(summary.facts.length).toBeGreaterThan(0);
      expect(
        [
          'verified-fact',
          'evidence',
          'expert-judgment',
          'model-output',
          'simulation-replay',
          'evaluation-result',
          'certification',
          'suggestion',
        ].includes(summary.truth),
      ).toBe(true);
    }
  });

  it('fails closed on records outside the demo corpus vocabulary', async () => {
    const { repository, readModel } = compose();
    await createDemoStore({ repository }).seed();
    const session = createDemoReadSession({ readModel });
    // Seed a non-demo record into the same tenant to prove the guard.
    await repository.insert({
      recordId: 'demo.agent-body.unknown-body',
      tenantId: DEMO_TENANT_ID,
      kind: 'agent-body',
      version: 1,
      data: { displayName: 'Unknown' },
    });
    const read = await session.read('demo.agent-body.unknown-body');
    expect(() => describeDemoRecord(read)).toThrow(DemoError);
  });
});
