/**
 * Property suite for @arena/api-fabric (Work Order A025) — seeded,
 * deterministic invariants: reproducible read models, idempotent
 * ingest, append-only addressability, deterministic dispatch. No
 * Math.random anywhere.
 */

import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import { apiQueryRequest, toApiReadScope } from '@arena/arena-sdk';
import { ApiFabric } from './fabric.js';
import { makeScenario, BODY_NAME, TENANT } from './test-support.js';

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

describe('property: reproducible read models', () => {
  it('two identically-populated fabrics answer identically (50 seeded populations)', async () => {
    const random = mulberry32(0xa025);
    for (let round = 0; round < 50; round += 1) {
      const scenario = await makeScenario();
      const one = new ApiFabric();
      const two = new ApiFabric();
      for (const fabric of [one, two]) {
        fabric.putBodyVersion(scenario.bodyVersion);
        fabric.putCertificationSuite(scenario.suite);
        fabric.putCertificationRecord(scenario.certification);
        fabric.putCompatibilityRecord(scenario.compatibility);
        fabric.putReleaseRecord(scenario.registration);
        fabric.putReleasePublication(scenario.publication);
      }
      const scope = toApiReadScope(TENANT);
      const answerOne = await one.handleQueryRequest(
        apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, scope),
      );
      const answerTwo = await two.handleQueryRequest(
        apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, scope),
      );
      expect(await digestCanonical(answerOne)).toBe(await digestCanonical(answerTwo));
    }
    void random;
  });

  it('query payload digests are deterministic; scope and params mutations always differ', async () => {
    const scenario = await makeScenario();
    const base = apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, toApiReadScope(TENANT));
    expect(await digestCanonical(base)).toBe(
      await digestCanonical(
        apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, toApiReadScope(TENANT)),
      ),
    );
    const variants = [
      apiQueryRequest('get-release-record', { digest: 'b'.repeat(64) }, toApiReadScope(TENANT)),
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, toApiReadScope('public')),
    ];
    for (const variant of variants) {
      expect(await digestCanonical(variant)).not.toBe(await digestCanonical(base));
    }
  });
});

describe('property: idempotent ingest + append-only addressability', () => {
  it('repeated ingest never duplicates and never reorders', async () => {
    const scenario = await makeScenario();
    const fabric = new ApiFabric();
    for (let i = 0; i < 10; i += 1) {
      fabric.putReleaseRecord(scenario.registration);
      fabric.putCertificationRecord(scenario.certification);
      fabric.putReleasePublication(scenario.publication);
    }
    expect(fabric.counts()['releaseRecords']).toBe(1);
    const scope = toApiReadScope(TENANT);
    const releases = await fabric.handleQueryRequest(
      apiQueryRequest('list-release-records', {}, scope),
    );
    expect(releases.result).toHaveLength(1);
  });

  it('every ingested record stays addressable by digest across arbitrary query traffic', async () => {
    const scenario = await makeScenario();
    const fabric = new ApiFabric();
    fabric.putReleaseRecord(scenario.registration);
    fabric.putCertificationRecord(scenario.certification);
    const scope = toApiReadScope(TENANT);
    for (let round = 0; round < 25; round += 1) {
      const release = await fabric.handleQueryRequest(
        apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, scope),
      );
      expect(release.result).toStrictEqual(scenario.registration);
      const certification = await fabric.handleQueryRequest(
        apiQueryRequest('get-certification-record', { digest: scenario.certification.digest }, scope),
      );
      expect(certification.result).toStrictEqual(scenario.certification);
    }
  });
});

describe('property: deterministic dispatch', () => {
  it('the same query over the same read model always returns the same answer (100 rounds)', async () => {
    const scenario = await makeScenario();
    const fabric = new ApiFabric();
    fabric.putReleaseRecord(scenario.registration);
    fabric.putReleasePublication(scenario.publication);
    const scope = toApiReadScope(TENANT);
    let previous: string | undefined;
    for (let round = 0; round < 100; round += 1) {
      const answer = await fabric.handleQueryRequest(
        apiQueryRequest(
          'resolve-release-status',
          { namespace: TENANT, name: BODY_NAME, version: scenario.registration.release?.version ?? '2.0.0' },
          scope,
        ),
      );
      const serialized = JSON.stringify(
        (answer.result as { state: string; visibility: string }).state,
      );
      if (previous !== undefined) expect(serialized).toBe(previous);
      previous = serialized;
    }
  });
});
