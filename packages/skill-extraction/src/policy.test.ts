/**
 * ExtractionPolicy tests (Work Order A019): content addressing,
 * determinism, closed vocabularies and the negative/adversarial
 * inputs (empty eligibility, unknown kinds, sub-1 minimums, invalid
 * taxonomy targets, tamper detection).
 */

import { describe, expect, it } from 'vitest';
import { SKILL_EXTRACTION_ERROR_CODES } from './errors.js';
import {
  createExtractionPolicy,
  extractionPolicyView,
  isExtractionPolicy,
  isExtractionPolicyView,
  verifyExtractionPolicy,
} from './policy.js';
import { DIGEST_A, makePolicyInput, TestLcg } from './test-support.js';

describe('ExtractionPolicy — positive', () => {
  it('creates the documented house-default policy (actions + completions, pass-verified, meets-criteria)', async () => {
    const policy = await createExtractionPolicy(makePolicyInput());
    expect(isExtractionPolicyView(policy)).toBe(true);
    expect(isExtractionPolicy(policy)).toBe(true);
    expect(policy.validation.requiredVerificationOutcome).toBe('pass');
    expect(policy.validation.minVerificationRecords).toBe(1);
    expect(policy.validation.requireEvaluations).toBe(true);
    expect(policy.validation.requiredEvaluationOutcome).toBe('meets-criteria');
    expect([...policy.eligibility.entryKinds]).toEqual(['action', 'completion']);
    expect(policy.eligibility.requireCompletedOutcome).toBe('completed');
    expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is content-addressed: same rules ⇒ same digest; any change ⇒ a different digest', async () => {
    const a = await createExtractionPolicy(makePolicyInput());
    const b = await createExtractionPolicy(makePolicyInput());
    expect(a.digest).toBe(b.digest);
    const changed = await createExtractionPolicy(
      makePolicyInput({ minTrajectories: 2 }),
    );
    expect(changed.digest).not.toBe(a.digest);
    const renamed = await createExtractionPolicy(
      makePolicyInput({ policyId: 'policy-extraction-0002' }),
    );
    expect(renamed.digest).not.toBe(a.digest);
  });

  it('verifies its own digest and exposes a digest-free view', async () => {
    const policy = await createExtractionPolicy(makePolicyInput());
    await expect(verifyExtractionPolicy(policy)).resolves.toBe(policy.digest);
    const view = extractionPolicyView(policy);
    expect(view.policyId).toBe(policy.policyId);
    expect('digest' in view).toBe(false);
  });

  it('accepts every closed vocabulary member it documents', async () => {
    for (const outcome of ['pass', 'fail', 'unknown'] as const) {
      const policy = await createExtractionPolicy(
        makePolicyInput({ requiredVerificationOutcome: outcome }),
      );
      expect(policy.validation.requiredVerificationOutcome).toBe(outcome);
    }
    for (const outcome of ['meets-criteria', 'below-criteria', null] as const) {
      const policy = await createExtractionPolicy(
        makePolicyInput({ requiredEvaluationOutcome: outcome }),
      );
      expect(policy.validation.requiredEvaluationOutcome).toBe(outcome);
    }
    for (const outcome of ['completed', 'failed', 'timed-out', null] as const) {
      const policy = await createExtractionPolicy(
        makePolicyInput({ requireCompletedOutcome: outcome }),
      );
      expect(policy.eligibility.requireCompletedOutcome).toBe(outcome);
    }
  });
});

describe('ExtractionPolicy — negatives', () => {
  it('REJECTS an empty or unknown eligibility entry-kind set', async () => {
    await expect(createExtractionPolicy(makePolicyInput({ entryKinds: [] }))).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
    await expect(
      createExtractionPolicy(makePolicyInput({ entryKinds: ['action', 'hidden-reasoning'] })),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
  });

  it('REJECTS duplicate eligibility entry kinds', async () => {
    await expect(
      createExtractionPolicy(makePolicyInput({ entryKinds: ['action', 'action'] })),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
  });

  it('REJECTS minVerificationRecords < 1 (the R17 gate is non-negotiable)', async () => {
    await expect(
      createExtractionPolicy(makePolicyInput({ minVerificationRecords: 0 })),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
  });

  it('REJECTS sub-1 thresholds and non-integer minimums', async () => {
    await expect(createExtractionPolicy(makePolicyInput({ minTrajectories: 0 }))).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
    await expect(createExtractionPolicy(makePolicyInput({ minOccurrences: 0 }))).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
    await expect(
      createExtractionPolicy(makePolicyInput({ minTrajectories: 1.5 })),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
  });

  it('REJECTS an invalid A004 taxonomy target (REAL capability-graph guard)', async () => {
    await expect(
      createExtractionPolicy(
        makePolicyInput({ targetNode: { kind: 'skill', id: 'not-a-target', version: '1.0.0', digest: 'nothex' } }),
      ),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
  });

  it('REJECTS taxonomy targets that are not domain/capability/sub-capability nodes', async () => {
    await expect(
      createExtractionPolicy(
        makePolicyInput({ targetNode: { kind: 'tool', id: 'tool-x', version: '1.0.0', digest: DIGEST_A } }),
      ),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
    await expect(
      createExtractionPolicy(
        makePolicyInput({ targetNode: { kind: 'evaluator', id: 'eval-x', version: '1.0.0', digest: DIGEST_A } }),
      ),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
  });

  it('REJECTS unknown enum members and malformed versions/ids', async () => {
    await expect(
      createExtractionPolicy(makePolicyInput({ requiredVerificationOutcome: 'maybe' })),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY });
    await expect(
      createExtractionPolicy(makePolicyInput({ version: '1.0.0+build' })),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY });
    await expect(
      createExtractionPolicy(makePolicyInput({ policyId: 'Not_Lowercase' })),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.INVALID_IDENTITY });
  });

  it('REJECTS unknown top-level fields (strict shape)', async () => {
    const input = makePolicyInput() as unknown as Record<string, unknown>;
    input['rogue'] = 'field';
    await expect(createExtractionPolicy(input as never)).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    });
  });

  it('detects tampering (digest recomputation mismatch)', async () => {
    const policy = await createExtractionPolicy(makePolicyInput());
    const tampered = {
      ...policy,
      thresholds: { minTrajectories: 99, minOccurrences: 1 },
    };
    await expect(verifyExtractionPolicy(tampered)).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.TAMPERED,
    });
  });
});

describe('ExtractionPolicy — property', () => {
  it('random valid rule sets always produce distinct digests for distinct content (LCG)', async () => {
    const lcg = new TestLcg(0xa019);
    const digests = new Set<string>();
    const inputs: string[] = [];
    for (let index = 0; index < 24; index += 1) {
      const policy = await createExtractionPolicy(
        makePolicyInput({
          policyId: `policy-${String(index).padStart(3, '0')}`,
          minTrajectories: 1 + lcg.int(4),
          minOccurrences: 1 + lcg.int(4),
        }),
      );
      digests.add(policy.digest);
      inputs.push(
        `${policy.policyId}:${String(policy.thresholds.minTrajectories)}:${String(policy.thresholds.minOccurrences)}`,
      );
    }
    expect(new Set(inputs).size).toBe(inputs.length);
    expect(digests.size).toBe(inputs.length);
  });
});
