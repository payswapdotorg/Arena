/**
 * P004 — demo-with-zero-credentials check, app layer (the fail-closed
 * contract): the BUILT app boots and serves the demo with a fully
 * sanitized environment — NO provider credentials set.
 *
 * This is the live boot of the real production artifact (apps/web built
 * by `pnpm build`), not a unit test of composition code: `next start`
 * runs with every provider credential name removed from its environment
 * (the hosted env contract names + the sandbox-side provider variables —
 * see support/sanitize.ts), the demo routes answer 200, and the landing
 * page answers 200.
 *
 * Self-skips (explicit reason, never fails) when:
 *   - apps/web/.next/BUILD_ID is absent (run `pnpm build` first — the
 *     battery always produces it; the product-e2e precedent);
 *   - ARENA_HOSTED_E2E_SKIP_APP_BOOT=1 (the runner's --no-app-boot).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removedProviderEnvNames, sanitizedEnv } from '../support/sanitize.js';
import { recordTranscript } from '../support/transcript.js';

const FACET = 'zero-credential';

/** Repo root = tests/hosted-provider-e2e/../../.. */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const WEB = join(REPO_ROOT, 'apps', 'web');
const BUILD_ID = join(WEB, '.next', 'BUILD_ID');
const PORT = Number(process.env['ARENA_HOSTED_E2E_APP_PORT'] ?? 31324);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

const buildPresent = existsSync(BUILD_ID);
const skipRequested = process.env['ARENA_HOSTED_E2E_SKIP_APP_BOOT'] === '1';

describe('zero-credential app boot gates (always run)', () => {
  it('reports the app-boot activation status with an explicit reason', (ctx) => {
    if (skipRequested) {
      ctx.skip('ARENA_HOSTED_E2E_SKIP_APP_BOOT=1 — the runner was invoked with --no-app-boot');
      return;
    }
    if (!buildPresent) {
      ctx.skip(
        'apps/web/.next/BUILD_ID is absent — run `pnpm build` first (the battery always produces it); the adapter-level zero-credential suite still ran',
      );
      return;
    }
    expect(buildPresent).toBe(true);
  });
});

describe.skipIf(skipRequested || !buildPresent)(
  'app boots and serves the demo with ZERO provider credentials (live boot)',
  () => {
    let server: ChildProcess | null = null;
    const removedNames = removedProviderEnvNames();
    let readyLog = '';

    afterAll(() => {
      if (server !== null && server.exitCode === null) {
        server.kill('SIGTERM');
      }
    });

    it('boots the built app with a sanitized environment and serves the demo', async () => {
      // The sanitized environment: every provider credential name is
      // REMOVED (undefined) — the app runs with zero provider credentials.
      const env = sanitizedEnv();
      for (const name of removedNames) {
        expect(env[name]).toBeUndefined();
      }

      server = spawn(
        process.execPath,
        [join(WEB, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)],
        {
          cwd: WEB,
          env: { ...env, PORT: String(PORT), NODE_ENV: 'production' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      server.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (readyLog.length < 2000) readyLog += text;
      });
      server.stderr?.on('data', (chunk: Buffer) => {
        if (readyLog.length < 2000) readyLog += chunk.toString();
      });

      // Ready-poll: the demo landing answers 200.
      const deadline = Date.now() + 60_000;
      let demoStatus = 0;
      let ready = false;
      while (!ready && Date.now() < deadline) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
        if (server.exitCode !== null) {
          throw new Error(
            `next start exited early (code ${String(server.exitCode)}) with a sanitized env — the app does NOT boot without provider credentials: ${readyLog.slice(0, 500)}`,
          );
        }
        try {
          const probe = await fetch(`${BASE_URL}/demo`, { redirect: 'follow' });
          demoStatus = probe.status;
          if (probe.ok) ready = true;
        } catch {
          // not up yet — keep polling
        }
      }
      expect(ready).toBe(true);

      const landing = await fetch(`${BASE_URL}/`, { redirect: 'follow' });
      expect(landing.status).toBe(200);
      const landingBody = await landing.text();
      expect(landingBody.length).toBeGreaterThan(0);

      recordTranscript(FACET, {
        step: 'app boot with zero provider credentials',
        command: `next start -p ${String(PORT)} with sanitizedEnv(process.env) — removed ${String(removedNames.length)} provider env names: ${removedNames.join(', ')} (NAMES only)`,
        resource: `apps/web production build @ ${WEB} (BUILD_ID present), http://127.0.0.1:${String(PORT)}`,
        result: `GET /demo → ${String(demoStatus)}; GET / → ${String(landing.status)} (${String(landingBody.length)} bytes) — the demo runs with NO provider credentials set (the fail-closed contract: absence of providers degrades nothing the demo needs)`,
        classification: 'DEMONSTRATED-LIVE',
      });
    }, 90_000);
  },
);
