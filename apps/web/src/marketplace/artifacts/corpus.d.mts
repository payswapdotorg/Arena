/**
 * Type surface for the (JavaScript) marketplace modules — see corpus.mjs
 * and router.mjs for why the implementations ship as .mjs.
 *
 * This declaration file is DELIBERATELY self-contained (no workspace
 * imports): the app-level tsconfig builds every non-test .ts/.d.mts
 * under src/ with rootDir=src, and a compiled-in type import of another
 * workspace's source would break that build. The precise corpus shape
 * is asserted structurally at the typed test boundary
 * (marketplace.test.ts).
 */

/** The seeded marketplace corpus (views projected by corpus.mjs). */
export type SeededMarketplaceCorpus = unknown;

/** Build the deep-frozen, byte-deterministic seeded corpus. */
export function buildMarketplaceCorpus(): Promise<SeededMarketplaceCorpus>;

/** The demo tenant every seeded public listing lives under. */
export const SEED_TENANT: string;

/** The seeded dataset offer id (the profile route's addressable id). */
export const SEED_DATASET_OFFER_ID: string;

/** The seeded (tenant-internal) environment offer id. */
export const SEED_ENVIRONMENT_OFFER_ID: string;
