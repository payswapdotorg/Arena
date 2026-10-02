/**
 * Local state layout for the Arena product scripts (Work Order B016).
 *
 * The LOCAL FAKE PERSISTENCE STORE lives in a single disposable directory
 * (`.arena-local/` under the repository root by default, overridable via
 * ARENA_LOCAL_STATE_DIR). It holds ONLY local fake state — the file-backed
 * B002 ControlPlaneRepository store plus tool metadata. It is NEVER
 * committed, NEVER a hosted/customer posture, and `reset` wipes it
 * totally.
 *
 * The reset wipe plan (state + caches, NEVER source) is also defined
 * here, as a pure function over injectable fs probes so the reset
 * totality tests can drive it against scratch trees.
 *
 * Plain .mjs — zero external dependencies.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveRepoRoot } from './paths.mjs';

/** Default local state directory name (repo root relative, uncommitted). */
export const DEFAULT_STATE_DIR_NAME = '.arena-local';

/** Environment override for the local state directory (documented product knob). */
export const STATE_DIR_ENV_VAR = 'ARENA_LOCAL_STATE_DIR';

/** Root-level tool caches the reset wipes (when present). */
export const ROOT_CACHE_NAMES = Object.freeze(['.turbo', 'coverage']);

/** Per-workspace-package generated outputs/caches the reset wipes (when present). */
export const WORKSPACE_CACHE_NAMES = Object.freeze(['dist', 'coverage', '.next']);

/** The pnpm workspace roots (mirrors pnpm-workspace.yaml packages globs). */
export const WORKSPACE_ROOTS = Object.freeze([
  'apps',
  'packages',
  'services',
  'adapters',
  'bodies',
  'environments',
]);

/**
 * Resolve the local state directory.
 *
 * @param {{ repoRoot?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {string} absolute state directory path
 */
export function resolveStateDir(options = {}) {
  const repoRoot = options.repoRoot ?? resolveRepoRoot({ env: options.env });
  const env = options.env ?? process.env;
  const override = env[STATE_DIR_ENV_VAR];
  if (typeof override === 'string' && override.length > 0) {
    return override;
  }
  return join(repoRoot, DEFAULT_STATE_DIR_NAME);
}

/**
 * The well-known paths inside the local state directory.
 *
 * @param {string} stateDir
 * @returns {{ dir: string, storeDir: string, storeFile: string }}
 */
export function statePaths(stateDir) {
  return {
    dir: stateDir,
    storeDir: join(stateDir, 'store'),
    storeFile: join(stateDir, 'store', 'control-plane.json'),
  };
}

/**
 * Build the reset wipe plan: LOCAL STATE + regenerable caches that exist
 * right now. Source, node_modules, the lockfile and git history are
 * NEVER in the plan — `reset` is total over local state, not over the
 * repository.
 *
 * @param {{ repoRoot: string, stateDir: string, exists?: (path: string) => boolean, readDir?: (path: string) => string[] }} options
 * @returns {{ path: string, label: string }[]} targets that exist, in stable order.
 */
export function buildWipePlan(options) {
  const exists = options.exists ?? existsSync;
  const readDir = options.readDir ?? ((path) => readdirSync(path));
  const targets = [];
  if (exists(options.stateDir)) {
    targets.push({
      path: options.stateDir,
      label: 'local fake persistence store + tool state',
    });
  }
  for (const name of ROOT_CACHE_NAMES) {
    const path = join(options.repoRoot, name);
    if (exists(path)) {
      targets.push({ path, label: `${name} cache (regenerable)` });
    }
  }
  for (const root of WORKSPACE_ROOTS) {
    const rootDir = join(options.repoRoot, root);
    if (!exists(rootDir)) continue;
    let children;
    try {
      children = readDir(rootDir);
    } catch {
      continue;
    }
    for (const child of [...children].sort()) {
      for (const name of WORKSPACE_CACHE_NAMES) {
        const path = join(rootDir, child, name);
        if (exists(path)) {
          targets.push({ path, label: `${root}/${child}/${name} generated output (regenerable)` });
        }
      }
    }
  }
  return targets;
}

/** The protected-paths line printed by reset (the honesty contract). */
export const RESET_PROTECTED_NOTE =
  'protected (never touched): source tree, node_modules, pnpm-lock.yaml, git history';
