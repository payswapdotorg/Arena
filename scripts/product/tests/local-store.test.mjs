/**
 * Deterministic tests for the file-backed local fake persistence store
 * (Work Order B016): B002 ControlPlaneRepository port semantics
 * (idempotent insert, typed conflicts, optimistic update, deterministic
 * listing), atomic + deterministic persistence, and cross-instance
 * durability. Drives the REAL @arena/persistence validators and error
 * taxonomy through the same shim the commands use.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadArenaModules } from '../lib/workspace.mjs';
import {
  openFileBackedControlPlaneRepository,
  parseStoreFile,
  readStoreSnapshot,
  serializeStore,
  STORE_FORMAT_VERSION,
} from '../lib/local-store.mjs';

const { persistence } = await loadArenaModules();

const FIXED_CLOCK = { now: () => 177_000_000_000 };

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'arena-store-'));
}

async function openRepo(storePath) {
  return openFileBackedControlPlaneRepository({ persistence, storePath, clock: FIXED_CLOCK });
}

const SAMPLE_INPUT = {
  recordId: 'demo.agent-body.software-engineer',
  tenantId: 'arena-demo',
  kind: 'agent-body',
  version: 1,
  data: { displayName: 'Software Engineer (reference body)', nested: { list: [1, 2, 3] } },
};

test('parseStoreFile rejects malformed stores with precise reasons', () => {
  assert.equal(parseStoreFile('{nope').ok, false);
  assert.match(parseStoreFile('{nope').reason, /not valid JSON/);
  assert.equal(parseStoreFile('[]').ok, false);
  assert.equal(parseStoreFile('{"formatVersion":99,"records":[]}').ok, false);
  assert.match(parseStoreFile('{"formatVersion":99,"records":[]}').reason, /unsupported store formatVersion/);
  assert.equal(parseStoreFile('{"formatVersion":1,"records":{}}').ok, false);
  const dup = JSON.stringify({
    formatVersion: STORE_FORMAT_VERSION,
    records: [{ recordId: 'a', tenantId: 'arena-demo', kind: 'agent-body', version: 1, revision: 1, data: {}, createdAt: 1, updatedAt: 1 }, { recordId: 'a', tenantId: 'arena-demo', kind: 'agent-body', version: 1, revision: 1, data: {}, createdAt: 1, updatedAt: 1 }],
  });
  assert.equal(parseStoreFile(dup).ok, false);
  assert.match(parseStoreFile(dup).reason, /duplicate recordId/);
});

test('serializeStore is deterministic: sorted ids, fixed shape, trailing newline', () => {
  const records = new Map([
    ['b', { recordId: 'b', tenantId: 'arena-demo', kind: 'agent-body', version: 1, revision: 1, data: {}, createdAt: 1, updatedAt: 1 }],
    ['a', { recordId: 'a', tenantId: 'arena-demo', kind: 'agent-body', version: 1, revision: 1, data: {}, createdAt: 1, updatedAt: 1 }],
  ]);
  const text = serializeStore(records);
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.records.map((r) => r.recordId), ['a', 'b']);
  assert.ok(text.endsWith('\n'));
  assert.equal(serializeStore(new Map(records)), text, 'same records → identical bytes');
});

test('insert is idempotent: identical replay returns created:false and does not rewrite the file', async () => {
  const dir = makeTempDir();
  try {
    const storePath = join(dir, 'store', 'control-plane.json');
    const first = await openRepo(storePath);
    const inserted = await first.repository.insert(SAMPLE_INPUT);
    assert.equal(inserted.created, true);
    assert.equal(inserted.record.revision, 1);
    assert.equal(inserted.record.createdAt, FIXED_CLOCK.now());

    const bytesAfterFirst = readFileSync(storePath, 'utf-8');
    const replayed = await first.repository.insert(SAMPLE_INPUT);
    assert.equal(replayed.created, false);
    assert.equal(replayed.record.recordId, SAMPLE_INPUT.recordId);
    assert.equal(readFileSync(storePath, 'utf-8'), bytesAfterFirst, 'no-op replay leaves the file untouched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('insert with conflicting content throws the typed RECORD_EXISTS error', async () => {
  const dir = makeTempDir();
  try {
    const { repository } = await openRepo(join(dir, 'store', 'control-plane.json'));
    await repository.insert(SAMPLE_INPUT);
    await assert.rejects(
      repository.insert({ ...SAMPLE_INPUT, data: { displayName: 'tampered' } }),
      (error) => persistence.isPersistenceError(error) && error.code === 'PERSISTENCE_RECORD_EXISTS',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid inputs throw the typed port validation errors', async () => {
  const dir = makeTempDir();
  try {
    const { repository } = await openRepo(join(dir, 'store', 'control-plane.json'));
    await assert.rejects(
      repository.insert({ ...SAMPLE_INPUT, recordId: 'bad id!' }),
      (error) => persistence.isPersistenceError(error) && error.code === 'PERSISTENCE_INVALID_RECORD_ID',
    );
    await assert.rejects(
      repository.insert({ ...SAMPLE_INPUT, tenantId: 'Bad_Tenant' }),
      (error) => persistence.isPersistenceError(error) && error.code === 'PERSISTENCE_INVALID_TENANT_ID',
    );
    await assert.rejects(
      repository.insert({ ...SAMPLE_INPUT, kind: 'BadKind' }),
      (error) => persistence.isPersistenceError(error) && error.code === 'PERSISTENCE_INVALID_RECORD_KIND',
    );
    await assert.rejects(
      repository.insert({ ...SAMPLE_INPUT, version: 0 }),
      (error) => persistence.isPersistenceError(error) && error.code === 'PERSISTENCE_INVALID_RECORD_VERSION',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update honours optimistic concurrency; get/delete round-trip', async () => {
  const dir = makeTempDir();
  try {
    const { repository } = await openRepo(join(dir, 'store', 'control-plane.json'));
    await repository.insert(SAMPLE_INPUT);

    await assert.rejects(
      repository.update(SAMPLE_INPUT.recordId, { expectedRevision: 2, data: {} }),
      (error) => persistence.isPersistenceError(error) && error.code === 'PERSISTENCE_REVISION_CONFLICT',
    );
    const updated = await repository.update(SAMPLE_INPUT.recordId, { expectedRevision: 1, data: { replaced: true } });
    assert.equal(updated.revision, 2);
    assert.deepEqual(updated.data, { replaced: true });

    assert.notEqual(await repository.get(SAMPLE_INPUT.recordId), null);
    assert.equal(await repository.get(SAMPLE_INPUT.recordId), (await repository.get(SAMPLE_INPUT.recordId)));
    assert.equal(await repository.get('demo.missing.record'), null);

    assert.equal(await repository.delete(SAMPLE_INPUT.recordId), true);
    assert.equal(await repository.delete(SAMPLE_INPUT.recordId), false);
    assert.equal(await repository.get(SAMPLE_INPUT.recordId), null);
    await assert.rejects(
      repository.update(SAMPLE_INPUT.recordId, { expectedRevision: 1, data: {} }),
      (error) => persistence.isPersistenceError(error) && error.code === 'PERSISTENCE_RECORD_NOT_FOUND',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list is deterministic (recordId ascending) with kind/tenant filters and pagination', async () => {
  const dir = makeTempDir();
  try {
    const { repository } = await openRepo(join(dir, 'store', 'control-plane.json'));
    await repository.insert(SAMPLE_INPUT);
    await repository.insert({ ...SAMPLE_INPUT, recordId: 'demo.agent-body.structural-engineer' });
    await repository.insert({ ...SAMPLE_INPUT, recordId: 'demo.capability-case.payments-reliability', kind: 'capability-case' });
    await repository.insert({ ...SAMPLE_INPUT, recordId: 'other.tenant.record', tenantId: 'other-tenant' });

    const all = await repository.list({});
    assert.deepEqual(all.map((r) => r.recordId), [
      'demo.agent-body.software-engineer',
      'demo.agent-body.structural-engineer',
      'demo.capability-case.payments-reliability',
      'other.tenant.record',
    ]);

    const agentBodies = await repository.list({ kind: 'agent-body' });
    assert.equal(agentBodies.length, 3, 'other.tenant.record also carries kind agent-body');
    const demoTenant = await repository.list({ tenantId: 'arena-demo' });
    assert.equal(demoTenant.length, 3);
    const demoAgentBodies = await repository.list({ kind: 'agent-body', tenantId: 'arena-demo' });
    assert.equal(demoAgentBodies.length, 2);
    const page = await repository.list({ limit: 2, offset: 1 });
    assert.deepEqual(page.map((r) => r.recordId), ['demo.agent-body.structural-engineer', 'demo.capability-case.payments-reliability']);

    assert.equal(await repository.count({ tenantId: 'arena-demo' }), 3);
    assert.equal(await repository.count({}), 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records persist across instances (the store survives the process)', async () => {
  const dir = makeTempDir();
  try {
    const storePath = join(dir, 'store', 'control-plane.json');
    const first = await openRepo(storePath);
    await first.repository.insert(SAMPLE_INPUT);

    const second = await openRepo(storePath);
    assert.equal(second.recordCount, 1);
    const record = await second.repository.get(SAMPLE_INPUT.recordId);
    assert.notEqual(record, null);
    assert.equal(record.tenantId, 'arena-demo');

    const bytesAfterReopen = readFileSync(storePath, 'utf-8');
    await second.repository.insert(SAMPLE_INPUT); // idempotent replay across instances
    assert.equal(readFileSync(storePath, 'utf-8'), bytesAfterReopen);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('determinism: the same inserts in two fresh stores produce identical file bytes', async () => {
  const dirA = makeTempDir();
  const dirB = makeTempDir();
  try {
    const inputs = [
      SAMPLE_INPUT,
      { ...SAMPLE_INPUT, recordId: 'demo.agent-body.structural-engineer' },
      { ...SAMPLE_INPUT, recordId: 'demo.capability-case.payments-reliability', kind: 'capability-case' },
    ];
    for (const dir of [dirA, dirB]) {
      const { repository } = await openRepo(join(dir, 'store', 'control-plane.json'));
      for (const input of [...inputs].reverse()) {
        await repository.insert(input);
      }
    }
    const bytesA = readFileSync(join(dirA, 'store', 'control-plane.json'), 'utf-8');
    const bytesB = readFileSync(join(dirB, 'store', 'control-plane.json'), 'utf-8');
    assert.equal(bytesA, bytesB);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test('openFileBackedControlPlaneRepository fails actionable on a corrupt existing store', async () => {
  const dir = makeTempDir();
  try {
    const storePath = join(dir, 'store', 'control-plane.json');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(dir, 'store'), { recursive: true });
    writeFileSync(storePath, 'definitely not json');
    await assert.rejects(openRepo(storePath), (error) => {
      assert.match(error.message, /corrupt/);
      assert.match(error.message, /reset\.mjs --yes/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readStoreSnapshot reports absent / corrupt / ok with tenant counts', async () => {
  const dir = makeTempDir();
  try {
    const storePath = join(dir, 'store', 'control-plane.json');
    assert.equal(readStoreSnapshot(storePath).status, 'absent');

    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(dir, 'store'), { recursive: true });
    writeFileSync(storePath, 'nope');
    assert.equal(readStoreSnapshot(storePath).status, 'corrupt');

    // a corrupt file also fails the open path actionable — then replace it
    await assert.rejects(openRepo(storePath), (error) => /corrupt/.test(error.message));
    rmSync(storePath);

    const { repository } = await openRepo(storePath);
    await repository.insert(SAMPLE_INPUT);
    await repository.insert({ ...SAMPLE_INPUT, recordId: 'other.tenant.record', tenantId: 'other-tenant' });
    const snapshot = readStoreSnapshot(storePath);
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.recordCount, 2);
    assert.deepEqual(snapshot.tenantCounts, { 'arena-demo': 1, 'other-tenant': 1 });
    assert.deepEqual(snapshot.recordIds, ['demo.agent-body.software-engineer', 'other.tenant.record']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
