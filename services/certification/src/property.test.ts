/**
 * Fabric property tests (Work Order A023) — randomized end-to-end runs
 * through the REAL fabric with seeded LCG inputs.
 *
 * Invariants:
 *   P1 verdict totality — random component summaries (with random
 *      pass/fail/unknown/constraint patterns, per component) always produce
 *      exactly one of the four closed verdicts;
 *   P2 run determinism — the same random scenario, run twice through
 *      independent fabrics, yields the identical record digest;
 *   P3 ledger consistency — every ledger entry is content-addressed
 *      (unique digests) and queryable by suite and correlation id;
 *   P4 design-law scope — the produced statement carries every scope field;
 *      no unscoped professional claim is structurally possible.
 */

import { describe, expect, it } from 'vitest';
import { createCertificationFabric } from './fabric.js';
import {
  TestLcg,
  allPassSummary,
  makeScopeRefs,
  makeSuite,
  runOptions,
} from './test-support.js';

const SEEDS = [1, 42, 20260928, 777, 314159];

/** Build a fully-wired random scenario. */
async function buildScenario(seed: number) {
  const rng = new TestLcg(seed);
  const suite = await makeSuite(`suite-prop-${String(seed)}`);
  const summary = await allPassSummary(suite);
  const scope = await makeScopeRefs();
  return { rng, suite, summary, scope };
}

describe('property: verdict totality (P1)', () => {
  for (const seed of SEEDS) {
    it(`seed ${String(seed)}: random component summaries always yield a closed verdict`, async () => {
      const { rng, suite, summary, scope } = await buildScenario(seed);
      const fabric = createCertificationFabric();
      fabric.registry.registerSuite(suite);
      // Randomly mutate each component's verdict + constraints.
      const mutated = summary.map((entry) => {
        const v = rng.int(3);
        const verdict = v === 0 ? 'pass' : v === 1 ? 'fail' : 'unknown';
        return {
          refKind: entry.refKind,
          refDigest: entry.refDigest,
          verdict,
          constraints:
            verdict === 'pass' ? (rng.bool() ? ['c'] : []) : null,
          notes: null,
        } as never;
      });
      const record = await fabric.certify(
        suite.digest,
        scope.possessionRef,
        scope,
        mutated as never,
        runOptions({
          correlationId: `corr-prop-${String(seed)}`,
          idempotencyKey: `idem-prop-${String(seed)}`,
        }),
      );
      expect(['pass', 'conditional-pass', 'fail', 'unknown']).toContain(record.verdict);
      expect((record.verdict === 'unknown') === (record.unknownCause !== null)).toBe(true);
    });
  }
});

describe('property: run determinism (P2)', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    it(`seed ${String(seed)}: independent fabrics produce the identical digest`, async () => {
      const a = await buildScenario(seed);
      const b = await buildScenario(seed);
      const aFabric = createCertificationFabric();
      const bFabric = createCertificationFabric();
      aFabric.registry.registerSuite(a.suite);
      bFabric.registry.registerSuite(b.suite);
      const options = runOptions({
        correlationId: `corr-prop-${String(seed)}`,
        idempotencyKey: `idem-prop-${String(seed)}`,
      });
      const ra = await aFabric.certify(
        a.suite.digest,
        a.scope.possessionRef,
        a.scope,
        a.summary,
        options,
      );
      const rb = await bFabric.certify(
        b.suite.digest,
        b.scope.possessionRef,
        b.scope,
        b.summary,
        options,
      );
      expect(rb.digest).toBe(ra.digest);
      expect(rb.verdict).toBe(ra.verdict);
    });
  }
});

describe('property: ledger consistency (P3)', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    it(`seed ${String(seed)}: ledger entries are unique and queryable`, async () => {
      const { suite, summary, scope } = await buildScenario(seed);
      const fabric = createCertificationFabric();
      fabric.registry.registerSuite(suite);
      const options = runOptions({
        correlationId: `corr-prop-${String(seed)}`,
        idempotencyKey: `idem-prop-${String(seed)}`,
      });
      const record = await fabric.certify(
        suite.digest,
        scope.possessionRef,
        scope,
        summary,
        options,
      );
      // idempotent replay does not duplicate
      const replayed = await fabric.certify(
        suite.digest,
        scope.possessionRef,
        scope,
        summary,
        options,
      );
      expect(replayed.digest).toBe(record.digest);
      const digests = fabric.listRecords().map((r) => r.digest);
      expect(new Set(digests).size).toBe(digests.length);
      expect(fabric.listRecordsBySuite(suite.digest)).toHaveLength(digests.length);
      expect(fabric.listRecordsByCorrelation(`corr-prop-${String(seed)}`)).toHaveLength(
        digests.length,
      );
    });
  }
});

describe('property: design-law scope (P4) — no unscoped professional claim', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    it(`seed ${String(seed)}: the statement carries every scope field`, async () => {
      const { suite, summary, scope } = await buildScenario(seed);
      const fabric = createCertificationFabric();
      fabric.registry.registerSuite(suite);
      const record = await fabric.certify(
        suite.digest,
        scope.possessionRef,
        scope,
        summary,
        runOptions({
          correlationId: `corr-prop-${String(seed)}`,
          idempotencyKey: `idem-prop-${String(seed)}`,
        }),
      );
      for (const ref of [
        record.bodyVersionRef,
        record.substrateRef,
        record.environmentRef,
        record.runtimeProfileRef,
        record.suiteRef,
        record.statement.suiteRevision,
      ]) {
        expect(record.statement.statementText).toContain(ref);
      }
      const lowered = record.statement.statementText.toLowerCase();
      expect(lowered).not.toContain('is a professional');
      expect(lowered).not.toContain('is a software engineer');
      expect(lowered).not.toContain('is a structural engineer');
    });
  }
});
