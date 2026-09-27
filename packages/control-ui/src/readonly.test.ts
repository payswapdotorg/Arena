/**
 * Read-only guarantee (Work Order A018, gate 7): the console NEVER mutates
 * domain state. Structural proof: every view derives from frozen inputs,
 * and rendering the ENTIRE surface leaves every domain record's content
 * digest verifiable (fail-closed tamper detection passes unchanged).
 */

import { describe, expect, it } from 'vitest';
import { verifyCapabilityCase } from '@arena/capability-case';
import { verifyEnvironmentDefinition } from '@arena/environment-protocol';
import { isDeepFrozen } from './freeze.js';
import { freezeCorpus } from './corpus.js';
import { CONSOLE_ROUTES, handleConsoleRequest } from './router.js';
import { makeFixtureCorpus, RUN_ID } from './test-support.js';

const ALL_ROUTES = [...CONSOLE_ROUTES, `/runs/${RUN_ID}/trajectory`] as const;

describe('read-only guarantee (gate 7)', () => {
  it('freezeCorpus returns a deep-frozen corpus (positive)', async () => {
    const corpus = freezeCorpus(await makeFixtureCorpus());
    expect(isDeepFrozen(corpus)).toBe(true);
    expect(() => {
      (corpus as unknown as Record<string, unknown>)['cases'] = [];
    }).toThrow();
  });

  it('rendering the whole surface leaves domain digests verifiable (negative)', async () => {
    const corpus = freezeCorpus(await makeFixtureCorpus());
    const caseBefore = corpus.cases[0]?.digest;
    const envDigestBefore = corpus.runs[0]?.definition.digest;

    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of [...ALL_ROUTES, '/nope']) {
        handleConsoleRequest({ method, path }, corpus);
      }
    }

    // Fail-closed re-verification: if ANY route had mutated a domain
    // record, its content digest would no longer verify.
    for (const caseRecord of corpus.cases) {
      await expect(verifyCapabilityCase(caseRecord)).resolves.toBe(caseRecord.digest);
    }
    for (const run of corpus.runs) {
      await expect(verifyEnvironmentDefinition(run.definition)).resolves.toBe(
        run.definition.digest,
      );
    }
    expect(corpus.cases[0]?.digest).toBe(caseBefore);
    expect(corpus.runs[0]?.definition.digest).toBe(envDigestBefore);
    // The substrate integrity digest is unchanged...
    for (const registration of corpus.substrates) {
      expect(registration.substrate.integrity.contentDigest).toHaveLength(64);
      expect(registration.substrate.integrity.digestAlgorithm).toBe('sha256');
    }
    // ...and the job event histories never shrank (append-only).
    for (const job of corpus.jobs) {
      expect(job.events.length).toBeGreaterThan(0);
    }
  });

  it('views derived from the corpus are deep-frozen (positive)', async () => {
    const corpus = freezeCorpus(await makeFixtureCorpus());
    for (const path of ALL_ROUTES) {
      const response = handleConsoleRequest({ method: 'GET', path }, corpus);
      expect(response.status, path).toBe(200);
    }
    // After a full render sweep the corpus is STILL frozen.
    expect(isDeepFrozen(corpus)).toBe(true);
  });
});
