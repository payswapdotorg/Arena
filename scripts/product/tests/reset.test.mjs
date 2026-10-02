/**
 * Deterministic tests for the reset workflow (Work Order B016): the
 * confirmation gate (pure), reset TOTALITY over a scratch tree (state +
 * caches gone; source, node_modules and the lockfile untouched), and the
 * re-seed option. Drives runReset in-process with injected io.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryStream } from '../lib/cli.mjs';
import { statePaths } from '../lib/local-state.mjs';
import { readStoreSnapshot } from '../lib/local-store.mjs';
import { loadArenaModules } from '../lib/workspace.mjs';
import {
  evaluateResetAnswer,
  executeWipe,
  RESET_CONFIRM_WORD,
  resolveResetConfirmation,
  runReset,
} from '../lib/reset-logic.mjs';
import { runSeed } from '../lib/seed-logic.mjs';

const { demo, persistence } = await loadArenaModules();

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'arena-reset-'));
}

function makeIo({ isTTY = false, answer = '' } = {}) {
  const out = createMemoryStream();
  const err = createMemoryStream();
  return {
    out,
    err,
    isTTY,
    readLine: () => Promise.resolve(answer),
  };
}

test('confirmation gate: --yes proceeds; non-interactive without --yes aborts; TTY prompts', () => {
  assert.equal(resolveResetConfirmation({ assumeYes: true, isTTY: false }).kind, 'proceed');
  assert.equal(resolveResetConfirmation({ assumeYes: true, isTTY: true }).kind, 'proceed');

  const abort = resolveResetConfirmation({ assumeYes: false, isTTY: false });
  assert.equal(abort.kind, 'abort');
  assert.match(abort.next, /--yes/);

  const prompt = resolveResetConfirmation({ assumeYes: false, isTTY: true });
  assert.equal(prompt.kind, 'prompt');
  assert.equal(prompt.confirmWord, RESET_CONFIRM_WORD);
});

test('confirmation gate: only the exact confirm word proceeds', () => {
  assert.equal(evaluateResetAnswer('reset').kind, 'proceed');
  assert.equal(evaluateResetAnswer('  reset  ').kind, 'proceed');
  assert.equal(evaluateResetAnswer('RESET').kind, 'abort');
  assert.equal(evaluateResetAnswer('yes').kind, 'abort');
  assert.equal(evaluateResetAnswer('').kind, 'abort');
  assert.match(evaluateResetAnswer('nope').next, /nothing was deleted/);
});

test('executeWipe removes exactly the existing targets', () => {
  const removed = executeWipe(
    [
      { path: '/tmp/arena-wipe-existing', label: 'exists' },
      { path: '/tmp/arena-wipe-missing', label: 'missing' },
    ],
    {
      exists: (path) => path === '/tmp/arena-wipe-existing',
      rm: () => {},
    },
  );
  assert.deepEqual(removed, ['/tmp/arena-wipe-existing']);
});

test('runReset --yes is TOTAL: state + caches gone; source, node_modules and lockfile untouched', async () => {
  const repoRoot = makeTempDir();
  try {
    const stateDir = join(repoRoot, '.arena-local');
    // seed real demo state + fabricate caches + protected sentinels
    await runSeed({ demo, persistence, stateDir, out: createMemoryStream() });
    mkdirSync(join(repoRoot, '.turbo'), { recursive: true });
    mkdirSync(join(repoRoot, 'packages', 'demo', 'dist'), { recursive: true });
    mkdirSync(join(repoRoot, 'apps', 'web', '.next'), { recursive: true });
    mkdirSync(join(repoRoot, 'coverage'), { recursive: true });
    writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'sentinel-lockfile\n');
    writeFileSync(join(repoRoot, 'src-sentinel.ts'), 'export {};\n');
    mkdirSync(join(repoRoot, 'node_modules'), { recursive: true });
    writeFileSync(join(repoRoot, 'node_modules', 'sentinel'), 'deps\n');

    const io = makeIo();
    const exitCode = await runReset({
      repoRoot,
      stateDir,
      assumeYes: true,
      reseed: false,
      isTTY: false,
      out: io.out,
      err: io.err,
    });

    assert.equal(exitCode, 0);
    assert.match(io.out.text, /reset scope — LOCAL STATE ONLY/);
    assert.match(io.out.text, /protected \(never touched\): source tree, node_modules, pnpm-lock\.yaml/);

    // totality
    assert.equal(existsSync(stateDir), false, 'state dir wiped');
    assert.equal(existsSync(join(repoRoot, '.turbo')), false, '.turbo wiped');
    assert.equal(existsSync(join(repoRoot, 'packages', 'demo', 'dist')), false, 'dist wiped');
    assert.equal(existsSync(join(repoRoot, 'apps', 'web', '.next')), false, '.next wiped');
    assert.equal(existsSync(join(repoRoot, 'coverage')), false, 'coverage wiped');

    // protection
    assert.equal(existsSync(join(repoRoot, 'pnpm-lock.yaml')), true, 'lockfile untouched');
    assert.equal(existsSync(join(repoRoot, 'src-sentinel.ts')), true, 'source untouched');
    assert.equal(existsSync(join(repoRoot, 'node_modules', 'sentinel')), true, 'node_modules untouched');

    assert.match(io.out.text, /wiped 5 path\(s\)/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runReset aborts BEFORE deleting anything when non-interactive without --yes', async () => {
  const repoRoot = makeTempDir();
  try {
    const stateDir = join(repoRoot, '.arena-local');
    await runSeed({ demo, persistence, stateDir, out: createMemoryStream() });
    mkdirSync(join(repoRoot, '.turbo'), { recursive: true });

    const io = makeIo({ isTTY: false });
    const exitCode = await runReset({
      repoRoot,
      stateDir,
      assumeYes: false,
      reseed: false,
      isTTY: false,
      out: io.out,
      err: io.err,
    });

    assert.equal(exitCode, 1);
    assert.match(io.err.text, /ABORTED: non-interactive session/);
    assert.match(io.err.text, /--yes/);
    assert.equal(existsSync(stateDir), true, 'nothing was deleted');
    assert.equal(existsSync(join(repoRoot, '.turbo')), true, 'nothing was deleted');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runReset interactive: the exact confirm word proceeds, anything else aborts untouched', async () => {
  const repoRoot = makeTempDir();
  try {
    const stateDir = join(repoRoot, '.arena-local');
    await runSeed({ demo, persistence, stateDir, out: createMemoryStream() });

    const wrong = makeIo({ isTTY: true, answer: 'yes please' });
    const wrongExit = await runReset({
      repoRoot, stateDir, assumeYes: false, reseed: false, isTTY: true,
      out: wrong.out, err: wrong.err, readLine: wrong.readLine,
    });
    assert.equal(wrongExit, 1);
    assert.equal(existsSync(statePaths(stateDir).storeFile), true, 'wrong word → untouched');

    const right = makeIo({ isTTY: true, answer: 'reset\n' });
    const rightExit = await runReset({
      repoRoot, stateDir, assumeYes: false, reseed: false, isTTY: true,
      out: right.out, err: right.err, readLine: right.readLine,
    });
    assert.equal(rightExit, 0);
    assert.equal(existsSync(stateDir), false, 'exact word → wiped');
    assert.match(right.out.text, /confirmed \(typed confirmation\)/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runReset --yes --reseed wipes totally then reseeds to the identical corpus', async () => {
  const repoRoot = makeTempDir();
  try {
    const stateDir = join(repoRoot, '.arena-local');
    const storePath = statePaths(stateDir).storeFile;

    await runSeed({ demo, persistence, stateDir, out: createMemoryStream() });
    // tamper: an extra record outside the demo corpus (must not survive)
    const { openFileBackedControlPlaneRepository } = await import('../lib/local-store.mjs');
    const tampered = await openFileBackedControlPlaneRepository({
      persistence,
      storePath,
      clock: new persistence.ManualClock(demo.DEMO_NARRATIVE_EPOCH_MS),
    });
    await tampered.repository.insert({
      recordId: 'local.experiment.record',
      tenantId: 'arena-demo',
      kind: 'agent-body',
      version: 1,
      data: { scratch: true },
    });
    assert.equal(readStoreSnapshot(storePath).recordCount, 6);

    mkdirSync(join(repoRoot, '.turbo'), { recursive: true });
    const io = makeIo();
    const exitCode = await runReset({
      repoRoot,
      stateDir,
      assumeYes: true,
      reseed: true,
      isTTY: false,
      out: io.out,
      err: io.err,
      loadModules: loadArenaModules,
    });

    assert.equal(exitCode, 0);
    assert.equal(existsSync(join(repoRoot, '.turbo')), false, 'caches wiped during reset');
    const snapshot = readStoreSnapshot(storePath);
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.recordCount, 5, 'exactly the demo corpus after reseed');
    assert.deepEqual(snapshot.tenantCounts, { 'arena-demo': 5 });
    assert.match(io.out.text, /re-seeding the deterministic demo corpus/);
    assert.match(io.out.text, /created this run: 5 record\(s\)/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runReset on a clean tree is an honest no-op success', async () => {
  const repoRoot = makeTempDir();
  try {
    const io = makeIo();
    const exitCode = await runReset({
      repoRoot,
      stateDir: join(repoRoot, '.arena-local'),
      assumeYes: true,
      reseed: false,
      isTTY: false,
      out: io.out,
      err: io.err,
    });
    assert.equal(exitCode, 0);
    assert.match(io.out.text, /nothing to wipe/);
    assert.match(io.out.text, /nothing existed to remove/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
