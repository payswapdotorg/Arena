/**
 * Fabric suite (Work Order A008) — command orchestration: registration,
 * eligibility, idempotency (lock rule 17), events, negative paths.
 */

import { describe, expect, it } from 'vitest';
import {
  activeCase,
  createReferencePolicy,
  multiEnvTriagedCase,
  triagedCase,
  validPolicyInput,
  T1,
  T2,
} from './test-support.js';
import { TaskCompilerFabric } from './fabric.js';
import {
  createCapabilityCase,
  submitCase,
  resolveCase,
} from '@arena/capability-case';
import { createCompilationPolicy, TASK_SPEC_ERROR_CODES } from '@arena/task-spec';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';

const CORR = 'corr-a008-0001';
const IDEM = 'idem-a008-0001';
const IDEM_OTHER = 'idem-a008-0002';

async function primedFabric() {
  const fabric = new TaskCompilerFabric();
  const caseRecord = await triagedCase();
  await fabric.registerCase(caseRecord);
  const policy = await createReferencePolicy();
  await fabric.registerPolicy(policy);
  return { fabric, caseRecord, policy };
}

function command(caseRecord: { digest: string }, policy: { policyId: string; version: string; digest: string }) {
  return {
    caseDigest: caseRecord.digest,
    policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
    derivedAt: T1,
    compiledAt: T1,
  };
}

describe('TaskCompilerFabric (positive)', () => {
  it('runs one compilation end-to-end: record + pinned spec + event', async () => {
    const { fabric, caseRecord, policy } = await primedFabric();
    const result = await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    expect(result.replayed).toBe(false);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.identity.taskId).toBe('task-case-review-invoices');
    expect(result.record.compilationKey).toBe(IDEM);
    expect(result.record.caseRef.digest).toBe(caseRecord.digest);
    expect(result.record.policyRef.digest).toBe(policy.digest);
    expect(result.record.emittedSpecs[0]?.digest).toBe(result.specs[0]?.digest);
    expect(fabric.listRecords()).toHaveLength(1);
    expect(fabric.listEvents()).toHaveLength(1);
    expect(fabric.listEvents()[0]?.payload.specs[0]?.digest).toBe(result.specs[0]?.digest);
  });

  it('the CASE is never mutated by compilation (lock rule 6)', async () => {
    const { fabric, caseRecord, policy } = await primedFabric();
    const before = JSON.stringify(caseRecord);
    await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    expect(JSON.stringify(fabric.getCase(caseRecord.digest))).toBe(before);
    expect(fabric.getCase(caseRecord.digest)?.status).toBe('triaged');
  });

  it('re-running the SAME key + command REPLAYS the stored record', async () => {
    const { fabric, caseRecord, policy } = await primedFabric();
    const first = await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const replay = await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.record.digest).toBe(first.record.digest);
    expect(fabric.listRecords()).toHaveLength(1); // no duplicate record
    expect(fabric.listEvents()).toHaveLength(1); // no duplicate event
    expect(fabric.registry.list()).toHaveLength(1); // no duplicate spec
  });

  it('a DIFFERENT key with the same command appends a NEW record (same specs)', async () => {
    const { fabric, caseRecord, policy } = await primedFabric();
    await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const second = await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: 'corr-a008-0002',
      idempotencyKey: IDEM_OTHER,
    });
    expect(second.replayed).toBe(false);
    expect(fabric.listRecords()).toHaveLength(2);
    expect(fabric.registry.list()).toHaveLength(1); // content-deduplicated pinning
    expect(second.specs[0]?.digest).toBe(
      (await fabric.runCompilation(command(caseRecord, policy), {
        correlationId: CORR,
        idempotencyKey: IDEM,
      })).specs[0]?.digest,
    );
  });

  it('the same key with a DIFFERENT command is an IDEMPOTENCY CONFLICT', async () => {
    const { fabric, caseRecord, policy } = await primedFabric();
    await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    await expect(
      fabric.runCompilation(
        { ...command(caseRecord, policy), compiledAt: T2 },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.IDEMPOTENCY_CONFLICT });
  });

  it('compiling the same case under a DIFFERENT policy appends a superseding version', async () => {
    const { fabric, caseRecord, policy } = await primedFabric();
    await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const otherPolicy = await createCompilationPolicy({
      ...validPolicyInput(),
      policyId: 'other-policy',
      fieldMapping: {
        ...validPolicyInput().fieldMapping,
        instructions: {
          mode: 'template',
          template: 'Alternative framing for case {caseId} ({difficulty}).',
        },
      },
    });
    await fabric.registerPolicy(otherPolicy);
    const second = await fabric.runCompilation(
      command(caseRecord, otherPolicy),
      { correlationId: 'corr-a008-0003', idempotencyKey: IDEM_OTHER },
    );
    expect(second.replayed).toBe(false);
    const spec = second.specs[0] as { version: string; supersedes?: { version: string } };
    expect(spec.version).toBe('1.1.0');
    expect(spec.supersedes?.version).toBe('1.0.0');
    expect(fabric.registry.list()).toHaveLength(2); // both versions pinned
  });

  it('an ACTIVE case compiles (both compilable statuses work)', async () => {
    const fabric = new TaskCompilerFabric();
    const caseRecord = await activeCase();
    await fabric.registerCase(caseRecord);
    const policy = await createReferencePolicy();
    await fabric.registerPolicy(policy);
    const result = await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    expect(result.specs).toHaveLength(1);
  });

  it('multi-env cases emit one spec per environment under the each-mode policy', async () => {
    const fabric = new TaskCompilerFabric();
    const caseRecord = await multiEnvTriagedCase();
    await fabric.registerCase(caseRecord);
    const policy = await createCompilationPolicy({
      ...validPolicyInput(),
      environment: { selection: 'each', seed: null, note: null },
    });
    await fabric.registerPolicy(policy);
    const result = await fabric.runCompilation(command(caseRecord, policy), {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    expect(result.specs).toHaveLength(2);
    expect(result.record.emittedSpecs).toHaveLength(2);
  });
});

