/**
 * Type surface for the (JavaScript) seeded-corpus builder — see
 * corpus.mjs for why the implementation ships as .mjs.
 *
 * This declaration file is DELIBERATELY self-contained (no workspace
 * imports): the app-level tsconfig builds every non-test .ts/.d.mts under
 * src/ with rootDir=src, and a compiled-in type import of another
 * workspace's source would break that build. The precise corpus shape —
 * @arena/control-ui's `ConsoleCorpus` — is applied at the typed test
 * boundary (console.test.ts) with a single cast, where every invariant is
 * asserted.
 */

/** The seeded corpus (the exact @arena/control-ui ConsoleCorpus shape; see console.test.ts). */
export type SeededConsoleCorpus = unknown;

/** Build the deep-frozen, byte-deterministic seeded corpus. */
export function buildConsoleCorpus(): Promise<SeededConsoleCorpus>;

/** The demo tenant every seeded record lives in. */
export const SEED_TENANT: string;

/** The seeded run id (the trajectory route's addressable id). */
export const SEED_RUN_ID: string;

/** The seeded job ids, in store insertion order. */
export const SEED_JOB_IDS: readonly [string, string, string];
