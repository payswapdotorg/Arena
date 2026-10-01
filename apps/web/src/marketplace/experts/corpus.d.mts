/**
 * Type surface for the (JavaScript) seeded-corpus builder — see
 * corpus.mjs for why the implementation ships as .mjs (the A017/A018
 * corpus.d.mts pattern, self-contained with no workspace imports).
 */

/** The seeded corpus (the exact MarketplaceCorpus shape of router.ts; see marketplace.test.ts). */
export type SeededMarketplaceCorpus = unknown;

/** Build the deep-frozen, byte-deterministic seeded corpus. */
export function buildMarketplaceCorpus(): Promise<SeededMarketplaceCorpus>;

/** The demo tenant every seeded record lives in. */
export const SEED_TENANT: string;

/** The seeded expert id. */
export const SEED_EXPERT_ID: string;

/** The seeded listing id (the listing route's addressable id). */
export const SEED_LISTING_ID: string;

/** The seeded engagement id. */
export const SEED_ENGAGEMENT_ID: string;
