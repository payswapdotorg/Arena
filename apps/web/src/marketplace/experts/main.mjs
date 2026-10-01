/**
 * The Arena expert marketplace entry (Work Order A031) — the A017/A018
 * bootstrap pattern, replicated for the marketplace surface.
 *
 * Run with:
 *
 *   node --experimental-strip-types apps/web/src/marketplace/experts/main.mjs
 *
 * (from the repository root; Node >= 22.6 with type stripping — on
 * Node >= 22.18 type stripping is on by default and the flag is a no-op).
 *
 * Startup, in order:
 *   1. register the `.js` → `.ts` resolution shim (loader.mjs) so the
 *      workspace packages' TypeScript sources load directly;
 *   2. dynamically import the corpus builder (corpus.mjs) and the pure
 *      router + node:http transport (router.ts / server.ts);
 *   3. wire them together: the pure `handleMarketplaceRequest` closes
 *      over the frozen corpus and is injected into the transport;
 *   4. serve the read-only marketplace.
 *
 * `startMarketplace()` is exported for programmatic use (tests,
 * embedders); running this file directly starts a server on
 * $ARENA_MARKETPLACE_PORT (default 8791) at 127.0.0.1.
 */

import * as nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// 1. TypeScript resolution shim (.js → .ts remap for workspace sources)
// ---------------------------------------------------------------------------

const marketplaceDir = new URL('.', import.meta.url);

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
            // No .ts sibling either — surface the original resolution error.
          }
        }
        throw error;
      }
    },
  });
} else {
  // Node 22.0-22.14: the thread-based loader registry.
  nodeModule.register(new URL('./loader.mjs', marketplaceDir));
}

// ---------------------------------------------------------------------------
// 2-4. Marketplace bootstrap (dynamic imports AFTER the shim is registered)
// ---------------------------------------------------------------------------

/**
 * Build the seeded corpus, wire the pure router into the node:http
 * transport and start the marketplace server.
 *
 * @param {{port?: number, host?: string}} [options]
 * @returns {Promise<import('./server.ts').RunningMarketplace>}
 */
export async function startMarketplace(options = {}) {
  const { buildMarketplaceCorpus } = await import('./corpus.mjs');
  const { handleMarketplaceRequest } = await import('./router.js');
  const { startMarketplaceServer } = await import('./server.ts');

  const corpus = await buildMarketplaceCorpus();
  // The pure router closes over the frozen corpus: every request renders
  // from the same read-only reference state.
  const handler = (request) => handleMarketplaceRequest(request, corpus);
  return startMarketplaceServer(handler, options);
}

/** True when this module is the process entry point. */
function isMainEntryPoint() {
  const entry = process.argv[1];
  if (typeof entry !== 'string') return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainEntryPoint()) {
  const portArg = Number.parseInt(process.env.ARENA_MARKETPLACE_PORT ?? '', 10);
  const port = Number.isFinite(portArg) ? portArg : undefined;
  startMarketplace({ port })
    .then((running) => {
      process.stdout.write(
        `[arena-marketplace] read-only expert marketplace listening on ${running.url}\n` +
          '[arena-marketplace] routes: / /listings/<listingId> /engagements\n',
      );
    })
    .catch((error) => {
      process.stderr.write(`[arena-marketplace] FAILED to start: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
