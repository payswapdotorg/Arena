import { describe, expect, it } from 'vitest';

/**
 * Marketplace corpus tests (Work Order B013) — the house style: plain node
 * environment, REAL package gates (A031 qualification gate, A032 admission
 * gate + license/data-rights paths, A033 grant constructors), fixed
 * timestamps and digests. The corpus drives the real services; nothing is
 * fabricated.
 */

import {
  asRecord,
  entitlementStateFromGrantRecord,
  entitlementStateFromMarketplaceGrant,
  readString,
} from '../../../../packages/marketplace-ui/src/index.js';
import {
  buildMarketplaceCorpus,
  SEED_DATASET_OFFER_ID,
  SEED_ENVIRONMENT_OFFER_ID,
  SEED_EXPERT_LISTING_ID,
  SEED_SUITE_OFFER_ID,
} from './corpus.js';
import type { MarketplaceCorpus } from './corpus.js';

const EVALUATED_AT = '2026-10-01T08:00:00.000Z';

async function seededCorpus(): Promise<MarketplaceCorpus> {
  return buildMarketplaceCorpus({
    tenant: 'tenant-a',
    secondaryTenant: 'tenant-b',
    evaluatedAt: EVALUATED_AT,
    mode: 'session',
  });
}

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((entry) => isDeepFrozen(entry));
}

describe('marketplace corpus (B013 — the real package gates drive the data)', () => {
  it('builds the expert listing through the REAL A031 qualification gate (positive)', async () => {
    const corpus = await seededCorpus();
    expect(corpus.expertListings).toHaveLength(1);
    const listing = asRecord(corpus.expertListings[0]);
    expect(readString(listing, 'listingId')).toBe(SEED_EXPERT_LISTING_ID);
    expect(readString(listing, 'tenant')).toBe('tenant-a');
    const proofs = listing['qualificationProofs'];
    expect(Array.isArray(proofs) && proofs).toHaveLength(1);
    const proof = asRecord((proofs as readonly unknown[])[0]);
    expect(proof['inForce']).toBe(true);
    const offers = listing['offers'];
    expect(Array.isArray(offers) && offers).toHaveLength(1);
    const offer = asRecord((offers as readonly unknown[])[0]);
    expect(offer['amountMinor']).toBe(12500);
    expect(offer['currency']).toBe('USD');
    expect(listing['engagements']).toBe(1);
    expect(listing['completed']).toBe(1);
    expect(listing['reviews']).toBe(1);
    expect(listing['averageRating']).toBe(5);
  });

  it('admits three gated artifact offers across the three artifact domains (positive)', async () => {
    const corpus = await seededCorpus();
    expect(corpus.artifactListings).toHaveLength(3);
    const offerIds = corpus.artifactListings.map(
      (listing) => readString(asRecord(listing), 'offerId'),
    );
    expect(offerIds).toEqual([SEED_DATASET_OFFER_ID, SEED_SUITE_OFFER_ID, SEED_ENVIRONMENT_OFFER_ID]);
    for (const listing of corpus.artifactListings) {
      const data = asRecord(listing);
      expect(data['state']).toBe('registered');
      expect(readString(data, 'offerDigest')).toMatch(/^[0-9a-f]{64}$/);
      const evidence = data['evidence'];
      expect(Array.isArray(evidence) && evidence).toHaveLength(2);
      const entries = evidence as readonly unknown[];
      expect(asRecord(entries[0])['kind']).toBe('provenance');
      expect(asRecord(entries[1])['outcome']).toBe('pass');
      expect(data['rights']).toBeDefined();
      expect(data['provenanceRecord']).toBeDefined();
    }
    // The dataset carries the full lineage chain for the detail view.
    const dataset = asRecord(corpus.artifactListings[0]);
    const provenance = asRecord(dataset['provenanceRecord']);
    expect(Array.isArray(provenance['parents']) && provenance['parents']).toHaveLength(1);
    expect(asRecord(provenance['transformation'])['inputs']).toHaveLength(1);
  });

  it('records the grant ledger through the real license paths: granted, revoked, expired (positive)', async () => {
    const corpus = await seededCorpus();
    const dataset = asRecord(corpus.artifactListings[0]);
    const grants = dataset['grants'] as readonly unknown[];
    expect(grants).toHaveLength(4);
    const states = grants.map((grant) =>
      entitlementStateFromMarketplaceGrant(grant, corpus.evaluatedAt).state,
    );
    expect(states).toContain('granted');
    expect(states).toContain('revoked');
    expect(states).toContain('expired');
    const revoked = grants.find(
      (grant) => entitlementStateFromMarketplaceGrant(grant, corpus.evaluatedAt).state === 'revoked',
    );
    expect(readString(asRecord(revoked), 'grounds')).toContain('licence review');
  });

  it('seeds the A033 entitlement state machine: granted, revoked, expired, pending (positive)', async () => {
    const corpus = await seededCorpus();
    expect(corpus.entitlementGrants).toHaveLength(4);
    const states = corpus.entitlementGrants.map((grant) =>
      entitlementStateFromGrantRecord(grant, corpus.evaluatedAt).state,
    );
    expect(new Set(states)).toEqual(new Set(['granted', 'revoked', 'expired', 'pending']));
  });

  it('is byte-deterministic across rebuilds (positive)', async () => {
    const first = await seededCorpus();
    const second = await seededCorpus();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('is deep-frozen (the read-only guarantee) (positive)', async () => {
    expect(isDeepFrozen(await seededCorpus())).toBe(true);
  });
});
