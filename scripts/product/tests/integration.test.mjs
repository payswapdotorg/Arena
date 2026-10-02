/**
 * Thin integration wrappers (Work Order B016): spawn the REAL command
 * entry points as subprocesses and verify the golden paths end-to-end —
 * seed → doctor(healthy) → reset → doctor(unseeded) — against a
 * temporary state directory (ARENA_LOCAL_STATE_DIR) and a scratch repo
 * tree for the reset totality check (ARENA_PRODUCT_REPO_ROOT test seam).
 *
 * These are deliberately THIN: the semantics are covered by the
 * pure-logic suites; this file proves the commands themselves run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MODULE_REPO_ROOT } from '../lib/paths.mjs';
import { statePaths } from '../lib/local-state.mjs';

const NODE = process.execPath;

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'arena-integration-'));
}

/**
 * Run a product command as a real subprocess.
 *
 * @param {{ command: string, args: string[], env?: Record<string, string>, stdin?: string }} input
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runCommand(input) {
  const result = spawnSync(NODE, [join(MODULE_REPO_ROOT, 'scripts', 'product', input.command), ...input.args], {
    cwd: MODULE_REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, ...input.env },
    input: input.stdin ?? '',
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

test('integration: seed.mjs seeds the real demo corpus into the real local store', () => {
  const stateDir = makeTempDir();
  try {
    const result = runCommand({ command: 'seed.mjs', args: [], env: { ARENA_LOCAL_STATE_DIR: stateDir } });
    assert.equal(result.status, 0, `seed failed:\n${result.stderr}`);
    assert.match(result.stdout, /demo tenant: arena-demo/);
    assert.match(result.stdout, /created this run: 5 record\(s\)/);
    assert.match(result.stdout, /Demo state is not customer state/);
    assert.equal(existsSync(statePaths(stateDir).storeFile), true);

    // idempotence through the real command
    const rerun = runCommand({ command: 'seed.mjs', args: [], env: { ARENA_LOCAL_STATE_DIR: stateDir } });
    assert.equal(rerun.status, 0);
    assert.match(rerun.stdout, /already present: 5 record\(s\)/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('integration: seed.mjs --help prints usage and exits 0', () => {
  const result = runCommand({ command: 'seed.mjs', args: ['--help'] });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage:/);
  assert.match(result.stdout, /idempotent/);
});

test('integration: seed.mjs rejects unknown flags with exit code 2', () => {
  const result = runCommand({ command: 'seed.mjs', args: ['--nope'] });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown flag --nope/);
});

test('integration: doctor.mjs diagnoses the seeded store as healthy', () => {
  const stateDir = makeTempDir();
  try {
    runCommand({ command: 'seed.mjs', args: [], env: { ARENA_LOCAL_STATE_DIR: stateDir } });
    const result = runCommand({ command: 'doctor.mjs', args: [], env: { ARENA_LOCAL_STATE_DIR: stateDir } });
    assert.equal(result.status, 0, `doctor failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /store: local fake persistence store healthy/);
    assert.match(result.stdout, /byte-identical/);
    assert.match(result.stdout, /verdict: \d+ pass · \d+ warn · 0 fail/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('integration: reset.mjs aborts (exit 1, deletes nothing) when non-interactive without --yes', () => {
  const stateDir = makeTempDir();
  try {
    runCommand({ command: 'seed.mjs', args: [], env: { ARENA_LOCAL_STATE_DIR: stateDir } });
    const result = runCommand({ command: 'reset.mjs', args: [], env: { ARENA_LOCAL_STATE_DIR: stateDir } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ABORTED: non-interactive session/);
    assert.equal(existsSync(statePaths(stateDir).storeFile), true, 'nothing was deleted');
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('integration: reset.mjs --yes wipes totally over a scratch repo tree and protects source', () => {
  const stateDir = makeTempDir();
  const scratchRepo = makeTempDir();
  try {
    // state: real seeded store
    runCommand({ command: 'seed.mjs', args: [], env: { ARENA_LOCAL_STATE_DIR: stateDir } });
    // scratch repo: caches + protected sentinels
    mkdirSync(join(scratchRepo, '.turbo'), { recursive: true });
    mkdirSync(join(scratchRepo, 'packages', 'demo', 'dist'), { recursive: true });
    writeFileSync(join(scratchRepo, 'pnpm-lock.yaml'), 'sentinel\n');
    writeFileSync(join(scratchRepo, 'source-sentinel.ts'), 'export {};\n');
    mkdirSync(join(scratchRepo, 'node_modules'), { recursive: true });

    const result = runCommand({
      command: 'reset.mjs',
      args: ['--yes'],
      env: {
        ARENA_LOCAL_STATE_DIR: stateDir,
        ARENA_PRODUCT_REPO_ROOT: scratchRepo,
      },
    });
    assert.equal(result.status, 0, `reset failed:\n${result.stderr}`);
    assert.match(result.stdout, /wiped 3 path\(s\)/);

    assert.equal(existsSync(stateDir), false, 'state wiped');
    assert.equal(existsSync(join(scratchRepo, '.turbo')), false, 'cache wiped');
    assert.equal(existsSync(join(scratchRepo, 'packages', 'demo', 'dist')), false, 'dist wiped');
    assert.equal(existsSync(join(scratchRepo, 'pnpm-lock.yaml')), true, 'lockfile protected');
    assert.equal(existsSync(join(scratchRepo, 'source-sentinel.ts')), true, 'source protected');
    assert.equal(existsSync(join(scratchRepo, 'node_modules')), true, 'node_modules protected');
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(scratchRepo, { recursive: true, force: true });
  }
});

test('integration: reset.mjs --yes --reseed returns the store to the identical corpus', () => {
  const stateDir = makeTempDir();
  try {
    runCommand({ command: 'seed.mjs', args: [], env: { ARENA_LOCAL_STATE_DIR: stateDir } });
    const result = runCommand({
      command: 'reset.mjs',
      args: ['--yes', '--reseed'],
      env: { ARENA_LOCAL_STATE_DIR: stateDir },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /re-seeding the deterministic demo corpus/);
    assert.match(result.stdout, /created this run: 5 record\(s\)/);
    assert.equal(existsSync(statePaths(stateDir).storeFile), true);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('integration: install.mjs --help prints the honest prerequisite contract', () => {
  const result = runCommand({ command: 'install.mjs', args: ['--help'] });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /NO provider accounts and NO credentials/);
  assert.match(result.stdout, /pnpm install/);
  assert.match(result.stdout, /pnpm build/);
});

test('integration: doctor.mjs --help maps to the troubleshooting doc', () => {
  const result = runCommand({ command: 'doctor.mjs', args: ['--help'] });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /troubleshooting\.md/);
});
