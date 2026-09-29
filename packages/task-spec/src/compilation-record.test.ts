/**
 * CompilationRecord + envelopes suite (Work Order A008) — record
 * construction/validation, envelope round trips, error taxonomy.
 */

import { describe, expect, it } from 'vitest';
import { createFixtureSpec, createFixturePolicy, DIGESTS, T0 } from './test-support.js';
import { createCompilationRecord, isCompilationRecord, recomputeCompilationRecordDigest, compilationRecordView } from './compilation-record.js';
import {
  makeCompilationRecordedEvent,
  makeRunCompilationCommand,
  parseCompilationRecordedEvent,
  parseRunCompilationCommand,
  TASK_SPEC_SCHEMAS,
  taskSpecSchemaRef,
  isKnownTaskSpecSchema,
} from './envelopes.js';
import {
  TASK_SPEC_ERROR_CODES,
  TaskSpecError,
  fromTaskSpecErrorStruct,
  isTaskSpecError,
  normalizeToTaskSpecError,
  toTaskSpecErrorStruct,
} from './errors.js';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';

async function recordFixture() {
  const spec = await createFixtureSpec();
  const policy = await createFixturePolicy();
  return createCompilationRecord({
    compilationKey: 'compile-case-001-run-1',
    correlationId: 'corr-a008-0001',
    caseRef: {
      tenant: 'tenant-alpha',
      caseId: 'case-001',
      version: '1.0.0',
      digest: DIGESTS.caseRef,
    },
    targetDigest: '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
    emittedSpecs: [
      {
        tenant: spec.identity.tenant,
        taskId: spec.identity.taskId,
        version: spec.version,
        digest: spec.digest,
      },
    ],
    compiledAt: T0,
  });
}

describe('CompilationRecord (positive)', () => {
  it('creates the fixture record with a valid digest', async () => {
    const record = await recordFixture();
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.compilationKey).toBe('compile-case-001-run-1');
    expect(record.emittedSpecs).toHaveLength(1);
    expect(isCompilationRecord(record)).toBe(true);
  });

  it('is deep-frozen and deterministic', async () => {
    const a = await recordFixture();
    const b = await recordFixture();
    expect(a.digest).toBe(b.digest);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('digest recomputation accepts pristine content', async () => {
    const record = await recordFixture();
    await expect(recomputeCompilationRecordDigest(record)).resolves.toBe(record.digest);
    expect('digest' in compilationRecordView(record)).toBe(false);
  });
});

describe('CompilationRecord (negative)', () => {
  it('a malformed compilation key is rejected', async () => {
    await expect(
      recordFixture().then((r) =>
        createCompilationRecord({ ...r, compilationKey: 'bad key with spaces' } as never),
      ),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.INVALID_RECORD });
  });

  it('a malformed target digest is rejected', async () => {
    const record = await recordFixture();
    await expect(
      createCompilationRecord({
        compilationKey: record.compilationKey,
        correlationId: record.correlationId,
        caseRef: record.caseRef,
        targetDigest: 'nope',
        policyRef: record.policyRef,
        emittedSpecs: record.emittedSpecs,
        compiledAt: record.compiledAt,
      }),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.INVALID_RECORD });
  });

  it('a malformed timestamp is rejected', async () => {
    const record = await recordFixture();
    await expect(
      createCompilationRecord({
        compilationKey: record.compilationKey,
        correlationId: record.correlationId,
        caseRef: record.caseRef,
        targetDigest: record.targetDigest,
        policyRef: record.policyRef,
        emittedSpecs: record.emittedSpecs,
        compiledAt: '2026-02-01T09:30:00Z',
      }),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.INVALID_TIMESTAMP });
  });

  it('a tampered record fails digest recomputation', async () => {
    const record = await recordFixture();
    const tampered = { ...record, correlationId: 'corr-other' } as typeof record;
    await expect(recomputeCompilationRecordDigest(tampered)).rejects.toMatchObject({
      code: TASK_SPEC_ERROR_CODES.TAMPERED,
    });
  });
});

describe('envelope wiring', () => {
  it('schema registry: eight schemas, known refs resolve', () => {
    expect(Object.keys(TASK_SPEC_SCHEMAS)).toHaveLength(8);
    expect(taskSpecSchemaRef('task/task-spec')).toEqual({
      namespace: 'task',
      name: 'task-spec',
      version: '1.0.0',
    });
    expect(isKnownTaskSpecSchema(taskSpecSchemaRef('task/task-spec'))).toBe(true);
    expect(
      isKnownTaskSpecSchema({ namespace: 'task', name: 'task-spec', version: '9.9.9' }),
    ).toBe(false);
  });

  it('run-compilation-command round trip (idempotency key REQUIRED)', async () => {
    const policy = await createFixturePolicy();
    const envelope = makeRunCompilationCommand(
      {
        caseDigest: DIGESTS.caseRef,
        policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        derivedAt: T0,
        compiledAt: T0,
      },
      {
        correlationId: toCorrelationId('corr-a008-0001'),
        idempotencyKey: toIdempotencyKey('idem-a008-0001'),
      },
    );
    const parsed = parseRunCompilationCommand(JSON.stringify(envelope));
    expect(parsed.payload.caseDigest).toBe(DIGESTS.caseRef);
    expect(parsed.idempotencyKey).toBe('idem-a008-0001');
  });

  it('compilation-recorded-event round trip', async () => {
    const record = await recordFixture();
    const spec = await createFixtureSpec();
    const envelope = makeCompilationRecordedEvent(
      { record, specs: [spec] },
      { correlationId: toCorrelationId('corr-a008-0001') },
    );
    const parsed = parseCompilationRecordedEvent(JSON.stringify(envelope));
    expect(parsed.payload.record.digest).toBe(record.digest);
    expect(parsed.payload.specs[0]?.digest).toBe(spec.digest);
  });
});

describe('error taxonomy', () => {
  it('round trips through the structured form', () => {
    const error = new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS, {
      message: 'unknown task class',
      details: { known: ['demonstration'] },
    });
    const struct = toTaskSpecErrorStruct(error);
    expect(struct.code).toBe('TASK_SPEC_INVALID_CLASS');
    expect(struct.category).toBe('validation');
    const parsed = fromTaskSpecErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
  });

  it('unknown codes are rejected at parse time', () => {
    expect(() =>
      fromTaskSpecErrorStruct({ code: 'TASK_SPEC_MADE_UP', category: 'validation', message: 'x' }),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.UNKNOWN_ERROR }),
    );
  });

  it('category/code mismatch is rejected', () => {
    expect(() =>
      fromTaskSpecErrorStruct({
        code: TASK_SPEC_ERROR_CODES.TAMPERED,
        category: 'validation',
        message: 'x',
      }),
    ).toThrow();
  });

  it('normalizeToTaskSpecError wraps foreign errors', () => {
    expect(isTaskSpecError(normalizeToTaskSpecError(new Error('boom')))).toBe(true);
    expect(isTaskSpecError(normalizeToTaskSpecError('boom'))).toBe(true);
  });

  it('the code set is closed and sorted in contracts', () => {
    const codes = Object.values(TASK_SPEC_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('TASK_SPEC_CROSS_FIELD_CONSISTENCY');
    expect(codes).toHaveLength(31);
  });
});