describe('TaskCompilerFabric (negative/adversarial)', () => {
  it('an UNREGISTERED case is CASE_NOT_FOUND', async () => {
    const fabric = new TaskCompilerFabric();
    const policy = await createReferencePolicy();
    await fabric.registerPolicy(policy);
    await expect(
      fabric.runCompilation(
        { ...command({ digest: '0'.repeat(64) }, policy) },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.CASE_NOT_FOUND });
  });

  it('an UNREGISTERED policy is POLICY_NOT_FOUND', async () => {
    const fabric = new TaskCompilerFabric();
    const caseRecord = await triagedCase();
    await fabric.registerCase(caseRecord);
    const policy = await createReferencePolicy(); // NOT registered
    await expect(
      fabric.runCompilation(command(caseRecord, policy), {
        correlationId: CORR,
        idempotencyKey: IDEM,
      }),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.POLICY_NOT_FOUND });
  });

  it('a policy narrowing to [active] REJECTS a triaged case', async () => {
    const fabric = new TaskCompilerFabric();
    const caseRecord = await triagedCase();
    await fabric.registerCase(caseRecord);
    const policy = await createCompilationPolicy({
      ...validPolicyInput(),
      eligibility: { compilableStatuses: ['active'], minimumEvidenceCount: 1 },
    });
    await fabric.registerPolicy(policy);
    await expect(
      fabric.runCompilation(command(caseRecord, policy), {
        correlationId: CORR,
        idempotencyKey: IDEM,
      }),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.INVALID_POLICY });
  });

  it('a RESOLVED case cannot compile (terminal — A005 gate + fabric)', async () => {
    const fabric = new TaskCompilerFabric();
    const triaged = await triagedCase();
    const active = await (await import('@arena/capability-case')).activateCase(triaged, {
      at: T2,
      actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
    });
    const resolved = await resolveCase(active, {
      at: T2,
      actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
      resolution: 'Fixed by the reconciliation patch.',
    });
    await fabric.registerCase(resolved);
    const policy = await createReferencePolicy();
    await fabric.registerPolicy(policy);
    await expect(
      fabric.runCompilation(command(resolved, policy), {
        correlationId: CORR,
        idempotencyKey: IDEM,
      }),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.INVALID_POLICY });
  });

  it('a DRAFT/SUBMITTED case cannot even be compiled (A005 gate)', async () => {
    const fabric = new TaskCompilerFabric();
    const draft = await createCapabilityCase(
      (await import('./test-support.js')).validCaseInput(),
    );
    await fabric.registerCase(draft);
    const policy = await createReferencePolicy();
    await fabric.registerPolicy(policy);
    await expect(
      fabric.runCompilation(command(draft, policy), {
        correlationId: CORR,
        idempotencyKey: IDEM,
      }),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.INVALID_POLICY });
    const submitted = await submitCase(draft, {
      at: T1,
      actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
    });
    await fabric.registerCase(submitted);
    await expect(
      fabric.runCompilation(command(submitted, policy), {
        correlationId: CORR,
        idempotencyKey: 'idem-a008-0009',
      }),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.INVALID_POLICY });
  });

  it('registering a TAMPERED case fails closed', async () => {
    const fabric = new TaskCompilerFabric();
    const caseRecord = await triagedCase();
    const tampered = { ...caseRecord, priority: 'critical' } as typeof caseRecord;
    await expect(fabric.registerCase(tampered)).rejects.toMatchObject({
      code: 'CAPABILITY_CASE_TAMPERED',
    });
  });

  it('registering a policy identity conflict fails closed', async () => {
    const fabric = new TaskCompilerFabric();
    const policy = await createReferencePolicy();
    await fabric.registerPolicy(policy);
    const conflicting = await createCompilationPolicy({
      ...validPolicyInput(),
      description: 'same policyId@version, different rules',
    });
    await expect(fabric.registerPolicy(conflicting)).rejects.toMatchObject({
      code: TASK_SPEC_ERROR_CODES.IDENTITY_CONFLICT,
    });
    // Same identity + same content is idempotent:
    await expect(fabric.registerPolicy(policy)).resolves.toBe(policy);
  });

  it('envelope helpers validate the correlation/idempotency identifiers', async () => {
    const { fabric, caseRecord, policy } = await primedFabric();
    await expect(
      fabric.runCompilation(command(caseRecord, policy), {
        correlationId: 'not a valid correlation id!!',
        idempotencyKey: IDEM,
      }),
    ).rejects.toThrow();
    expect(toCorrelationId(CORR)).toBe(CORR);
    expect(toIdempotencyKey(IDEM)).toBe(IDEM);
  });
});
