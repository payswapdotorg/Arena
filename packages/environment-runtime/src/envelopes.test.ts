/**
 * Envelope wiring tests (Work Order A010 gate 4; lock rules 17, 18, 22):
 *   - commands REQUIRE non-null idempotency keys and pin their payload
 *     schema (core envelope, reused — never reimplemented);
 *   - lifecycle event envelopes carry correlation id AND idempotency
 *     key (gate 4);
 *   - wire round-trips: serialize → parse → verify (tamper tripwire).
 */

import { describe, expect, it } from 'vitest';
import {
  newCorrelationId,
  serializeEnvelope,
  toCorrelationId,
  toIdempotencyKey,
} from '@arena/protocol-core';
import { EnvironmentRuntimeError } from './errors.js';
import {
  ENVIRONMENT_RUNTIME_SCHEMAS,
  ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  environmentRuntimeSchemaRef,
  isKnownEnvironmentRuntimeSchema,
  makeAdvanceRunCommand,
  makeCheckpointRunCommand,
  makeCleanupRunCommand,
  makeCompleteRunCommand,
  makeFailRunCommand,
  makeRestoreRunCommand,
  makeRuntimeEventEnvelope,
  makeStartRunCommand,
  makeSubmitRunCommand,
  parseRuntimeEnvelope,
  runtimeEnvelopeDigest,
  runtimeEventSchemaName,
  verifyRuntimeEnvelope,
} from './envelopes.js';
import { makeRunSubmittedEvent, makeStateTransitionedEvent } from './events.js';
import { DIGEST_C, T1, TENANT_A } from './test-support.js';

const CORR = newCorrelationId();
const IDEM = toIdempotencyKey('idem-1');

