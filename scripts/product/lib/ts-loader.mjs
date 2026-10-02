/**
 * The product scripts' TypeScript resolution shim (Work Order B016),
 * mirroring the A018 console loader (apps/web/src/console).
 *
 * The workspace packages publish their TypeScript source as their entry
 * (exports "." → ./src/index.ts) and their INTERNAL imports use the
 * NodeNext `.js`-extension convention against `.ts` files on disk. Node's
 * type stripping executes those sources, but (through Node 22) it does
 * not remap `.js` specifiers to `.ts` siblings during resolution — this
 * hook performs exactly that remap, and nothing else:
 *
 *   1. delegate to the default resolver;
 *   2. if resolution failed for a `.js` specifier, retry with the `.ts`
 *      sibling;
 *   3. otherwise rethrow the original error.
 *
 * Plain .mjs (no TypeScript) — loaded by ts-source-shim.mjs via
 * node:module before any TypeScript module is imported. ZERO external
 * dependencies.
 */

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (typeof specifier === 'string' && specifier.endsWith('.js')) {
      try {
        return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      } catch {
        // No .ts sibling either — surface the ORIGINAL resolution error.
      }
    }
    throw error;
  }
}
