import { describe, expect, it } from 'vitest';
import { FakeControlPlaneRepository, ManualClock } from '@arena/persistence';
import type { ControlPlaneInsertInput } from '@arena/persistence';
import { READ_MODEL_ERROR_CODES, ReadModelError } from '@arena/read-model';
import { decodeContinuation } from '@arena/read-model';
import { ReadModelService } from './service.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

/** Seed records: tenant-a owns cap-1..cap-5 + one certification; tenant-b owns cap-101. */
async function seededRepository(): Promise<FakeControlPlaneRepository> {
  const repo = new FakeControlPlaneRepository();
  const inputs: ControlPlaneInsertInput[] = [];
  for (let i = 1; i <= 5; i += 1) {
    inputs.push({
      recordId: `cap-${i}`,
      tenantId: TENANT_A,
      kind: 'capability-case',
      version: 2,
      data: { title: `Case ${i}`, stage: i === 5 ? 'review' : 'draft' },
    });
  }
  inputs.push({
    recordId: 'cert-1',
    tenantId: TENANT_A,
    kind: 'certification',
    version: 1,
    data: { level: 'bronze' },
  });
  inputs.push({
    recordId: 'cap-101',
    tenantId: TENANT_B,
    kind: 'capability-case',
    version: 1,
    data: { title: 'Other tenant case' },
  });
  for (const input of inputs) {
    await repo.insert(input);
  }
  return repo;
}

async function makeService(): Promise<{
  service: ReadModelService;
  repo: FakeControlPlaneRepository;
  clock: ManualClock;
}> {
  const repo = await seededRepository();
  const clock = new ManualClock(1_000_000);
  return { service: new ReadModelService({ repository: repo, clock }), repo, clock };
}

describe('ReadModelService construction', () => {
  it('requires injected repository and clock', () => {
    expect(() => new ReadModelService({ repository: null as never, clock: new ManualClock(0) }))
      .toThrowError(ReadModelError);
    expect(
      () =>
        new ReadModelService({
          repository: new FakeControlPlaneRepository(),
          clock: null as never,
        }),
    ).toThrowError(ReadModelError);
  });
});

describe('readCanonical', () => {
  it('returns a canonical read carrying as-stored version, revision and provenance', async () => {
    const { service } = await makeService();
    const read = await service.readCanonical(TENANT_A, 'cap-1');
    expect(read.recordId).toBe('cap-1');
    expect(read.tenantId).toBe(TENANT_A);
    expect(read.kind).toBe('capability-case');
    expect(read.sourceVersion).toBe(2);
    expect(read.sourceRevision).toBe(1);
    expect(read.provenance.createdAt).toBe(read.provenance.updatedAt);
    expect(read.readAt).toBe(1_000_000);
  });

  it('reflects optimistic-revision drift after an update (reload staleness contract)', async () => {
    const { service, repo } = await makeService();
    const before = await service.readCanonical(TENANT_A, 'cap-1');
    await repo.update('cap-1', { expectedRevision: 1, data: { title: 'Case 1 v2' } });
    const after = await service.readCanonical(TENANT_A, 'cap-1');
    expect(before.sourceRevision).toBe(1);
    expect(after.sourceRevision).toBe(2);
    expect(after.sourceVersion).toBe(before.sourceVersion);
  });

  it('throws typed RECORD_NOT_FOUND for absent records', async () => {
    const { service } = await makeService();
    await expect(service.readCanonical(TENANT_A, 'nope')).rejects.toMatchObject({
      code: READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND,
    });
  });

  it('throws typed TENANT_SCOPE_VIOLATION for cross-tenant reads (distinct from not-found)', async () => {
    const { service } = await makeService();
    let error: unknown;
    try {
      await service.readCanonical(TENANT_B, 'cap-1');
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ReadModelError);
    const typed = error as ReadModelError;
    expect(typed.code).toBe(READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION);
    expect(typed.details).toMatchObject({ recordTenant: TENANT_A, authenticatedTenant: TENANT_B });
    // Distinct outcome classes for the same tenant:
    await expect(service.readCanonical(TENANT_B, 'does-not-exist')).rejects.toMatchObject({
      code: READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND,
    });
  });

  it('rejects empty tenant/record ids (tenant comes from the authenticated context)', async () => {
    const { service } = await makeService();
    await expect(service.readCanonical('', 'cap-1')).rejects.toMatchObject({
      code: READ_MODEL_ERROR_CODES.INVALID_QUERY,
    });
    await expect(service.readCanonical(TENANT_A, '')).rejects.toMatchObject({
      code: READ_MODEL_ERROR_CODES.INVALID_QUERY,
    });
  });
});