describe('envelope wiring (gate 4)', () => {
  it('builds every command with a required idempotency key (positive)', () => {
    const context = { correlationId: CORR, idempotencyKey: IDEM };
    const commands = [
      makeSubmitRunCommand(
        {
          declaration: {
            runKey: 'run-000042',
            tenantId: TENANT_A,
            environment: { namespace: 'tenant-a', name: 'engineering-sandbox', version: '1.2.0', digest: DIGEST_C },
            jobRef: 'job-7f3a2b',
            taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
            initialSnapshotDigest: DIGEST_C,
            seed: 'seed-1234',
            resourceEnvelope: { cpuMillis: 2000, memoryMiB: 512, wallClockSeconds: 600 },
            networkEnvelope: { egress: 'default-deny' },
            filesystemEnvelope: { writeMode: 'read-only' },
            secretEnvelope: { isolation: 'isolation-boundary' },
          },
        },
        context,
      ),
      makeStartRunCommand({ runId: 'tenant-a/run-000042', tenantId: TENANT_A }, context),
      makeAdvanceRunCommand({ runId: 'tenant-a/run-000042', tenantId: TENANT_A }, context),
      makeCheckpointRunCommand({ runId: 'tenant-a/run-000042', tenantId: TENANT_A }, context),
      makeRestoreRunCommand(
        {
          runId: 'tenant-a/run-000042',
          tenantId: TENANT_A,
          checkpoint: { runId: 'tenant-a/run-000042', sequence: 1, snapshotDigest: DIGEST_C },
        },
        context,
      ),
      makeCompleteRunCommand({ runId: 'tenant-a/run-000042', tenantId: TENANT_A }, context),
      makeFailRunCommand(
        { runId: 'tenant-a/run-000042', tenantId: TENANT_A, errorClass: 'workload-error', message: 'boom' },
        context,
      ),
      makeCleanupRunCommand({ runId: 'tenant-a/run-000042', tenantId: TENANT_A }, context),
    ];
    for (const command of commands) {
      expect(command.kind).toBe('command');
      expect(command.v).toBe(1);
      expect(command.idempotencyKey).toBe(IDEM);
      expect(command.correlationId).toBe(CORR);
      expect(command.schema.startsWith('arena:schema/environment-runtime/')).toBe(true);
      const namePart = command.schema.split('@')[0]?.split('/')[2];
      expect(namePart).toBeDefined();
      expect(
        isKnownEnvironmentRuntimeSchema({
          namespace: 'environment-runtime',
          name: namePart ?? '',
          version: ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
        }),
      ).toBe(true);
    }
    // Each command pins its own schema.
    const schemas = new Set(commands.map((command) => command.schema));
    expect(schemas.size).toBe(8);
  });

  it('rejects commands without an idempotency key (negative, lock rule 17)', () => {
    expect(() =>
      makeStartRunCommand(
        { runId: 'tenant-a/run-000042', tenantId: TENANT_A },
        { correlationId: CORR, idempotencyKey: undefined as never },
      ),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeStartRunCommand(
        { runId: 'tenant-a/run-000042', tenantId: TENANT_A },
        { correlationId: CORR, idempotencyKey: null as never },
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('event envelopes carry correlation AND idempotency keys (positive, gate 4)', () => {
    const envelope = makeRuntimeEventEnvelope(
      makeStateTransitionedEvent({
        runId: 'tenant-a/run-000042',
        tenantId: TENANT_A,
        sequence: 3,
        occurredAt: T1,
        from: 'requested',
        to: 'provisioning',
        lifecycleEvent: 'provision-started',
      }),
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(envelope.kind).toBe('event');
    expect(envelope.idempotencyKey).toBe(IDEM);
    expect(envelope.schema).toBe(
      'arena:schema/environment-runtime/state-transitioned-event@1.0.0',
    );
  });

  it('event envelopes REQUIRE an idempotency key (negative, gate 4)', () => {
    expect(() =>
      makeRuntimeEventEnvelope(
        makeRunSubmittedEvent({
          runId: 'tenant-a/run-000042',
          tenantId: TENANT_A,
          sequence: 1,
          occurredAt: T1,
          recordDigest: DIGEST_C,
          jobRef: 'job-1',
          seed: null,
        }),
        { correlationId: CORR, idempotencyKey: undefined as never },
      ),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeRuntimeEventEnvelope(null as never, { correlationId: CORR, idempotencyKey: IDEM }),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('round-trips through the wire with digest verification (positive)', async () => {
    const envelope = makeRuntimeEventEnvelope(
      makeRunSubmittedEvent({
        runId: 'tenant-a/run-000042',
        tenantId: TENANT_A,
        sequence: 1,
        occurredAt: T1,
        recordDigest: DIGEST_C,
        jobRef: 'job-1',
        seed: null,
      }),
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    const raw = serializeEnvelope(envelope);
    const digest = await runtimeEnvelopeDigest(envelope);
    const parsed = await verifyRuntimeEnvelope(raw, digest);
    expect(parsed.payload).toEqual(envelope.payload);
    const pinned = parseRuntimeEnvelope(raw, 'environment-runtime/run-submitted-event');
    expect(pinned.id).toBe(envelope.id);
    // Schema pinning rejects a mismatched expectation.
    expect(() =>
      parseRuntimeEnvelope(raw, 'environment-runtime/state-transitioned-event'),
    ).toThrow();
  });

  it('detects wire tampering (negative)', async () => {
    const envelope = makeRuntimeEventEnvelope(
      makeRunSubmittedEvent({
        runId: 'tenant-a/run-000042',
        tenantId: TENANT_A,
        sequence: 1,
        occurredAt: T1,
        recordDigest: DIGEST_C,
        jobRef: 'job-1',
        seed: null,
      }),
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    const digest = await runtimeEnvelopeDigest(envelope);
    const tampered = serializeEnvelope({ ...envelope, payload: { ...envelope.payload, sequence: 9 } });
    await expect(verifyRuntimeEnvelope(tampered, digest)).rejects.toThrow();
  });

  it('schema registry is closed and versioned (positive)', () => {
    expect(Object.keys(ENVIRONMENT_RUNTIME_SCHEMAS).length).toBe(23);
    expect(environmentRuntimeSchemaRef('environment-runtime/run-record')).toEqual({
      namespace: 'environment-runtime',
      name: 'run-record',
      version: ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
    });
    expect(
      environmentRuntimeSchemaRef('environment-runtime/run-record'),
    ).toMatchObject({ version: '1.0.0' });
    expect(
      isKnownEnvironmentRuntimeSchema({
        namespace: 'environment-runtime',
        name: 'run-record',
        version: '9.9.9',
      }),
    ).toBe(false);
    expect(runtimeEventSchemaName('run-submitted')).toBe(
      'environment-runtime/run-submitted-event',
    );
    expect(runtimeEventSchemaName('checkpoint-recorded')).toBe(
      'environment-runtime/checkpoint-recorded-event',
    );
    // toCorrelationId from protocol-core is reused (never reimplemented):
    expect(toCorrelationId('corr-1')).toBe('corr-1');
    expect(() => environmentRuntimeSchemaRef('environment-runtime/nope' as never)).toThrow(
      EnvironmentRuntimeError,
    );
  });
});
