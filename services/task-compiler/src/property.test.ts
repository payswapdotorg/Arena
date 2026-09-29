/**
 * Property suite (Work Order A008, service) — end-to-end determinism and
 * reproducibility properties of the R6 bridge.
 */

import { describe, expect, it } from 'vitest';
import {
  createReferencePolicy,
  triagedCase,
  validPolicyInput,
  T1,
} from './test-support.js';
import { TaskCompilerFabric } from './fabric.js';
import { compileTarget } from './compiler.js';
import { deriveCompilationTarget } from '@arena/capability-case';
import { createCompilationPolicy, verifyTaskSpec } from '@arena/task-spec';

describe('R6 reproducibility properties (end-to-end)', () => {
  it('same case + same policy ⇒ same specs, across TWO FABRIC INSTANCES', async () => {
    const caseRecord = await triagedCase();
    const policy = await createReferencePolicy();

    const fabricA = new TaskCompilerFabric();
    await fabricA.registerCase(caseRecord);
    await fabricA.registerPolicy(policy);
    const runA = await fabricA.runCompilation(
      {
        caseDigest: caseRecord.digest,
        policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        derivedAt: T1,
        compiledAt: T1,
      },
      { correlationId: 'corr-prop-0001', idempotencyKey: 'idem-prop-0001' },
    );

    const fabricB = new TaskCompilerFabric();
    await fabricB.registerCase(caseRecord);
    await fabricB.registerPolicy(policy);
    const runB = await fabricB.runCompilation(
      {
        caseDigest: caseRecord.digest,
        policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        derivedAt: '2026-12-24T23:59:59.999Z', // DIFFERENT derivation time
        compiledAt: '2026-12-25T00:00:00.000Z', // DIFFERENT compile time
      },
      { correlationId: 'corr-prop-0002', idempotencyKey: 'idem-prop-0002' },
    );

    expect(runA.specs.map((spec) => spec.digest)).toEqual(
      runB.specs.map((spec) => spec.digest),
    );
    // The RECORDS differ (they pin run times + keys — correlation-addressed
    // run artifacts, not reproducible content):
    expect(runA.record.digest).not.toBe(runB.record.digest);
  });

  it('the pure compiler is stable across policy variations (same rules ⇒ same output)', async () => {
    const caseRecord = await triagedCase();
    const target = await deriveCompilationTarget(caseRecord, { derivedAt: T1 });
    const policy = await createReferencePolicy();
    const a = await compileTarget(target, policy);
    const b = await compileTarget(target, await createReferencePolicy());
    expect(a.map((spec) => spec.digest)).toEqual(b.map((spec) => spec.digest));
  });

  it('every compiled spec passes its own digest verification', async () => {
    const caseRecord = await triagedCase();
    const target = await deriveCompilationTarget(caseRecord, { derivedAt: T1 });
    for (const policyInput of [
      validPolicyInput(),
      { ...validPolicyInput(), environment: { selection: 'each', seed: null, note: null } },
    ]) {
      const policy = await createCompilationPolicy(policyInput);
      for (const spec of await compileTarget(target, policy)) {
        await expect(verifyTaskSpec(spec)).resolves.toBe(spec.digest);
      }
    }
  });

  it('compilation output size is a pure function of the policy selection mode', async () => {
    const caseRecord = await triagedCase();
    const target = await deriveCompilationTarget(caseRecord, { derivedAt: T1 });
    const first = await createCompilationPolicy(validPolicyInput());
    const each = await createCompilationPolicy({
      ...validPolicyInput(),
      environment: { selection: 'each', seed: null, note: null },
    });
    expect((await compileTarget(target, first))).toHaveLength(1);
    expect((await compileTarget(target, each))).toHaveLength(
      target.environmentRequirements.environments.length,
    );
  });
});
