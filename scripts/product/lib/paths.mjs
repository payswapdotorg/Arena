/**
 * Repository-root resolution for the product scripts (Work Order B016).
 *
 * Two roots, deliberately distinct:
 *
 *   - MODULE_REPO_ROOT — the repository this script tree lives in,
 *     computed from this file's own URL (NEVER the current working
 *     directory, so the commands work from anywhere). Used to load the
 *     workspace TypeScript sources.
 *   - resolveRepoRoot() — the root used for STATE and CACHE paths.
 *     Same value by default; overridable through the ARENA_PRODUCT_REPO_ROOT
 *     environment variable, which exists ONLY as a test seam (the reset
 *     totality tests run the real command against a scratch tree). It is
 *     documented in scripts/product/README.md and never set in product use.
 *
 * Plain .mjs (node: builtins only) — zero external dependencies, exactly
 * like the rest of scripts/product.
 */

import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';

/** This file: <repo>/scripts/product/lib/paths.mjs → repo root is four levels up. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The repository the product scripts shipped in (module-URL derived). */
export const MODULE_REPO_ROOT = resolve(THIS_FILE, '..', '..', '..', '..');

/** Test seam environment variable (see header; never set in product use). */
export const REPO_ROOT_ENV_VAR = 'ARENA_PRODUCT_REPO_ROOT';

/**
 * Resolve the repository root for state/cache paths.
 *
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {string} absolute repository root path
 */
export function resolveRepoRoot(options = {}) {
  const env = options.env ?? process.env;
  const override = env[REPO_ROOT_ENV_VAR];
  if (typeof override === 'string' && override.length > 0) {
    return isAbsolute(override) ? override : resolve(process.cwd(), override);
  }
  return MODULE_REPO_ROOT;
}
