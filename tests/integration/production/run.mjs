#!/usr/bin/env node
/**
 * tests/integration/production/run.mjs — the P006 integrated acceptance
 * battery's self-contained runner (the tests/runtime-host and
 * tests/api-house precedents).
 *
 * tests/integration/production is NOT a pnpm workspace project (the
 * workspace root does not include tests/*; adding it would be a
 * root-manifest edit the worker must not make). This runner makes the
 * battery fully self-contained:
 *
 *   1. TYPECHECK the battery through services/runtime-host's typescript
 *      (tsc --noEmit -p tests/integration/production/tsconfig.json);
 *   2. RUN vitest through services/runtime-host's vitest with
 *      --root tests/integration/production (services/runtime-host owns
 *      the @electric-sql/pglite pin — the embedded real-Postgres engine
 *      this battery composes; the tests/runtime-host precedent).
 *
 * Zero external dependencies (plain Node >= 22). Exit code: nonzero on
 * any failed stage.
 *
 * Usage:
 *   node tests/integration/production/run.mjs
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const RUNTIME_HOST = join(REPO_ROOT, 'services', 'runtime-host');

function fail(message) {
  process.stderr.write(`[integration-battery] FAIL: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[integration-battery] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 1) Typecheck (services/runtime-host owns typescript + the pglite pin)
// ---------------------------------------------------------------------------
log('typecheck: tsc --noEmit -p tests/integration/production/tsconfig.json');
const tsc = spawnSync(
  process.execPath,
  [
    join(RUNTIME_HOST, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '-p',
    join(REPO_ROOT, 'tests', 'integration', 'production', 'tsconfig.json'),
  ],
  { cwd: RUNTIME_HOST, encoding: 'utf-8' },
);
if (tsc.status !== 0) {
  process.stdout.write(tsc.stdout ?? '');
  process.stderr.write(tsc.stderr ?? '');
  fail('typecheck failed');
}
log('typecheck: clean');

// ---------------------------------------------------------------------------
// 2) Run the battery (services/runtime-host owns vitest)
// ---------------------------------------------------------------------------
log('run: vitest run --root tests/integration/production');
const vitest = spawnSync(
  process.execPath,
  [
    join(RUNTIME_HOST, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--root',
    join(REPO_ROOT, 'tests', 'integration', 'production'),
  ],
  { cwd: RUNTIME_HOST, encoding: 'utf-8' },
);
process.stdout.write(vitest.stdout ?? '');
process.stderr.write(vitest.stderr ?? '');

if (vitest.status !== 0) {
  fail(`vitest exited with status ${String(vitest.status ?? 'null')}`);
}
log('run: green');
