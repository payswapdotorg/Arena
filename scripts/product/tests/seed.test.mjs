/**
 * Deterministic tests for the seed workflow (Work Order B016): the B006
 * DemoStore seeds through the B002 port over the file-backed local fake,
 * is idempotent, prints exactly what was seeded + the demo tenant
 * identity, and produces byte-identical store files across fresh runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadArenaModules } from '../lib/workspace.mjs';
import { createMemoryStream } from '../lib/cli.mjs';
import { statePaths } from '../lib/local-state.mjs';
import { readStoreSnapshot } from '../lib/local-store.mjs';
import { runSeed } from '../lib/seed-logic.mjs';

const { demo, persistence } = await loadArenaModules();

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'arena-seed-'));
}

const DEMO_RECORD_IDS = [
  'demo.agent-body.software-engineer',
  'demo.agent-body.structural-engineer',
  'demo.capability-case.payments-reliability',
  'demo.certification.software-engineer-v1-1-0',
  'demo.expert-qualification.structural-review',
];

test('seed creates the full demo corpus under the reserved demo tenant and prints exactly what was seeded', async () => {
  const dir = makeTempDir();
  try {
    const out = createMemoryStream();
    const result = await runSeed({ demo, persistence, stateDir: dir, out });
    assert.equal(result.exitCode, 0);

    assert.equal(result.report.seeded.length, 5);
    assert.equal(result.report.created.length, 5);
    assert.equal(result.report.corpusHash, demo.computeDemoCorpusHash());

    const text = out.text;
    assert.match(text, /demo tenant: arena-demo \(reserved demo tenant/);
    assert.match(text, /Demo state is not customer state/);
    for (const recordId of DEMO_RECORD_IDS) {
      assert.match(text, new RegExp(recordId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(text, /created this run: 5 record\(s\)/);
    assert.match(text, /already present: 0 record\(s\)/);
    assert.match(text, /hash summary [0-9a-f]{8}/);

    const snapshot = readStoreSnapshot(statePaths(dir).storeFile);
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.recordCount, 5);
    assert.deepEqual(snapshot.tenantCounts, { 'arena-demo': 5 });
    assert.deepEqual(snapshot.recordIds, [...DEMO_RECORD_IDS].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seed is idempotent: re-running creates nothing new and leaves the file byte-identical', async () => {
  const dir = makeTempDir();
  try {
    const storePath = statePaths(dir).storeFile;
    await runSeed({ demo, persistence, stateDir: dir, out: createMemoryStream() });
    const bytesAfterFirst = readFileSync(storePath, 'utf-8');

    const out = createMemoryStream();
    const result = await runSeed({ demo, persistence, stateDir: dir, out });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.created.length, 0);
    assert.equal(result.report.seeded.length, 5);
    assert.match(out.text, /already present: 5 record\(s\)/);
    assert.equal(readFileSync(storePath, 'utf-8'), bytesAfterFirst);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seed determinism: two fresh state directories produce identical store files', async () => {
  const dirA = makeTempDir();
  const dirB = makeTempDir();
  try {
    await runSeed({ demo, persistence, stateDir: dirA, out: createMemoryStream() });
    await runSeed({ demo, persistence, stateDir: dirB, out: createMemoryStream() });
    const bytesA = readFileSync(statePaths(dirA).storeFile, 'utf-8');
    const bytesB = readFileSync(statePaths(dirB).storeFile, 'utf-8');
    assert.equal(bytesA, bytesB);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test('the seeded store satisfies the DemoStore isSeeded() port check', async () => {
  const dir = makeTempDir();
  try {
    await runSeed({ demo, persistence, stateDir: dir, out: createMemoryStream() });
    const { repository } = await (await import('../lib/local-store.mjs')).openFileBackedControlPlaneRepository({
      persistence,
      storePath: statePaths(dir).storeFile,
      clock: new persistence.ManualClock(demo.DEMO_NARRATIVE_EPOCH_MS),
    });
    const store = demo.createDemoStore({ repository });
    assert.equal(await store.isSeeded(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
