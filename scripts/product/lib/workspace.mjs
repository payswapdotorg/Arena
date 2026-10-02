/**
 * Workspace module loading for the product scripts (Work Order B016).
 *
 * Loads the Arena workspace TypeScript sources (@arena/persistence and
 * @arena/demo) DIRECTLY from the packages' src directories through the
 * .js → .ts resolve
 * shim — the same execution model as the A018 console entry
 * (apps/web/src/console/main.mjs). This keeps the product scripts on the
 * SAME ports the application uses: the demo corpus, the DemoStore
 * lifecycle port and every persistence validator/error come from the
 * real packages, never a bespoke copy.
 *
 * The imports are DYNAMIC and happen only after ensureTsSourceShim() has
 * registered the resolver. The loaded module set is cached per process
 * (determinism-preserving, never a second authority).
 *
 * Plain .mjs — zero external dependencies.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MODULE_REPO_ROOT } from './paths.mjs';
import { ensureTsSourceShim } from './ts-source-shim.mjs';

/**
 * The workspace modules the product commands drive. `persistence` is the
 * B002 port layer (validators, error taxonomy, ManualClock, deepFreeze,
 * canonicalEqual); `demo` is the B006 deterministic demo corpus + the
 * DemoStore lifecycle port + THE labelling contract.
 *
 * @typedef {Record<string, any>} WorkspaceModules
 * @property {Record<string, any>} persistence — @arena/persistence public API
 * @property {Record<string, any>} demo — @arena/demo public API
 */

let modulesPromise = null;

/**
 * Load (and cache) the workspace modules the product commands need.
 *
 * @returns {Promise<WorkspaceModules>} frozen { persistence, demo }
 */
export async function loadArenaModules() {
  modulesPromise ??= (async () => {
    await ensureTsSourceShim();
    const persistence = await import(
      pathToFileURL(join(MODULE_REPO_ROOT, 'packages', 'persistence', 'src', 'index.js')).href
    );
    const demo = await import(
      pathToFileURL(join(MODULE_REPO_ROOT, 'packages', 'demo', 'src', 'index.js')).href
    );
    return Object.freeze({ persistence, demo });
  })();
  return modulesPromise;
}
