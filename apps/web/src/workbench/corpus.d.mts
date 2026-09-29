/**
 * Type surface for the (JavaScript) seeded-corpus builder — see
 * corpus.mjs for why the implementation ships as .mjs. Mirrors the A018
 * console's corpus.d.mts convention.
 *
 * This declaration file is DELIBERATELY self-contained (no workspace
 * imports): the app-level tsconfig builds every non-test .ts/.d.mts under
 * src/ with rootDir=src, and a compiled-in type import of another
 * workspace's source would break that build. The precise corpus shape —
 * @arena/workbench's `WorkbenchCorpus` — is applied at the typed test
 * boundary (workbench.test.ts) with a single cast, where every invariant
 * is asserted.
 */

/** The seeded corpus (the exact @arena/workbench WorkbenchCorpus shape; see workbench.test.ts). */
export type SeededWorkbenchCorpus = unknown;

/** Build the deep-frozen, byte-deterministic seeded corpus. */
export function buildWorkbenchCorpus(options?: {
  expertSupply?: 'up' | 'down';
}): Promise<SeededWorkbenchCorpus>;

/** The demo tenant every seeded record lives in. */
export const SEED_TENANT: string;

/** The seeded expert ids, in registry listing order. */
export const SEED_EXPERT_IDS: readonly [string, string];

/** The seeded trajectory ids (the detail route's addressable ids). */
export const SEED_TRAJECTORY_IDS: readonly [string, string];

/** The seeded job ids, in store insertion order. */
export const SEED_JOB_IDS: readonly [string, string, string];

/** When the last-known snapshot was captured (the degraded-mode marker). */
export const SEED_LAST_KNOWN_AT: string;
