#!/usr/bin/env node
/**
 * tests/ux/run.mjs — the B017 UX/operational conformance runner.
 *
 * tests/ux is NOT a pnpm workspace project (the tests/* precedent), so
 * this runner makes the battery self-contained:
 *
 *   1. TYPECHECK the battery through apps/web's typescript;
 *   2. SERVE the BUILT app on localhost (next start) when
 *      apps/web/.next exists — the served-layer suites activate
 *      through ARENA_UX_BASE_URL (they self-skip with --no-serve);
 *   3. RUN vitest through apps/web's vitest with
 *      --root ../../tests/ux;
 *   4. CLEAN UP always: POST /demo/reset + stop the server.
 *
 * The real-browser viewport suite additionally needs Playwright +
 * Chromium on the host (resolved through ARENA_PLAYWRIGHT_MODULE or the
 * global npm prefix; the repo carries no Playwright dependency because
 * a root-manifest/lockfile edit is forbidden for B017). Without it the
 * browser layer self-skips and the static overflow analysis still runs.
 *
 * Usage:
 *   node tests/ux/run.mjs [--port 31318] [--no-serve]
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
const PORT = portArg !== -1 ? Number(args[portArg + 1] ?? 31318) : 31318;
const SERVE = !args.includes('--no-serve');
const BASE_URL = `http://localhost:${String(PORT)}`;

const PLAYWRIGHT_MODULE =
  process.env.ARENA_PLAYWRIGHT_MODULE ??
  `${process.env.HOME ?? '/home/z'}/.npm-global/lib/node_modules/playwright/index.mjs`;

function fail(message) {
  process.stderr.write(`[ux-battery] FAIL: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[ux-battery] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 1) Typecheck (apps/web owns typescript)
// ---------------------------------------------------------------------------
log(`typecheck: tsc --noEmit -p tests/ux/tsconfig.json`);
const tsc = spawnSync(
  process.execPath,
  [join(WEB, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', join(REPO_ROOT, 'tests', 'ux', 'tsconfig.json')],
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
  log(`serve: next start -p ${String(PORT)} (localhost only)`);
  server = spawn(process.execPath, [join(WEB, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], {
    cwd: WEB,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[next] ${chunk}`));

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
log(
  existsSync(PLAYWRIGHT_MODULE)
    ? 'browser layer: Playwright module found — the real-browser viewport checks will run'
    : 'browser layer: no Playwright module found — the real-browser viewport checks SELF-SKIP (the static overflow analysis still runs)',
);
log('run: vitest run --root tests/ux');
const vitest = spawnSync(
  process.execPath,
  [join(WEB, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', join(REPO_ROOT, 'tests', 'ux')],
  {
    cwd: WEB,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...(SERVE ? { ARENA_UX_BASE_URL: BASE_URL } : {}),
      ...(existsSync(PLAYWRIGHT_MODULE)
        ? { ARENA_PLAYWRIGHT_MODULE: PLAYWRIGHT_MODULE }
        : {}),
    },
  },
);
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