describe('scrollByKind', () => {
  it('pages deterministically in (kind, recordId) order with opaque continuations', async () => {
    const { service } = await makeService();
    const page1 = await service.scrollByKind(TENANT_A, 'capability-case', undefined, 2);
    expect(page1.records.map((read) => read.recordId)).toEqual(['cap-1', 'cap-2']);
    expect(page1.continuation).toBeDefined();

    const page2 = await service.scrollByKind(TENANT_A, 'capability-case', page1.continuation, 2);
    expect(page2.records.map((read) => read.recordId)).toEqual(['cap-3', 'cap-4']);
    expect(page2.continuation).toBeDefined();

    const page3 = await service.scrollByKind(TENANT_A, 'capability-case', page2.continuation, 2);
    expect(page3.records.map((read) => read.recordId)).toEqual(['cap-5']);
    expect(page3.continuation).toBeUndefined();
  });

  it('is tenant-scoped: tenant-a scrolls never surface tenant-b records', async () => {
    const { service } = await makeService();
    const all = await service.scrollByKind(TENANT_A, 'capability-case', undefined, 100);
    expect(all.records.map((read) => read.recordId)).toEqual(['cap-1', 'cap-2', 'cap-3', 'cap-4', 'cap-5']);
    const tenantB = await service.scrollByKind(TENANT_B, 'capability-case', undefined, 100);
    expect(tenantB.records.map((read) => read.recordId)).toEqual(['cap-101']);
  });

  it('pagination is deterministic across reloads (same state → same pages)', async () => {
    const { service } = await makeService();
    const first = await service.scrollByKind(TENANT_A, 'capability-case', undefined, 3);
    const repeat = await service.scrollByKind(TENANT_A, 'capability-case', undefined, 3);
    expect(repeat.records).toEqual(first.records);
    expect(repeat.continuation).toBe(first.continuation);
    const decoded = decodeContinuation(first.continuation, 'by-kind', 'capability-case');
    expect(decoded.offset).toBe(3);
  });

  it('every page result carries source version + revision (staleness survives paging)', async () => {
    const { service } = await makeService();
    const page = await service.scrollByKind(TENANT_A, 'capability-case', undefined, 100);
    for (const read of page.records) {
      expect(read.sourceVersion).toBe(2);
      expect(read.sourceRevision).toBe(1);
      expect(read.readAt).toBe(1_000_000);
    }
  });

  it('rejects malformed and scope-mismatched continuation tokens', async () => {
    const { service } = await makeService();
    await expect(
      service.scrollByKind(TENANT_A, 'capability-case', 'garbage', 10),
    ).rejects.toMatchObject({ code: READ_MODEL_ERROR_CODES.INVALID_CONTINUATION });
    const certToken = (
      await service.scrollByKind(TENANT_A, 'certification', undefined, 10)
    ).continuation;
    expect(certToken).toBeUndefined();
    // A by-tenant token replayed against a by-kind scroll is rejected.
    const tenantToken = (await service.listByTenant(TENANT_A, undefined, 2)).continuation;
    await expect(
      service.scrollByKind(TENANT_A, 'capability-case', tenantToken, 10),
    ).rejects.toMatchObject({ code: READ_MODEL_ERROR_CODES.INVALID_CONTINUATION });
  });

  it('bounds page sizes through the query vocabulary', async () => {
    const { service } = await makeService();
    await expect(service.scrollByKind(TENANT_A, 'capability-case', undefined, 101)).rejects.toMatchObject({
      code: READ_MODEL_ERROR_CODES.INVALID_QUERY,
    });
    await expect(service.scrollByKind(TENANT_A, 'capability-case', undefined, 0)).rejects.toMatchObject({
      code: READ_MODEL_ERROR_CODES.INVALID_QUERY,
    });
  });
});

describe('listByTenant', () => {
  it('lists across kinds in recordId order with continuations', async () => {
    const { service } = await makeService();
    const page = await service.listByTenant(TENANT_A, undefined, 3);
    expect(page.records.map((read) => read.recordId)).toEqual(['cap-1', 'cap-2', 'cap-3']);
    const next = await service.listByTenant(TENANT_A, page.continuation, 3);
    expect(next.records.map((read) => read.recordId)).toEqual(['cap-4', 'cap-5', 'cert-1']);
    expect(next.continuation).toBeUndefined();
  });
});

describe('listKinds', () => {
  it('returns the disclosed inventory with counts (zero-count kinds omitted)', async () => {
    const { service } = await makeService();
    const inventory = await service.listKinds(TENANT_A);
    expect(inventory.kinds).toEqual([
      { kind: 'capability-case', count: 5 },
      { kind: 'certification', count: 1 },
    ]);
    const inventoryB = await service.listKinds(TENANT_B);
    expect(inventoryB.kinds).toEqual([{ kind: 'capability-case', count: 1 }]);
  });

  it('rejects an empty tenant id', async () => {
    const { service } = await makeService();
    await expect(service.listKinds('')).rejects.toMatchObject({
      code: READ_MODEL_ERROR_CODES.INVALID_QUERY,
    });
  });
});

describe('read-only posture (no second authority)', () => {
  it('mutations through the repository are visible on the NEXT read (no caching)', async () => {
    const { service, repo } = await makeService();
    const before = await service.readCanonical(TENANT_A, 'cap-2');
    await repo.update('cap-2', { expectedRevision: 1, data: { title: 'mutated' } });
    const after = await service.readCanonical(TENANT_A, 'cap-2');
    expect(before.data).toEqual({ title: 'Case 2', stage: 'draft' });
    expect(after.data).toEqual({ title: 'mutated' });
    expect(after.sourceRevision).toBe(2);
  });
});
