/**
 * The Arena Expert Workbench entry (Work Order A017) — the A018 console
 * bootstrap, replicated for the workbench surface.
 *
 * Run with:
 *
 *   node --experimental-strip-types apps/web/src/workbench/main.mjs
 *
 * (from the repository root; Node >= 22.6 with type stripping — on
 * Node >= 22.18 type stripping is on by default and the flag is a no-op).
 *
 * What happens at startup, in order:
 *
 *   1. register the `.js` → `.ts` resolution shim (loader.mjs) so the
 *      workspace packages' TypeScript sources can be loaded directly —
 *      `module.registerHooks` on Node >= 22.15, `module.register` before
 *      that (both are Node built-ins; ZERO external dependencies);
 *   2. dynamically import the workbench modules (dynamic, so the shim is
 *      guaranteed to be in place before any TypeScript is resolved):
 *      the seeded corpus builder (corpus.mjs — instantiates the domain
 *      packages' public APIs, the expert-matching reference fabric and
 *      the job-orchestrator reference flow), the pure router from
 *      @arena/workbench, and the node:http transport (server.ts);
 *   3. wire them together: the pure `handleWorkbenchRequest` closes over
 *      the frozen corpus and is injected into the transport;
 *   4. serve the read-only workbench.
 *
 * Environment:
 *   - $ARENA_WORKBENCH_PORT (default 8788): the listen port;
 *   - $ARENA_WORKBENCH_EXPERT_SUPPLY (default 'up'): set to 'down' to
 *     boot the reference server in the R41 degraded mode (the expert
 *     supply is marked unavailable and the directory serves its
 *     last-known state with the degradation banner).
 *
 * `startWorkbench()` is exported for programmatic use (tests, embedders);
 * running this file directly starts a server on 127.0.0.1.
 */

import * as nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// 1. TypeScript resolution shim (.js → .ts remap for workspace sources)
// ---------------------------------------------------------------------------

const workbenchDir = new URL('.', import.meta.url);

if (typeof nodeModule.registerHooks === 'function') {
  // Node >= 22.15: synchronous in-process hooks.
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (typeof specifier === 'string' && specifier.endsWith('.js')) {
          try {
            return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
          } catch {
            // No .ts sibling — surface the original resolution error.
          }
        }
        throw error;
      }
    },
  });
} else {
  // Node 22.0-22.14: the thread-based loader registry.
  nodeModule.register(new URL('./loader.mjs', workbenchDir));
}

// ---------------------------------------------------------------------------
// 2-4. Workbench bootstrap (dynamic imports AFTER the shim is registered)
// ---------------------------------------------------------------------------

/**
 * Build the seeded corpus, wire the pure router into the node:http
 * transport and start the workbench server.
 *
 * @param {{port?: number, host?: string, expertSupply?: 'up' | 'down'}} [options]
 * @returns {Promise<import('./server.ts').RunningWorkbench>} the running workbench handle
 */
export async function startWorkbench(options = {}) {
  const { buildWorkbenchCorpus } = await import('./corpus.mjs');
  const { handleWorkbenchRequest } = await import(
    '../../../../packages/workbench/src/index.js'
  );
  const { startWorkbenchServer } = await import('./server.ts');

  const expertSupply = options.expertSupply ?? 'up';
  const corpus = await buildWorkbenchCorpus({ expertSupply });
  // The pure router closes over the frozen corpus: every request renders
  // from the same read-only reference state.
  const handler = (request) => handleWorkbenchRequest(request, corpus);
  return startWorkbenchServer(handler, options);
}

/** True when this module is the process entry point. */
function isMainEntryPoint() {
  const entry = process.argv[1];
  if (typeof entry !== 'string') return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainEntryPoint()) {
  const portArg = Number.parseInt(process.env.ARENA_WORKBENCH_PORT ?? '', 10);
  const port = Number.isFinite(portArg) ? portArg : undefined;
  const expertSupply =
    process.env.ARENA_WORKBENCH_EXPERT_SUPPLY === 'down' ? 'down' : 'up';
  startWorkbench({ port, expertSupply })
    .then((running) => {
      process.stdout.write(
        `[arena-workbench] read-only expert workbench listening on ${running.url}\n` +
          '[arena-workbench] routes: / /experts /tasks /trajectories /trajectories/<trajectoryId> /jobs\n' +
          `[arena-workbench] expert supply: ${expertSupply === 'up' ? 'available' : 'UNAVAILABLE — serving last-known state (R41 degraded mode)'}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`[arena-workbench] FAILED to start: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
