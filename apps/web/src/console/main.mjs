/**
 * The Arena control console entry (Work Order A018, gate 5).
 *
 * Run with:
 *
 *   node --experimental-strip-types apps/web/src/console/main.mjs
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
 *   2. dynamically import the console modules (dynamic, so the shim is
 *      guaranteed to be in place before any TypeScript is resolved):
 *      the seeded corpus builder (corpus.mjs — instantiates the domain
 *      packages' public APIs, the model-substrate reference adapters and
 *      the job-orchestrator reference flow), the pure router from
 *      @arena/control-ui, and the node:http transport (server.ts);
 *   3. wire them together: the pure `handleConsoleRequest` closes over
 *      the frozen corpus and is injected into the transport;
 *   4. serve the read-only console.
 *
 * `startConsole()` is exported for programmatic use (tests, embedders);
 * running this file directly starts a server on
 * $ARENA_CONSOLE_PORT (default 8787) at 127.0.0.1.
 */

import * as nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// 1. TypeScript resolution shim (.js → .ts remap for workspace sources)
// ---------------------------------------------------------------------------

const consoleDir = new URL('.', import.meta.url);

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
  nodeModule.register(new URL('./loader.mjs', consoleDir));
}

// ---------------------------------------------------------------------------
// 2-4. Console bootstrap (dynamic imports AFTER the shim is registered)
// ---------------------------------------------------------------------------

/**
 * Build the seeded corpus, wire the pure router into the node:http
 * transport and start the console server.
 *
 * @param {{port?: number, host?: string}} [options]
 * @returns {Promise<import('./server.ts').RunningConsole>} the running console handle
 */
export async function startConsole(options = {}) {
  const { buildConsoleCorpus } = await import('./corpus.mjs');
  const { handleConsoleRequest } = await import(
    '../../../../packages/control-ui/src/index.js'
  );
  const { startConsoleServer } = await import('./server.ts');

  const corpus = await buildConsoleCorpus();
  // The pure router closes over the frozen corpus: every request renders
  // from the same read-only reference state (gate 7).
  const handler = (request) => handleConsoleRequest(request, corpus);
  return startConsoleServer(handler, options);
}

/** True when this module is the process entry point. */
function isMainEntryPoint() {
  const entry = process.argv[1];
  if (typeof entry !== 'string') return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainEntryPoint()) {
  const portArg = Number.parseInt(process.env.ARENA_CONSOLE_PORT ?? '', 10);
  const port = Number.isFinite(portArg) ? portArg : undefined;
  startConsole({ port })
    .then((running) => {
      process.stdout.write(
        `[arena-console] read-only control console listening on ${running.url}\n` +
          '[arena-console] routes: / /cases /bodies /substrates /jobs /runs /runs/<runId>/trajectory\n',
      );
    })
    .catch((error) => {
      process.stderr.write(`[arena-console] FAILED to start: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
