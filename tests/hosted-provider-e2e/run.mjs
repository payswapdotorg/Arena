#!/usr/bin/env node
/**
 * tests/hosted-provider-e2e/run.mjs — the P004 hosted-provider E2E
 * self-contained runner (the tests/product-e2e / tests/ux precedent).
 *
 * tests/hosted-provider-e2e is NOT a pnpm workspace project (the workspace
 * root does not include tests/*; adding it would be a root-manifest edit
 * the worker must not make). This runner makes the battery fully
 * self-contained:
 *
 *   1. TYPECHECK the battery through adapters/hosted's typescript
 *      (tsc --noEmit -p tests/hosted-provider-e2e/tsconfig.json);
 *   2. RUN vitest through adapters/hosted's vitest with
 *      --root tests/hosted-provider-e2e (adapters/hosted owns vitest AND
 *      the hosted adapters' provider dependency @aws-sdk/client-s3).
 *
 * Live-provider activation (credentials are NEVER required — suites
 * self-skip with explicit reasons when absent):
 *   - R2 live rows: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_S3_ENDPOINT
 *     (or R2_ACCOUNT_ID) + ARENA_HOSTED_E2E_R2_BUCKET — the DEDICATED
 *     evidence bucket. The lifecycle suite writes and deletes objects;
 *     content-addressed keys admit no prefix isolation, so a dedicated
 *     bucket is the only safe isolation and the suite refuses to run
 *     without one.
 *   - Upstash live rows: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
 *   - App boot row: apps/web/.next/BUILD_ID (pnpm build first); disable
 *     with --no-app-boot.
 *   - Evidence capture: ARENA_HOSTED_EVIDENCE_OUT=<dir> — machine-generated
 *     transcript fragments are written there (redacted at capture time)
 *     for embedding under docs/evidence/production/providers/.
 *
 * Zero external dependencies (plain Node >= 22). Exit code: nonzero on any
 * failed stage.
 *
 * Usage:
 *   node tests/hosted-provider-e2e/run.mjs [--no-app-boot]
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const HOSTED = join(REPO_ROOT, 'adapters', 'hosted');

const args = process.argv.slice(2);
const APP_BOOT = !args.includes('--no-app-boot');

function fail(message) {
  process.stderr.write(`[hosted-provider-e2e] FAIL: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[hosted-provider-e2e] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 1) Typecheck (adapters/hosted owns typescript)
// ---------------------------------------------------------------------------
log('typecheck: tsc --noEmit -p tests/hosted-provider-e2e/tsconfig.json');
const tsc = spawnSync(
  process.execPath,
  [
    join(HOSTED, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '-p',
    join(REPO_ROOT, 'tests', 'hosted-provider-e2e', 'tsconfig.json'),
  ],
  { cwd: HOSTED, encoding: 'utf-8' },
);
if (tsc.status !== 0) {
  process.stdout.write(tsc.stdout ?? '');
  process.stderr.write(tsc.stderr ?? '');
  fail('typecheck failed');
}
log('typecheck: clean');

// ---------------------------------------------------------------------------
// 2) Run the battery (adapters/hosted owns vitest + the provider SDK)
// ---------------------------------------------------------------------------
if (!APP_BOOT) {
  log('app boot: skipped (--no-app-boot) — the app-boot suite will self-skip');
}
log('run: vitest run --root tests/hosted-provider-e2e');
const vitest = spawnSync(
  process.execPath,
  [
    join(HOSTED, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--root',
    join(REPO_ROOT, 'tests', 'hosted-provider-e2e'),
  ],
  {
    cwd: HOSTED,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...(APP_BOOT ? {} : { ARENA_HOSTED_E2E_SKIP_APP_BOOT: '1' }),
    },
  },
);
process.stdout.write(vitest.stdout ?? '');
process.stderr.write(vitest.stderr ?? '');

if (vitest.status !== 0) {
  fail(`vitest exited with status ${String(vitest.status ?? 'null')}`);
}
log('run: green');
