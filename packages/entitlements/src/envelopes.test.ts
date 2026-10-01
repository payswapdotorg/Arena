import { describe, expect, it } from 'vitest';
import { ProtocolError, serializeEnvelope, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
  entitlementEnvelopeDigest,
  entitlementSchemaRef,
  isKnownEntitlementSchema,
  makeRecordUsageCommand,
  makeUsageMeterEventEnvelope,
  parseEntitlementEnvelope,
  toUsageRecordedEvent,
  verifyEntitlementEnvelope,
} from './index.js';
import type { UsageMeterEvent } from './index.js';
import { FEATURE_COMPUTE, TENANT_A, T0, T1 } from './test-support.js';

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EntitlementError);
    expect((error as EntitlementError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected EntitlementError ${code}`);
}

const correlationId = toCorrelationId('corr-ent-0001');
const idempotencyKey = toIdempotencyKey('idem-ent-0001');

describe('record-usage command envelopes (rule 17 idempotency)', () => {
  it('creates a command envelope pinned to the entitlements schema', () => {
    const envelope = makeRecordUsageCommand(
      { tenantId: TENANT_A, featureKey: FEATURE_COMPUTE, units: 5 },
      { correlationId, idempotencyKey, issuedAt: T0 },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/entitlements/record-usage-command@1.0.0');
    expect(envelope.idempotencyKey).toBe(idempotencyKey);
    expect(envelope.correlationId).toBe(correlationId);
  });

  it('REQUIRES a non-null idempotency key', () => {
    expectCode(
      () =>
        makeRecordUsageCommand(
          { tenantId: TENANT_A, featureKey: FEATURE_COMPUTE, units: 5 },
          { correlationId },
        ),
      ENTITLEMENT_ERROR_CODES.INVALID_COMMAND,
    );
  });

  it('rejects structurally invalid payloads (fail closed)', () => {
    expectCode(
      () =>
        makeRecordUsageCommand(
          { tenantId: 'NOT A TENANT', featureKey: FEATURE_COMPUTE, units: 5 },
          { correlationId, idempotencyKey },
        ),
      ENTITLEMENT_ERROR_CODES.INVALID_COMMAND,
    );
    expectCode(
      () =>
        makeRecordUsageCommand(
          { tenantId: TENANT_A, featureKey: FEATURE_COMPUTE, units: 0 },
          { correlationId, idempotencyKey },
        ),
      ENTITLEMENT_ERROR_CODES.INVALID_COMMAND,
    );
  });
});

describe('usage-meter event envelopes', () => {
  it('wraps a validated event with the usage-recorded schema', () => {
    const event = toUsageRecordedEvent({
      sequence: 1,
      occurredAt: T0,
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      units: 5,
    });
    const envelope = makeUsageMeterEventEnvelope(event, { correlationId, issuedAt: T0 });
    expect(envelope.kind).toBe('event');
    expect(envelope.schema).toBe('arena:schema/entitlements/usage-recorded-event@1.0.0');
    expect(envelope.idempotencyKey).toBeNull();
  });

  it('rejects an invalid event payload before wrapping', () => {
    expectCode(
      () =>
        makeUsageMeterEventEnvelope(
          {
            eventVersion: 1,
            kind: 'usage-recorded',
            sequence: 1,
            occurredAt: T0,
            tenantId: TENANT_A,
            featureKey: FEATURE_COMPUTE,
            units: -1,
          } as unknown as Parameters<typeof makeUsageMeterEventEnvelope>[0],
          { correlationId },
        ),
      ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT,
    );
  });
});

describe('schema registry', () => {
  it('resolves refs and recognizes only the registered version', () => {
    const ref = entitlementSchemaRef('entitlements/entitlement-grant');
    expect(ref.namespace).toBe('entitlements');
    expect(isKnownEntitlementSchema(ref)).toBe(true);
    expect(
      isKnownEntitlementSchema({ ...ref, version: '2.0.0' }),
    ).toBe(false);
  });
});

describe('wire round trips (parse / digest / tamper)', () => {
  it('round-trips a command envelope through canonical JSON', () => {
    const envelope = makeRecordUsageCommand(
      { tenantId: TENANT_A, featureKey: FEATURE_COMPUTE, units: 5 },
      { correlationId, idempotencyKey, issuedAt: T0, id: '00000000-0000-4000-8000-000000000001' },
    );
    const raw = serializeEnvelope(envelope);
    const parsed = parseEntitlementEnvelope(raw, 'entitlements/record-usage-command');
    expect(parsed.payload).toEqual(envelope.payload);
  });

  it('pins the expected schema (PROTOCOL_SCHEMA_MISMATCH otherwise)', () => {
    const envelope = makeUsageMeterEventEnvelope(
      toUsageRecordedEvent({
        sequence: 1,
        occurredAt: T0,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 5,
      }),
      { correlationId, issuedAt: T0, id: '00000000-0000-4000-8000-000000000002' },
    );
    const raw = serializeEnvelope(envelope);
    expect(() =>
      parseEntitlementEnvelope(raw, 'entitlements/record-usage-command'),
    ).toThrow(ProtocolError);
    expect(
      parseEntitlementEnvelope<UsageMeterEvent>(raw, 'entitlements/usage-recorded-event').payload.kind,
    ).toBe('usage-recorded');
  });

  it('rejects an unknown envelope wire version', () => {
    const envelope = makeRecordUsageCommand(
      { tenantId: TENANT_A, featureKey: FEATURE_COMPUTE, units: 5 },
      { correlationId, idempotencyKey, issuedAt: T0, id: '00000000-0000-4000-8000-000000000003' },
    );
    const raw = serializeEnvelope(envelope).replace('"v":1', '"v":2');
    expect(() => parseEntitlementEnvelope(raw)).toThrow(ProtocolError);
  });

  it('digest is deterministic and tampering is detected', async () => {
    const envelope = makeUsageMeterEventEnvelope(
      toUsageRecordedEvent({
        sequence: 1,
        occurredAt: T1,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 7,
      }),
      { correlationId, issuedAt: T1, id: '00000000-0000-4000-8000-000000000004' },
    );
    const raw = serializeEnvelope(envelope);
    const digest = await entitlementEnvelopeDigest(envelope);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await entitlementEnvelopeDigest(envelope)).toBe(digest);
    await expect(verifyEntitlementEnvelope(raw, digest)).resolves.toBeTruthy();
    const tampered = raw.replace('"units":7', '"units":70');
    await expect(verifyEntitlementEnvelope(tampered, digest)).rejects.toThrow(ProtocolError);
  });
});
