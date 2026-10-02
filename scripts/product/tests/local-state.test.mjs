/**
 * Deterministic tests for the local state layout + reset wipe plan
 * (Work Order B016). Uses real temp trees so the plan logic is exercised
 * against actual fs existence, and pure injections for edge cases.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_STATE_DIR_NAME,
  STATE_DIR_ENV_VAR,
  buildWipePlan,
  resolveStateDir,
  statePaths,
} from '../lib/local-state.mjs';
import { MODULE_REPO_ROOT, resolveRepoRoot, REPO_ROOT_ENV_VAR } from '../lib/paths.mjs';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'arena-local-state-'));
}

test('resolveStateDir: default is <repoRoot>/.arena-local; env var wins', () => {
  const repoRoot = makeTempDir();
  const defaultDir = resolveStateDir({ repoRoot, env: {} });
  assert.equal(defaultDir, join(repoRoot, DEFAULT_STATE_DIR_NAME));

  const override = join(makeTempDir(), 'custom-state');
  const overridden = resolveStateDir({ repoRoot, env: { [STATE_DIR_ENV_VAR]: override } });
  assert.equal(overridden, override);
});

test('statePaths pins the store file layout', () => {
  const paths = statePaths('/tmp/state');
  assert.equal(paths.storeDir, '/tmp/state/store');
  assert.equal(paths.storeFile, '/tmp/state/store/control-plane.json');
});

test('resolveRepoRoot: module URL by default; test-seam env var wins', () => {
  assert.equal(resolveRepoRoot({ env: {} }), MODULE_REPO_ROOT);
  const scratch = makeTempDir();
  assert.equal(resolveRepoRoot({ env: { [REPO_ROOT_ENV_VAR]: scratch } }), scratch);
});

test('buildWipePlan includes state + existing caches, never source or node_modules', () => {
  const repoRoot = makeTempDir();
  try {
    // fabricate a scratch repository tree
    const stateDir = join(repoRoot, '.arena-local');
    mkdirSync(join(stateDir, 'store'), { recursive: true });
    writeFileSync(join(stateDir, 'store', 'control-plane.json'), '{}\n');
    mkdirSync(join(repoRoot, '.turbo'));
    mkdirSync(join(repoRoot, 'packages', 'demo', 'dist'), { recursive: true });
    mkdirSync(join(repoRoot, 'apps', 'web', '.next'), { recursive: true });
    mkdirSync(join(repoRoot, 'packages', 'persistence', 'coverage'), { recursive: true });
    // protected sentinels
    writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'sentinel\n');
    writeFileSync(join(repoRoot, 'source-sentinel.ts'), 'export {};\n');
    mkdirSync(join(repoRoot, 'node_modules'), { recursive: true });
    // a workspace package WITHOUT caches must not appear
    mkdirSync(join(repoRoot, 'packages', 'protocol-core'), { recursive: true });

    const plan = buildWipePlan({ repoRoot, stateDir });
    const paths = plan.map((target) => target.path);

    assert.ok(paths.includes(stateDir), 'state dir is in the plan');
    assert.ok(paths.includes(join(repoRoot, '.turbo')), 'root .turbo cache is in the plan');
    assert.ok(paths.includes(join(repoRoot, 'packages', 'demo', 'dist')), 'package dist is in the plan');
    assert.ok(paths.includes(join(repoRoot, 'apps', 'web', '.next')), 'app .next is in the plan');
    assert.ok(paths.includes(join(repoRoot, 'packages', 'persistence', 'coverage')), 'package coverage is in the plan');

    for (const path of paths) {
      assert.notEqual(path, join(repoRoot, 'pnpm-lock.yaml'), 'lockfile is never in the plan');
      assert.notEqual(path, join(repoRoot, 'node_modules'), 'node_modules is never in the plan');
      assert.notEqual(path, join(repoRoot, 'source-sentinel.ts'), 'source files are never in the plan');
    }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('buildWipePlan is empty when nothing exists', () => {
  const repoRoot = makeTempDir();
  try {
    const plan = buildWipePlan({ repoRoot, stateDir: join(repoRoot, '.arena-local') });
    assert.deepEqual(plan, []);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('buildWipePlan tolerates a missing workspace root directory', () => {
  const repoRoot = makeTempDir();
  try {
    mkdirSync(join(repoRoot, '.turbo'));
    const plan = buildWipePlan({ repoRoot, stateDir: join(repoRoot, '.arena-local') });
    assert.deepEqual(plan.map((t) => t.path), [join(repoRoot, '.turbo')]);
    assert.equal(existsSync(join(repoRoot, 'apps')), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('buildWipePlan works with fully injected fs probes (pure)', () => {
  const existing = new Set(['/repo/.arena-local', '/repo/.turbo', '/repo/packages', '/repo/packages/demo/dist']);
  const plan = buildWipePlan({
    repoRoot: '/repo',
    stateDir: '/repo/.arena-local',
    exists: (path) => existing.has(path),
    readDir: () => ['demo', 'persistence'],
  });
  assert.deepEqual(
    plan.map((t) => t.path).sort(),
    ['/repo/.arena-local', '/repo/.turbo', '/repo/packages/demo/dist'].sort(),
  );
});
