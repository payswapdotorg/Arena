#!/usr/bin/env node
/**
 * tests/api-host/run.mjs — the P003 public-transport acceptance battery's
 * self-contained runner (the tests/runtime-host precedent).
 *
 * tests/api-host is NOT a pnpm workspace project (the workspace root does
 * not include tests/*; adding it would be a root-manifest edit the worker
 * must not make). This runner makes the battery fully self-contained:
 *
 *   1. TYPECHECK the battery through services/escalation-api's
 *      typescript (tsc --noEmit -p tests/api-host/tsconfig.json);
 *   2. RUN vitest through services/escalation-api's vitest with
 *      --root tests/api-host.
 *
 * Zero external dependencies (plain Node >= 22). Exit code: nonzero on
 * any failed stage.
 *
 * Usage:
 *   node tests/api-host/run.mjs
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const ESCALATION_API = join(REPO_ROOT, 'services', 'escalation-api');

function fail(message) {
  process.stderr.write(`[api-host-battery] FAIL: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[api-host-battery] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 1) Typecheck (services/escalation-api owns typescript)
// ---------------------------------------------------------------------------
log('typecheck: tsc --noEmit -p tests/api-host/tsconfig.json');
const tsc = spawnSync(
  process.execPath,
  [
    join(ESCALATION_API, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '-p',
    join(REPO_ROOT, 'tests', 'api-host', 'tsconfig.json'),
  ],
  { cwd: ESCALATION_API, encoding: 'utf-8' },
);
if (tsc.status !== 0) {
  process.stdout.write(tsc.stdout ?? '');
  process.stderr.write(tsc.stderr ?? '');
  fail('typecheck failed');
}
log('typecheck: clean');

// ---------------------------------------------------------------------------
// 2) Run the battery (services/escalation-api owns vitest)
// ---------------------------------------------------------------------------
log('run: vitest run --root tests/api-host');
const vitest = spawnSync(
  process.execPath,
  [
    join(ESCALATION_API, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--root',
    join(REPO_ROOT, 'tests', 'api-host'),
  ],
  { cwd: ESCALATION_API, encoding: 'utf-8' },
);
process.stdout.write(vitest.stdout ?? '');
process.stderr.write(vitest.stderr ?? '');

if (vitest.status !== 0) {
  fail(`vitest exited with status ${String(vitest.status ?? 'null')}`);
}
log('run: green');
