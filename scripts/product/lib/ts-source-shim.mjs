/**
 * TypeScript source shim registration (Work Order B016).
 *
 * Registers the `.js` → `.ts` resolve hook (see ts-loader.mjs) exactly the
 * way the A018 console does:
 *
 *   - node:module.registerHooks — synchronous in-process hooks on
 *     Node >= 22.15 (preferred);
 *   - node:module.register — the thread-based loader registry on older
 *     Node 22 releases (awaited so the hook is guaranteed to be in place
 *     before the first TypeScript dynamic import).
 *
 * Idempotent: safe to call from every entry point; only the first call
 * registers. Plain .mjs — zero external dependencies.
 */

import * as nodeModule from 'node:module';

let registered = false;

/**
 * Ensure the .js → .ts resolve shim is registered.
 *
 * @returns {Promise<void>} resolves once the hook is active.
 */
export async function ensureTsSourceShim() {
  if (registered) return;
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
    registered = true;
    return;
  }
  // Node 22.0-22.14: the thread-based loader registry.
  await nodeModule.register(new URL('./ts-loader.mjs', import.meta.url));
  registered = true;
}
