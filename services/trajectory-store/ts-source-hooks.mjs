/**
 * ESM resolve hook for the A011 demo entry (main.mjs).
 *
 * The Arena workspace packages export their TypeScript SOURCES
 * (exports map → ./src/index.ts) so typecheck/vitest resolve them
 * directly; plain `node` cannot load them because NodeNext imports
 * carry `.js` specifiers for `.ts` files. Under
 * `node --experimental-strip-types` the TypeScript loads fine — this
 * hook adds the ONLY missing piece: remap a `.js` specifier to its
 * `.ts` source when the `.js` file does not exist.
 *
 * Zero dependencies; used ONLY by the demo entry (main.mjs) — the
 * package's programmatic API is unaffected. (Mirrors
 * services/environment-runner's ts-source-hooks.mjs verbatim.)
 */

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      typeof specifier === 'string' &&
      specifier.endsWith('.js') &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'ERR_UNSUPPORTED_DIR_IMPORT')
    ) {
      return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
