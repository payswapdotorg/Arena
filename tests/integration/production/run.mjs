#!/usr/bin/env node
/**
 * tests/integration/production/run.mjs — the P006 integrated acceptance
 * battery's self-contained runner (the tests/runtime-host and
 * tests/api-host precedents).
 *
 * tests/integration/production is NOT a pnpm workspace project (the
 * workspace root does not include tests/*; adding it would be a
 * root-manifest edit the worker must not make). This runner makes the
 * battery fully self-contained and drives BOTH client surfaces of the
 * integrated acceptance:
 *
 *   1. TYPECHECK each battery through services/runtime-host's typescript
 *      (tsc --noEmit -p <battery>/tsconfig.json);
 *   2. RUN vitest through services/runtime-host's vitest with
 *      --root <battery> for:
 *        a. tests/integration/production — the composition + generic
 *           client + identical-flow + resilience suites;
 *        b. adapters/epoch-escalation/host-integration-tests — the Epoch
 *           adapter host-integration suite (M2(b); the same harness,
 *           imported through the shared support tree).
 *
 * services/runtime-host owns the @electric-sql/pglite pin — the embedded
 * real-Postgres engine both batteries compose.
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

/** The integrated battery's suites (in run order). */
const BATTERIES = [
  {
    label: 'integration-production',
    dir: join(REPO_ROOT, 'tests', 'integration', 'production'),
  },
  {
    label: 'epoch-host-integration',
    dir: join(REPO_ROOT, 'adapters', 'epoch-escalation', 'host-integration-tests'),
  },
];

function fail(message) {
  process.stderr.write(`[integration-battery] FAIL: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[integration-battery] ${message}\n`);
}

for (const battery of BATTERIES) {
  // -------------------------------------------------------------------------
  // 1) Typecheck (services/runtime-host owns typescript + the pglite pin)
  // -------------------------------------------------------------------------
  log(`typecheck[${battery.label}]: tsc --noEmit -p ${battery.dir}`);
  const tsc = spawnSync(
    process.execPath,
    [
      join(RUNTIME_HOST, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit',
      '-p',
      join(battery.dir, 'tsconfig.json'),
    ],
    { cwd: RUNTIME_HOST, encoding: 'utf-8' },
  );
  if (tsc.status !== 0) {
    process.stdout.write(tsc.stdout ?? '');
    process.stderr.write(tsc.stderr ?? '');
    fail(`typecheck failed for ${battery.label}`);
  }
  log(`typecheck[${battery.label}]: clean`);

  // -------------------------------------------------------------------------
  // 2) Run the battery (services/runtime-host owns vitest)
  // -------------------------------------------------------------------------
  log(`run[${battery.label}]: vitest run --root ${battery.dir}`);
  const vitest = spawnSync(
    process.execPath,
    [
      join(RUNTIME_HOST, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--root',
      battery.dir,
    ],
    { cwd: RUNTIME_HOST, encoding: 'utf-8' },
  );
  process.stdout.write(vitest.stdout ?? '');
  process.stderr.write(vitest.stderr ?? '');

  if (vitest.status !== 0) {
    fail(`vitest exited with status ${String(vitest.status ?? 'null')} for ${battery.label}`);
  }
  log(`run[${battery.label}]: green`);
}

log('integrated battery (both clients): green');
