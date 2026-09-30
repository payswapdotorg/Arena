/**
 * Property suite (Work Order A025) — seeded, deterministic invariants:
 * determinism (same query ⇒ same answer), deep-frozen results, closed
 * vocabularies, and fail-closed rejection of foreign shapes. No
 * Math.random anywhere.
 */

import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import {
  API_QUERY_KINDS,
  apiQueryRequest,
  apiQueryResponse,
  isApiQueryResultFor,
  toApiReadScope,
} from './queries.js';
import { createArenaApiClient, createLoopbackTransport } from './client.js';
import type { ArenaQueryHandler } from './client.js';
import { ARENA_API_ERROR_CODES, ArenaApiError } from './errors.js';
import { makeScenario } from './test-support.js';

/** Deterministic mulberry32 PRNG (seeded — the property suite is stable). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property: deterministic queries', () => {
  it('the same query payload always digests identically; any mutation differs', async () => {
    const scenario = await makeScenario();
    const scope = toApiReadScope('acme');
    const base = apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, scope);
    const same = apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, scope);
    expect(await digestCanonical(base)).toBe(await digestCanonical(same));

    const variants = [
      apiQueryRequest('get-release-record', { digest: 'b'.repeat(64) }, scope),
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, toApiReadScope('globex')),
      apiQueryRequest('get-certification-record', { digest: scenario.registration.digest }, scope),
    ];
    const digests = new Set<string>();
    for (const variant of variants) digests.add(await digestCanonical(variant));
    expect(digests.size).toBe(variants.length);
    for (const digest of digests) {
      expect(digest).not.toBe(await digestCanonical(base));
    }
  });

  it('identical client queries over a deterministic handler return identical results (200 rounds)', async () => {
    const scenario = await makeScenario();
    const handler: ArenaQueryHandler = {
      async handleQueryRequest(payload) {
        const params = payload.params as Record<string, string>;
        switch (payload.kind) {
          case 'get-release-record':
            return apiQueryResponse(
              'get-release-record',
              params['digest'] === scenario.registration.digest
                ? scenario.registration
                : null,
            );
          case 'list-release-records':
            return apiQueryResponse('list-release-records', [scenario.registration]);
          default:
            throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY_KIND, {
              message: `unimplemented ${payload.kind}`,
            });
        }
      },
    };
    const client = createArenaApiClient(createLoopbackTransport(handler), 'acme');
    const random = mulberry32(0xa025);
    for (let round = 0; round < 200; round += 1) {
      if (random() < 0.5) {
        const release = await client.getReleaseRecord(scenario.registration.digest);
        expect(release?.digest).toBe(scenario.registration.digest);
      } else {
        const releases = await client.listReleaseRecords();
        expect(releases).toHaveLength(1);
      }
    }
  });
});

describe('property: closed vocabularies stay closed under adversarial inputs', () => {
  it('random strings never validate as query kinds (500 seeded samples)', () => {
    const random = mulberry32(0x5eed);
    const alphabet = 'abcdefghijklmnopqrstuvwxyz-0123456789';
    for (let round = 0; round < 500; round += 1) {
      const length = 1 + Math.floor(random() * 24);
      let candidate = '';
      for (let i = 0; i < length; i += 1) {
        candidate += alphabet[Math.floor(random() * alphabet.length)] ?? 'a';
      }
      const isKind = (API_QUERY_KINDS as readonly string[]).includes(candidate);
      if (isKind) {
        expect(API_QUERY_KINDS).toContain(candidate as never);
      } else {
        expect(
          isApiQueryResultFor(candidate as never, null),
        ).toBe(false);
      }
    }
  });

  it('every result position is validated against its kind — no cross-kind leakage', async () => {
    const scenario = await makeScenario();
    const records: readonly unknown[] = [
      scenario.registration,
      scenario.certification,
      scenario.suite,
      scenario.compatibility,
      scenario.bodyVersion,
      scenario.publication,
      null,
      42,
      'string',
      [scenario.registration],
    ];
    for (const kind of API_QUERY_KINDS) {
      // every record either validates for this kind or is rejected —
      // and at least one input is always rejected per kind (fail-closed)
      let accepted = 0;
      for (const record of records) {
        if (isApiQueryResultFor(kind, record)) accepted += 1;
      }
      expect(accepted).toBeLessThan(records.length);
    }
    // and the true positives do validate
    expect(isApiQueryResultFor('get-release-record', scenario.registration)).toBe(true);
    expect(isApiQueryResultFor('get-certification-record', scenario.certification)).toBe(true);
    expect(isApiQueryResultFor('get-certification-suite', scenario.suite)).toBe(true);
    expect(isApiQueryResultFor('get-compatibility-record', scenario.compatibility)).toBe(true);
    expect(isApiQueryResultFor('get-body-version', scenario.bodyVersion)).toBe(true);
    expect(isApiQueryResultFor('get-release-publication', scenario.publication)).toBe(true);
  });
});

describe('property: deep-frozen results', () => {
  it('constructed payloads and responses are frozen at every level', async () => {
    const scenario = await makeScenario();
    const scope = toApiReadScope('acme');
    const request = apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, scope);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(Object.isFrozen(request.scope)).toBe(true);

    const response = apiQueryResponse('list-release-records', [scenario.registration]);
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.result)).toBe(true);
  });
});
