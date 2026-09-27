/**
 * JobDefinition — positive AND negative tests (gates 2 and 12):
 * content addressing (deterministic digests, registry-style dedup,
 * normalization equivalence), policy validation, retry decision helpers.
 */

import { describe, expect, it } from 'vitest';
import type { CreateJobDefinitionInput } from './definition.js';
import {
  computeJobDefinitionDigest,
  createJobDefinition,
  isJobDefinition,
  isRetryableErrorClass,
  jobDefinitionKey,
  jobDefinitionView,
  retryAttemptsRemaining,
  retryBackoffMs,
  verifyJobDefinition,
} from './definition.js';
import { JOB_ERROR_CODES, JobError } from './errors.js';

const BASE: CreateJobDefinitionInput = {
  kind: { namespace: 'billing', name: 'reconcile-ledger', version: '1.2.0' },
  inputSchema: 'arena:schema/artifacts/material-artifact@1.0.0',
  correlationAddress: 'arena/jobs/billing/reconciliation',
  idempotency: { scope: 'billing-reconcile', retentionMs: 86_400_000 },
  timeout: { timeoutMs: 30_000 },
  retry: {
    maxAttempts: 3,
    backoffScheduleMs: [1_000, 5_000],
    retryableErrorClasses: ['transient', 'dependency-unavailable'],
  },
  priority: 'high',
  resourceHints: { cpu: 2, memoryMb: 512, weight: 100 },
};

describe('definition — construction (positive)', () => {
  it('creates a validated, frozen, content-addressed definition', async () => {
    const definition = await createJobDefinition(BASE);
    expect(definition.definitionVersion).toBe(1);
    expect(definition.kind.namespace).toBe('billing');
    expect(definition.priority).toBe('high');
    expect(definition.inputSchema).toEqual({
      namespace: 'artifacts',
      name: 'material-artifact',
      version: '1.0.0',
    });
    expect(definition.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.retry)).toBe(true);
    expect(Object.isFrozen(definition.retry.backoffScheduleMs)).toBe(true);
    expect(isJobDefinition(definition)).toBe(true);
    expect(jobDefinitionKey(definition)).toBe('billing/reconcile-ledger@1.2.0');
  });

  it('normalizes defaults (priority, backoff, classes, hints)', async () => {
    const minimal = await createJobDefinition({
      kind: { namespace: 'ops', name: 'nightly-sweep', version: '1.0.0' },
      inputSchema: 'arena:schema/protocol/envelope@1.0.0',
      correlationAddress: 'ops/sweep',
      idempotency: { scope: 'sweep' },
      timeout: { timeoutMs: 1_000 },
      retry: { maxAttempts: 1 },
    });
    expect(minimal.priority).toBe('normal');
    expect(minimal.retry.backoffScheduleMs).toEqual([]);
    expect(minimal.retry.retryableErrorClasses).toEqual([]);
    expect(minimal.resourceHints).toEqual({});
  });

  it('accepts a SchemaRef object as well as a string', async () => {
    const definition = await createJobDefinition({
      ...BASE,
      inputSchema: { namespace: 'artifacts', name: 'principal', version: '1.0.0' },
    });
    expect(definition.inputSchema.name).toBe('principal');
  });
});

