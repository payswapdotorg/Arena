#!/usr/bin/env node
/**
 * tests/product-e2e/run.mjs — the B017 product-E2E self-contained runner.
 *
 * tests/product-e2e is NOT a pnpm workspace project (the workspace root
 * does not include tests/*; adding it would be a root-manifest edit the
 * worker must not make — the tests/security and tests/epoch-e2e
 * precedent). This runner makes the battery fully self-contained:
 *
 *   1. TYPECHECK  the battery through apps/web's typescript
 *                 (tsc --noEmit -p tests/product-e2e/tsconfig.json);
 *   2. SERVE      the BUILT app on localhost (next start, fixed port)
 *                 for the served-app HTTP layer — requires `pnpm build`
 *                 to have produced apps/web/.next (the gate battery
 *                 always has; a fresh machine runs pnpm build first);
 *   3. RUN        vitest through apps/web's vitest with
 *                 --root ../../tests/product-e2e (the composition-layer
 *                 suites run with or without the server; the served-walk
 *                 suite activates through ARENA_E2E_BASE_URL);
 *   4. CLEAN UP   always: POST /demo/reset (demo-state hygiene) and kill
 *                 the server, even when tests fail.
 *
 * Zero external dependencies (plain Node >= 22). Exit code: nonzero on
 * any failed stage.
 *
 * Usage:
 *   node tests/product-e2e/run.mjs [--port 31317] [--no-serve]
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const WEB = join(REPO_ROOT, 'apps', 'web');

const args = process.argv.slice(2);
const portArg = args.findIndex((entry) => entry === '--port');
const PORT = portArg !== -1 ? Number(args[portArg + 1] ?? 31317) : 31317;
const SERVE = !args.includes('--no-serve');
const BASE_URL = `http://localhost:${String(PORT)}`;

function fail(message) {
  process.stderr.write(`[product-e2e] FAIL: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[product-e2e] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 1) Typecheck (apps/web owns typescript)
// ---------------------------------------------------------------------------
log(`typecheck: tsc --noEmit -p tests/product-e2e/tsconfig.json`);
const tsc = spawnSync(
  process.execPath,
  [join(WEB, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', join(REPO_ROOT, 'tests', 'product-e2e', 'tsconfig.json')],
  { cwd: WEB, encoding: 'utf-8' },
);
if (tsc.status !== 0) {
  process.stdout.write(tsc.stdout ?? '');
  process.stderr.write(tsc.stderr ?? '');
  fail('typecheck failed');
}
log('typecheck: clean');

// ---------------------------------------------------------------------------
// 2) Serve the built app (next start)
// ---------------------------------------------------------------------------
let server;
if (SERVE) {
  if (!existsSync(join(WEB, '.next', 'BUILD_ID'))) {
    fail(
      'apps/web/.next is missing — run `pnpm build` first (the gate battery always produces it), or pass --no-serve to run the composition-layer suites only.',
    );
  }
  log(`serve: next start -p ${String(PORT)} (local/demo mode, localhost only)`);
  server = spawn(process.execPath, [join(WEB, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], {
    cwd: WEB,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[next] ${chunk}`));

  // Ready-poll: the demo landing answers 200 with the demo banner.
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    if (server.exitCode !== null) {
      fail(`next start exited early (code ${String(server.exitCode)})`);
    }
    try {
      const probe = await fetch(`${BASE_URL}/demo`, { redirect: 'follow' });
      if (probe.ok) ready = true;
    } catch {
      // not up yet — keep polling
    }
  }
  if (!ready) {
    fail(`next start did not become ready on ${BASE_URL} within 60s`);
  }
  log(`serve: ready on ${BASE_URL}`);
}

// ---------------------------------------------------------------------------
// 3) Run the battery (apps/web owns vitest)
// ---------------------------------------------------------------------------
const vitestArgs = [
  join(WEB, 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  '--root',
  join(REPO_ROOT, 'tests', 'product-e2e'),
];
if (!SERVE) {
  // Without the server the served-walk suite self-skips (its skipIf
  // guards on ARENA_E2E_BASE_URL); make that explicit in the report.
  log('serve: skipped (--no-serve) — served-walk suite will self-skip');
}
log(`run: vitest run --root tests/product-e2e`);
const vitest = spawnSync(process.execPath, vitestArgs, {
  cwd: WEB,
  encoding: 'utf-8',
  env: {
    ...process.env,
    ...(SERVE ? { ARENA_E2E_BASE_URL: BASE_URL } : {}),
  },
});
process.stdout.write(vitest.stdout ?? '');
process.stderr.write(vitest.stderr ?? '');

// ---------------------------------------------------------------------------
// 4) Cleanup: reset the served demo state, kill the server
// ---------------------------------------------------------------------------
async function cleanup() {
  if (server !== undefined && server.exitCode === null) {
    try {
      await fetch(`${BASE_URL}/demo/reset`, { method: 'POST', redirect: 'manual' });
      log('cleanup: POST /demo/reset (demo state reseeded to the frozen corpus)');
    } catch {
      log('cleanup: /demo/reset unreachable (server already down)');
    }
    server.kill('SIGTERM');
    await new Promise((resolveKill) => {
      server.on('exit', resolveKill);
      setTimeout(resolveKill, 5000);
    });
    log('cleanup: next start stopped');
  }
}

await cleanup();
process.exit(vitest.status ?? 1);
