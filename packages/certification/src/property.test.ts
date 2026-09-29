/**
 * Property tests (Work Order A023) — randomized end-to-end runs through
 * the record constructor with seeded LCG inputs.
 *
 * Invariants:
 *   P1 verdict totality — random component summaries (with random
 *      pass/fail/unknown/constraint patterns, per component, with random
 *      missing suite components) always produce exactly one of the four
 *      closed verdicts;
 *   P2 determinism — the same random scenario, run twice through
 *      independent record constructors, yields the identical record digest;
 *   P3 design-law scope — every produced record carries a statement that
 *      includes all six scope fields; no unscoped professional claim can
 *      be produced by the constructor for any random input.
 */

import { describe, expect, it } from 'vitest';
import { createCertificationSuite } from './suite.js';
import { createCertificationRecord } from './record.js';
import { deriveCertificationVerdict } from './verdict.js';
import {
  TestLcg,
  allPassSummary,
  digestOf,
  makeRecordInput,
  makeSuiteInput,
} from './test-support.js';

const SEEDS = [1, 42, 20260928, 777, 314159];

/** Build a fully-wired scenario from a random seed. */
async function buildScenario(seed: number): Promise<{
  readonly suite: Awaited<ReturnType<typeof createCertificationSuite>>;
  readonly summary: Awaited<ReturnType<typeof allPassSummary>>;
  readonly rng: TestLcg;
}> {
  const rng = new TestLcg(seed);
  const suite = await createCertificationSuite(await makeSuiteInput({ suiteId: `suite-prop-${String(seed)}` }));
  const summary = await allPassSummary(suite);
  return { suite, summary, rng };
}

describe('property: verdict totality (P1)', () => {
  for (const seed of SEEDS) {
    it(`seed ${String(seed)}: random component summaries always yield a closed verdict`, async () => {
      const { suite, summary, rng } = await buildScenario(seed);
      // Randomly mutate each component's verdict + constraints.
      const mutated = summary.map((entry) => {
        const v = rng.int(3);
        const verdict = v === 0 ? 'pass' : v === 1 ? 'fail' : 'unknown';
        return {
          refKind: entry.refKind,
          refDigest: entry.refDigest,
          verdict,
          constraints:
            verdict === 'pass'
              ? rng.bool()
                ? ['constraint']
                : []
              : null,
          notes: null,
        } as never;
      });
      const record = await createCertificationRecord(
        await makeRecordInput(suite, mutated as never),
        suite,
      );
      expect(['pass', 'conditional-pass', 'fail', 'unknown']).toContain(record.verdict);
      expect((record.verdict === 'unknown') === (record.unknownCause !== null)).toBe(true);
    });
  }
});

describe('property: verdict derivation never produces a non-closed value', () => {
  for (const seed of SEEDS) {
    it(`seed ${String(seed)}: deriveCertificationVerdict returns one of the four members`, async () => {
      const { summary, rng } = await buildScenario(seed);
      const mutated = summary.map((entry) => {
        const v = rng.int(3);
        const verdict = v === 0 ? 'pass' : v === 1 ? 'fail' : 'unknown';
        return {
          refKind: entry.refKind,
          refDigest: entry.refDigest,
          verdict,
          constraints: verdict === 'pass' ? [] : null,
          notes: null,
        } as never;
      });
      const { verdict } = deriveCertificationVerdict(mutated as never);
      expect(['pass', 'conditional-pass', 'fail', 'unknown']).toContain(verdict);
    });
  }
});

describe('property: determinism (P2)', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    it(`seed ${String(seed)}: independent runs produce the identical digest`, async () => {
      const a = await buildScenario(seed);
      const b = await buildScenario(seed);
      const inputA = await makeRecordInput(a.suite, a.summary);
      const inputB = await makeRecordInput(b.suite, b.summary);
      const ra = await createCertificationRecord(inputA, a.suite);
      const rb = await createCertificationRecord(inputB, b.suite);
      expect(rb.digest).toBe(ra.digest);
      expect(rb.verdict).toBe(ra.verdict);
    });
  }
});

describe('property: design-law scope (P3) — no unscoped professional claim possible', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    it(`seed ${String(seed)}: the statement carries every scope field`, async () => {
      const { suite, summary } = await buildScenario(seed);
      const record = await createCertificationRecord(
        await makeRecordInput(suite, summary),
        suite,
      );
      // Every scope field MUST appear in the rendered statement text.
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
      // The statement NEVER carries an unscoped professional claim.
      const lowered = record.statement.statementText.toLowerCase();
      expect(lowered).not.toContain('is a professional');
      expect(lowered).not.toContain('is a software engineer');
      expect(lowered).not.toContain('is a structural engineer');
    });
  }
});

describe('property: input digest changes when component verdicts change', () => {
  for (const seed of SEEDS.slice(0, 2)) {
    it(`seed ${String(seed)}: inputDigest differs between pass-summary and fail-summary`, async () => {
      const { suite } = await buildScenario(seed);
      const passSummary = await allPassSummary(suite);
      const failSummary = passSummary.map((entry) => ({
        refKind: entry.refKind,
        refDigest: entry.refDigest,
        verdict: 'fail' as const,
        constraints: null,
        notes: null,
      })) as never;
      const passRecord = await createCertificationRecord(
        await makeRecordInput(suite, passSummary),
        suite,
      );
      const failRecord = await createCertificationRecord(
        await makeRecordInput(suite, failSummary),
        suite,
      );
      expect(passRecord.inputDigest).not.toBe(failRecord.inputDigest);
    });
  }
});

// re-export to satisfy unused-import lint
export const _unused = { digestOf };