describe('definition — content addressing (registry dedup)', () => {
  it('same definition ⇒ same digest (deterministic across constructions)', async () => {
    const a = await createJobDefinition(BASE);
    const b = await createJobDefinition(BASE);
    expect(a.digest).toBe(b.digest);
    expect(a).toEqual(b);
  });

  it('field ORDER does not matter (canonical JSON digests)', async () => {
    const a = await createJobDefinition(BASE);
    // Rebuild the same input with shuffled key order.
    const shuffled: CreateJobDefinitionInput = {
      retry: { ...BASE.retry },
      timeout: { ...BASE.timeout },
      priority: 'high',
      kind: { version: '1.2.0', name: 'reconcile-ledger', namespace: 'billing' },
      inputSchema: BASE.inputSchema,
      idempotency: { retentionMs: 86_400_000, scope: 'billing-reconcile' },
      correlationAddress: BASE.correlationAddress,
      resourceHints: { weight: 100, memoryMb: 512, cpu: 2 },
    };
    const b = await createJobDefinition(shuffled);
    expect(a.digest).toBe(b.digest);
  });

  it('defaulted and explicit forms are the SAME definition (normalization dedup)', async () => {
    const defaulted = await createJobDefinition({
      kind: { namespace: 'ops', name: 'xy', version: '1.0.0' },
      inputSchema: 'arena:schema/protocol/envelope@1.0.0',
      correlationAddress: 'ops/x',
      idempotency: { scope: 'x' },
      timeout: { timeoutMs: 1_000 },
      retry: { maxAttempts: 2 },
    });
    const explicit = await createJobDefinition({
      kind: { namespace: 'ops', name: 'xy', version: '1.0.0' },
      inputSchema: 'arena:schema/protocol/envelope@1.0.0',
      correlationAddress: 'ops/x',
      idempotency: { scope: 'x' },
      timeout: { timeoutMs: 1_000 },
      retry: {
        maxAttempts: 2,
        backoffScheduleMs: [],
        retryableErrorClasses: [],
      },
      priority: 'normal',
      resourceHints: {},
    });
    expect(defaulted.digest).toBe(explicit.digest);
  });

  it('different content ⇒ different digest (one field at a time)', async () => {
    const base = await createJobDefinition(BASE);
    const variants: CreateJobDefinitionInput[] = [
      { ...BASE, kind: { namespace: 'billing', name: 'reconcile-ledger', version: '1.3.0' } },
      { ...BASE, timeout: { timeoutMs: 31_000 } },
      { ...BASE, retry: { ...BASE.retry, maxAttempts: 4 } },
      { ...BASE, retry: { ...BASE.retry, backoffScheduleMs: [2_000] } },
      { ...BASE, retry: { ...BASE.retry, retryableErrorClasses: ['transient'] } },
      { ...BASE, priority: 'low' },
      { ...BASE, correlationAddress: 'arena/jobs/billing/other' },
      { ...BASE, idempotency: { scope: 'other-scope' } },
      { ...BASE, resourceHints: { cpu: 4 } },
      { ...BASE, inputSchema: 'arena:schema/artifacts/principal@1.0.0' },
    ];
    for (const variant of variants) {
      const other = await createJobDefinition(variant);
      expect(other.digest, JSON.stringify(variant)).not.toBe(base.digest);
    }
  });

  it('digests recompute and verify (fail-closed tamper detection)', async () => {
    const definition = await createJobDefinition(BASE);
    expect(await verifyJobDefinition(definition)).toBe(definition.digest);
    expect(await computeJobDefinitionDigest(jobDefinitionView(definition))).toBe(
      definition.digest,
    );
    const tampered = { ...definition, priority: 'critical' } as typeof definition;
    await expect(verifyJobDefinition(tampered)).rejects.toThrow(JobError);
    await expect(verifyJobDefinition(tampered)).rejects.toMatchObject({
      code: JOB_ERROR_CODES.TAMPERED,
    });
  });
});

