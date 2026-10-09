#!/usr/bin/env node
/**
 * tests/runtime-host/run.mjs — the P002 durable host runtime acceptance
 * battery's self-contained runner (the tests/hosted-provider-e2e
 * precedent).
 *
 * tests/runtime-host is NOT a pnpm workspace project (the workspace root
 * does not include tests/*; adding it would be a root-manifest edit the
 * worker must not make). This runner makes the battery fully
 * self-contained:
 *
 *   1. TYPECHECK the battery through services/runtime-host's typescript
 *      (tsc --noEmit -p tests/runtime-host/tsconfig.json) — which also
 *      typechecks deploy/runtime/src/composition.ts, the production
 *      composition the battery composes;
 *   2. RUN vitest through services/runtime-host's vitest with
 *      --root tests/runtime-host (services/runtime-host owns vitest AND
 *      the battery's embedded real-Postgres engine pin
 *      @electric-sql/pglite).
 *
 * Live-Neon activation (credentials are NEVER required — the live suite
 * self-skips with an explicit reason when absent):
 *   - ARENA_P002_NEON_EVIDENCE_URL — a postgres:// connection string to
 *     the DEDICATED arena-p002-evidence project/branch (created by the
 *     evidence script; NEVER an existing shared project);
 *   - falls back to DATABASE_URL / NEON_CONNECTION_STRING when they
 *     carry a postgres:// / postgresql:// scheme (the same env
 *     resolution the adapter itself uses);
 *   - evidence capture: ARENA_P002_EVIDENCE_OUT=<dir> (defaults to
 *     tests/runtime-host/evidence) — machine-generated transcript
 *     fragments are written there, redacted at capture time.
 *
 * Zero external dependencies (plain Node >= 22). Exit code: nonzero on
 * any failed stage.
 *
 * Usage:
 *   node tests/runtime-host/run.mjs
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const RUNTIME_HOST = join(REPO_ROOT, 'services', 'runtime-host');

function fail(message) {
  process.stderr.write(`[runtime-host-battery] FAIL: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[runtime-host-battery] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 1) Typecheck (services/runtime-host owns typescript)
// ---------------------------------------------------------------------------
log('typecheck: tsc --noEmit -p tests/runtime-host/tsconfig.json');
const tsc = spawnSync(
  process.execPath,
  [
    join(RUNTIME_HOST, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '-p',
    join(REPO_ROOT, 'tests', 'runtime-host', 'tsconfig.json'),
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
// 2) Run the battery (services/runtime-host owns vitest + PGlite)
// ---------------------------------------------------------------------------
log('run: vitest run --root tests/runtime-host');
const vitest = spawnSync(
  process.execPath,
  [
    join(RUNTIME_HOST, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--root',
    join(REPO_ROOT, 'tests', 'runtime-host'),
  ],
  { cwd: RUNTIME_HOST, encoding: 'utf-8' },
);
process.stdout.write(vitest.stdout ?? '');
process.stderr.write(vitest.stderr ?? '');

if (vitest.status !== 0) {
  fail(`vitest exited with status ${String(vitest.status ?? 'null')}`);
}
log('run: green');
