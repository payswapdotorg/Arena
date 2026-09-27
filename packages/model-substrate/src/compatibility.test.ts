/**
 * SubstrateCompatibilityTest / SubstrateCompatibilityResult tests (gate 5):
 * pure data contracts binding BodyVersion ref + substrate digest + profile
 * requirements → typed RESULT records (pass/fail/inconclusive + evidence
 * refs). NO decision engine here (that is A022) — these tests pin the data
 * contracts and their construction tripwires.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY_MAX_UNITS_LIMIT,
  SUBSTRATE_COMPATIBILITY_OUTCOMES,
  createSubstrateCompatibilityResult,
  createSubstrateCompatibilityTest,
  isSubstrateCompatibilityResult,
  isSubstrateCompatibilityTest,
} from './compatibility.js';

const DIGEST_A = '1'.repeat(64);
const DIGEST_B = '2'.repeat(64);
const EVIDENCE_REF = {
  namespace: 'tenant-a',
  name: 'compat-evidence',
  version: '1.0.0',
  digest: DIGEST_A,
};

const TEST_INPUT = {
  testId: 'compat-body-sub-1',
  bodyVersion: {
    tenant: 'tenant-a',
    name: 'structural-engineer',
    version: '1.2.0',
    digest: DIGEST_A,
  },
  substrateDigest: DIGEST_B,
  requiredModalities: ['text-input', 'text-output'],
  requiredToolCalling: 'json-schema',
  minContextUnits: 100000,
  prohibitedConditions: ['deprecated'],
};

describe('SubstrateCompatibilityTest (positive)', () => {
  it('binds a body version ref + substrate digest + profile requirements', () => {
    const test = createSubstrateCompatibilityTest(TEST_INPUT);
    expect(test.recordVersion).toBe(1);
    expect(test.testId).toBe('compat-body-sub-1');
    expect(test.bodyVersion.tenant).toBe('tenant-a');
    expect(test.bodyVersion.name).toBe('structural-engineer');
    expect(test.bodyVersion.version).toBe('1.2.0');
    expect(test.bodyVersion.digest).toBe(DIGEST_A);
    expect(test.substrateDigest).toBe(DIGEST_B);
    expect(test.spec.requiredModalities).toEqual(['text-input', 'text-output']);
    expect(test.spec.requiredToolCalling).toBe('json-schema');
    expect(test.spec.minContextUnits).toBe(100000);
    expect(test.spec.prohibitedConditions).toEqual(['deprecated']);
    expect(isSubstrateCompatibilityTest(test)).toBe(true);
    expect(Object.isFrozen(test)).toBe(true);
    expect(Object.isFrozen(test.spec)).toBe(true);
  });

  it('prohibited conditions default to empty', () => {
    const { prohibitedConditions: _omit, ...rest } = TEST_INPUT;
    const test = createSubstrateCompatibilityTest(rest);
    expect(test.spec.prohibitedConditions).toEqual([]);
  });
});

describe('SubstrateCompatibilityTest (negative)', () => {
  it('rejects unknown fields (closed shape)', () => {
    expect(() =>
      createSubstrateCompatibilityTest({
        ...TEST_INPUT,
        notes: 'not part of the closed shape',
      } as never),
    ).toThrow(/unknown compatibility test field/);
  });

  it('rejects identity-alias fields (spec AB1.0 hard rule)', () => {
    for (const field of ['equivalentModels', 'modelAliases', 'identicalToBody', 'aliases']) {
      expect(() =>
        createSubstrateCompatibilityTest({ ...TEST_INPUT, [field]: 'x' } as never),
      ).toThrow(/identity alias/);
    }
  });

  it('rejects malformed ids, refs and digests', () => {
    expect(() => createSubstrateCompatibilityTest({ ...TEST_INPUT, testId: 'BAD' })).toThrow(
      /invalid compatibility test id/,
    );
    expect(() =>
      createSubstrateCompatibilityTest({
        ...TEST_INPUT,
        testId: 'gpt-test-1',
      }),
    ).toThrow(/provider brand name/);
    expect(() =>
      createSubstrateCompatibilityTest({
        ...TEST_INPUT,
        bodyVersion: { tenant: 'X', name: 'n', version: '1', digest: DIGEST_A },
      }),
    ).toThrow(/invalid body version reference/);
    expect(() =>
      createSubstrateCompatibilityTest({ ...TEST_INPUT, substrateDigest: 'nope' }),
    ).toThrow(/invalid substrate digest/);
  });

  it('rejects unknown vocabularies and out-of-range context requirements', () => {
    expect(() =>
      createSubstrateCompatibilityTest({ ...TEST_INPUT, requiredModalities: ['telepathy'] }),
    ).toThrow(/unknown substrate modality/);
    expect(() =>
      createSubstrateCompatibilityTest({ ...TEST_INPUT, requiredToolCalling: 'telepathy' }),
    ).toThrow(/unknown required tool-calling/);
    expect(() =>
      createSubstrateCompatibilityTest({ ...TEST_INPUT, minContextUnits: 0 }),
    ).toThrow(/invalid minContextUnits/);
    expect(() =>
      createSubstrateCompatibilityTest({
        ...TEST_INPUT,
        minContextUnits: COMPATIBILITY_MAX_UNITS_LIMIT + 1,
      }),
    ).toThrow(/invalid minContextUnits/);
    expect(() =>
      createSubstrateCompatibilityTest({ ...TEST_INPUT, prohibitedConditions: ['on-fire'] }),
    ).toThrow(/unknown prohibited substrate condition/);
    expect(isSubstrateCompatibilityTest({ recordVersion: 1, testId: 'x' })).toBe(false);
  });
});

describe('SubstrateCompatibilityResult (positive)', () => {
  it('types a passing result with zero reasons and empty evidence', () => {
    const result = createSubstrateCompatibilityResult({
      testId: 'compat-body-sub-1',
      bodyVersionDigest: DIGEST_A,
      substrateDigest: DIGEST_B,
      outcome: 'pass',
    });
    expect(result.outcome).toBe('pass');
    expect(result.reasons).toEqual([]);
    expect(result.evidenceRefs).toEqual([]);
    expect(isSubstrateCompatibilityResult(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('types a failing result with reasons and content-addressed evidence refs', () => {
    const result = createSubstrateCompatibilityResult({
      testId: 'compat-body-sub-1',
      bodyVersionDigest: DIGEST_A,
      substrateDigest: DIGEST_B,
      outcome: 'fail',
      reasons: ['substrate lacks required modality: text-input'],
      evidenceRefs: [EVIDENCE_REF],
    });
    expect(result.outcome).toBe('fail');
    expect(result.reasons).toEqual(['substrate lacks required modality: text-input']);
    expect(result.evidenceRefs).toEqual([EVIDENCE_REF]);
    expect(isSubstrateCompatibilityResult(result)).toBe(true);
  });

  it('types an inconclusive result with a reason', () => {
    const result = createSubstrateCompatibilityResult({
      testId: 'compat-body-sub-1',
      bodyVersionDigest: DIGEST_A,
      substrateDigest: DIGEST_B,
      outcome: 'inconclusive',
      reasons: ['probe could not reach the adapter'],
    });
    expect(result.outcome).toBe('inconclusive');
  });

  it('the outcome vocabulary is closed and has no "equivalent" verdict', () => {
    expect([...SUBSTRATE_COMPATIBILITY_OUTCOMES]).toEqual(['pass', 'fail', 'inconclusive']);
  });
});

describe('SubstrateCompatibilityResult (negative)', () => {
  it('rejects unknown outcome vocabulary', () => {
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: DIGEST_A,
        substrateDigest: DIGEST_B,
        outcome: 'equivalent',
        reasons: ['x'],
      }),
    ).toThrow(/unknown compatibility outcome/);
  });

  it('rejects shape violations: pass with reasons; fail/inconclusive without reasons', () => {
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: DIGEST_A,
        substrateDigest: DIGEST_B,
        outcome: 'pass',
        reasons: ['should not be here'],
      }),
    ).toThrow(/passing result carries no reasons/);
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: DIGEST_A,
        substrateDigest: DIGEST_B,
        outcome: 'fail',
      }),
    ).toThrow(/requires at least one reason/);
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: DIGEST_A,
        substrateDigest: DIGEST_B,
        outcome: 'inconclusive',
      }),
    ).toThrow(/requires at least one reason/);
  });

  it('rejects malformed digests, evidence refs, duplicates and unknown fields', () => {
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: 'nope',
        substrateDigest: DIGEST_B,
        outcome: 'pass',
      }),
    ).toThrow(/invalid body version digest/);
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: DIGEST_A,
        substrateDigest: DIGEST_B,
        outcome: 'pass',
        evidenceRefs: [{ namespace: 'x', name: 'y', version: '1', digest: 'z' }],
      }),
    ).toThrow(/invalid evidence reference/);
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: DIGEST_A,
        substrateDigest: DIGEST_B,
        outcome: 'pass',
        evidenceRefs: [EVIDENCE_REF, EVIDENCE_REF],
      }),
    ).toThrow(/duplicate evidence reference/);
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: DIGEST_A,
        substrateDigest: DIGEST_B,
        outcome: 'pass',
        equivalentModels: [],
      } as never),
    ).toThrow(/identity alias|unknown compatibility result field/);
    expect(() =>
      createSubstrateCompatibilityResult({
        testId: 't-1',
        bodyVersionDigest: DIGEST_A,
        substrateDigest: DIGEST_B,
        outcome: 'fail',
        reasons: ['ok', ''],
      }),
    ).toThrow(/reasons must be non-empty/);
    expect(isSubstrateCompatibilityResult({ recordVersion: 1 })).toBe(false);
  });
});