describe('definition — validation (negative)', () => {
  const rejects = async (input: unknown, code: string): Promise<void> => {
    await expect(createJobDefinition(input as CreateJobDefinitionInput)).rejects.toMatchObject({
      code,
    });
  };

  it('rejects malformed kind identities', async () => {
    await rejects({ ...BASE, kind: { namespace: 'Billing', name: 'x', version: '1.0.0' } }, JOB_ERROR_CODES.INVALID_IDENTITY);
    await rejects({ ...BASE, kind: { namespace: 'billing', name: 'x', version: '1.0' } }, JOB_ERROR_CODES.INVALID_IDENTITY);
  });

  it('rejects malformed input schema refs (core ProtocolError propagates)', async () => {
    await expect(
      createJobDefinition({ ...BASE, inputSchema: 'not-a-schema-ref' }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_INVALID_SCHEMA_REF' });
  });

  it('rejects malformed correlation addresses and idempotency scopes', async () => {
    await rejects({ ...BASE, correlationAddress: 'UPPER/x' }, JOB_ERROR_CODES.INVALID_IDENTITY);
    await rejects({ ...BASE, idempotency: { scope: 'NOPE' } }, JOB_ERROR_CODES.INVALID_IDENTITY);
    await rejects({ ...BASE, idempotency: { scope: 'x', retentionMs: 0 } }, JOB_ERROR_CODES.INVALID_DEFINITION);
  });

  it('rejects malformed timeout policies', async () => {
    await rejects({ ...BASE, timeout: { timeoutMs: 0 } }, JOB_ERROR_CODES.INVALID_DEFINITION);
    await rejects({ ...BASE, timeout: { timeoutMs: 1.5 } }, JOB_ERROR_CODES.INVALID_DEFINITION);
    await rejects({ ...BASE, timeout: {} }, JOB_ERROR_CODES.INVALID_DEFINITION);
  });

  it('rejects malformed retry policies', async () => {
    await rejects({ ...BASE, retry: { ...BASE.retry, maxAttempts: 0 } }, JOB_ERROR_CODES.INVALID_DEFINITION);
    await rejects({ ...BASE, retry: { ...BASE.retry, maxAttempts: 1.5 } }, JOB_ERROR_CODES.INVALID_DEFINITION);
    await rejects(
      { ...BASE, retry: { maxAttempts: 2, backoffScheduleMs: [1, 2, 3] } },
      JOB_ERROR_CODES.INVALID_DEFINITION,
    );
    await rejects(
      { ...BASE, retry: { ...BASE.retry, backoffScheduleMs: [-1] } },
      JOB_ERROR_CODES.INVALID_DEFINITION,
    );
    await rejects(
      { ...BASE, retry: { ...BASE.retry, backoffScheduleMs: [Number.POSITIVE_INFINITY] } },
      JOB_ERROR_CODES.INVALID_DEFINITION,
    );
    await rejects(
      { ...BASE, retry: { ...BASE.retry, retryableErrorClasses: ['NOPE'] } },
      JOB_ERROR_CODES.INVALID_DEFINITION,
    );
    await rejects(
      {
        ...BASE,
        retry: { ...BASE.retry, retryableErrorClasses: ['transient', 'transient'] },
      },
      JOB_ERROR_CODES.INVALID_DEFINITION,
    );
  });

  it('rejects malformed priorities and resource hints', async () => {
    await rejects({ ...BASE, priority: 'urgent' }, JOB_ERROR_CODES.INVALID_DEFINITION);
    await rejects({ ...BASE, resourceHints: { cpu: 0 } }, JOB_ERROR_CODES.INVALID_DEFINITION);
    await rejects({ ...BASE, resourceHints: { memoryMb: 0 } }, JOB_ERROR_CODES.INVALID_DEFINITION);
    await rejects({ ...BASE, resourceHints: { weight: 1001 } }, JOB_ERROR_CODES.INVALID_DEFINITION);
  });

  it('isJobDefinition rejects structurally invalid values', async () => {
    const definition = await createJobDefinition(BASE);
    expect(isJobDefinition({ ...definition, definitionVersion: 2 })).toBe(false);
    expect(isJobDefinition({ ...definition, digest: 'ab' })).toBe(false);
    expect(isJobDefinition(null)).toBe(false);
    expect(isJobDefinition('nope')).toBe(false);
  });
});

describe('definition — pure retry decision helpers', () => {
  it('retryAttemptsRemaining counts down to zero', () => {
    const retry = { maxAttempts: 3, backoffScheduleMs: [], retryableErrorClasses: [] };
    expect(retryAttemptsRemaining(retry, 0)).toBe(3);
    expect(retryAttemptsRemaining(retry, 2)).toBe(1);
    expect(retryAttemptsRemaining(retry, 3)).toBe(0);
    expect(retryAttemptsRemaining(retry, 99)).toBe(0);
  });

  it('isRetryableErrorClass follows the declared classes only', () => {
    const retry = {
      maxAttempts: 3,
      backoffScheduleMs: [],
      retryableErrorClasses: ['transient'],
    };
    expect(isRetryableErrorClass(retry, 'transient')).toBe(true);
    expect(isRetryableErrorClass(retry, 'permanent')).toBe(false);
  });

  it('retryBackoffMs uses the schedule entry, repeats the last, and zero when empty', () => {
    const retry = { maxAttempts: 5, backoffScheduleMs: [10, 20], retryableErrorClasses: [] };
    expect(retryBackoffMs(retry, 1)).toBe(10);
    expect(retryBackoffMs(retry, 2)).toBe(20);
    expect(retryBackoffMs(retry, 3)).toBe(20); // last entry repeats
    expect(retryBackoffMs(retry, 4)).toBe(20);
    const empty = { maxAttempts: 3, backoffScheduleMs: [], retryableErrorClasses: [] };
    expect(retryBackoffMs(empty, 1)).toBe(0);
    expect(() => retryBackoffMs(retry, 0)).toThrow(JobError);
  });
});
