/**
 * Registry + run-record tests (Work Order A019): content-addressed
 * registration, identity conflicts, record construction/verification
 * and structural negatives.
 */

import { describe, expect, it } from 'vitest';
import { createExtractionPolicy } from '@arena/skill-extraction';
import { SKILL_EXTRACTION_ERROR_CODES } from '@arena/skill-extraction';
import { ExtractionPolicyRegistry } from './registry.js';
import {
  createExtractionRunRecord,
  extractionRunRecordView,
  isExtractionRunRecord,
  isExtractionRunRecordView,
  verifyExtractionRunRecord,
} from './record.js';
import {
  CORR,
  DIGEST_A,
  makeTargetNodeAndPolicyInput,
  makeRef,
  RUN_KEY,
  T5,
  T6,
} from './test-support.js';

describe('ExtractionPolicyRegistry', () => {
  it('registers policies idempotently by digest', async () => {
    const registry = new ExtractionPolicyRegistry();
    const { input } = await makeTargetNodeAndPolicyInput();
    const policy = await createExtractionPolicy(input);
    await registry.registerPolicy(policy);
    await registry.registerPolicy(policy); // idempotent
    expect(registry.listPolicies()).toHaveLength(1);
    expect(registry.getPolicy(policy.digest)?.policyId).toBe(policy.policyId);
  });

  it('REJECTS a different digest under the same identity (IDENTITY_CONFLICT)', async () => {
    const registry = new ExtractionPolicyRegistry();
    const { input } = await makeTargetNodeAndPolicyInput();
    await registry.registerPolicy(await createExtractionPolicy(input));
    const mutated = { ...input, thresholds: { minTrajectories: 2, minOccurrences: 1 } };
    await expect(registry.registerPolicy(await createExtractionPolicy(mutated))).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.IDENTITY_CONFLICT,
    });
  });

  it('lists all versions of a policy id', async () => {
    const registry = new ExtractionPolicyRegistry();
    const { input } = await makeTargetNodeAndPolicyInput();
    await registry.registerPolicy(await createExtractionPolicy(input));
    const bumped = await createExtractionPolicy({ ...input, version: '1.1.0' });
    await registry.registerPolicy(bumped);
    expect(registry.listPoliciesById(input.policyId as string)).toHaveLength(2);
  });
});

describe('ExtractionRunRecord', () => {
  it('creates a valid run record and verifies its digest', async () => {
    const ref = await makeRef();
    const { input } = await makeTargetNodeAndPolicyInput();
    const policy = await createExtractionPolicy(input);
    const record = await createExtractionRunRecord({
      runKey: RUN_KEY,
      correlationId: CORR,
      extractorVersion: '1.0.0',
      policyRef: policy.digest,
      inputs: [ref.digest as string],
      trajectoryDecisions: [
        { trajectoryRef: ref.trajectory.chainHead as string, accepted: true, reason: 'accepted', signature: 'a#completed' },
      ],
      patternDecisions: [
        { signature: 'a#completed', occurrences: 1, distinctTrajectories: 1, accepted: true, reason: 'accepted', candidateDigest: DIGEST_A },
      ],
      candidates: [],
      drafts: [],
      startedAt: T5,
      finishedAt: T6,
      provenance: { executedBy: 'arena-skill-extraction-fabric', recordedAt: T6, notes: null },
    });
    expect(isExtractionRunRecordView(record)).toBe(true);
    expect(isExtractionRunRecord(record)).toBe(true);
    await expect(verifyExtractionRunRecord(record)).resolves.toBe(record.digest);
    const view = extractionRunRecordView(record);
    expect('digest' in view).toBe(false);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('is pure: identical inputs ⇒ identical digest', async () => {
    const ref = await makeRef();
    const { input } = await makeTargetNodeAndPolicyInput();
    const policy = await createExtractionPolicy(input);
    const make = () =>
      createExtractionRunRecord({
        runKey: RUN_KEY,
        correlationId: CORR,
        extractorVersion: '1.0.0',
        policyRef: policy.digest,
        inputs: [ref.digest as string],
        trajectoryDecisions: [],
        patternDecisions: [],
        candidates: [],
        drafts: [],
        startedAt: T5,
        finishedAt: T6,
        provenance: { executedBy: 'arena-skill-extraction-fabric', recordedAt: T6, notes: null },
      });
    const a = await make();
    const b = await make();
    expect(a.digest).toBe(b.digest);
  });

  it('REJECTS malformed inputs (bad keys, empty inputs, timestamp regressions)', async () => {
    const { input } = await makeTargetNodeAndPolicyInput();
    const policy = await createExtractionPolicy(input);
    const base = {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
      extractorVersion: '1.0.0',
      policyRef: policy.digest,
      inputs: [DIGEST_A],
      trajectoryDecisions: [],
      patternDecisions: [],
      candidates: [],
      drafts: [],
      provenance: { executedBy: 'arena-skill-extraction-fabric', recordedAt: T6, notes: null },
    };
    await expect(
      createExtractionRunRecord({ ...base, runKey: 'bad key!' } as never),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD });
    await expect(
      createExtractionRunRecord({ ...base, inputs: [] }),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD });
    await expect(
      createExtractionRunRecord({ ...base, startedAt: T6, finishedAt: T5 }),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.TIMESTAMP_REGRESSION });
    await expect(
      createExtractionRunRecord({ ...base, policyRef: 'nope' }),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD });
  });

  it('detects run-record tampering', async () => {
    const ref = await makeRef();
    const { input } = await makeTargetNodeAndPolicyInput();
    const policy = await createExtractionPolicy(input);
    const record = await createExtractionRunRecord({
      runKey: RUN_KEY,
      correlationId: CORR,
      extractorVersion: '1.0.0',
      policyRef: policy.digest,
      inputs: [ref.digest as string],
      trajectoryDecisions: [],
      patternDecisions: [],
      candidates: [],
      drafts: [],
      startedAt: T5,
      finishedAt: T6,
      provenance: { executedBy: 'arena-skill-extraction-fabric', recordedAt: T6, notes: null },
    });
    const tampered = { ...record, candidates: [DIGEST_A] };
    await expect(verifyExtractionRunRecord(tampered)).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.TAMPERED,
    });
  });
});
