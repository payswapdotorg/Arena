import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_ERROR_CODES,
  newIdempotencyKey,
  serializeEnvelope,
  toCorrelationId,
} from '@arena/protocol-core';
import {
  PROVENANCE_SCHEMAS,
  PROVENANCE_SCHEMA_VERSION,
  isKnownProvenanceSchema,
  makeProvenanceRecordedEvent,
  makeRecordProvenanceCommand,
  parseProvenanceEnvelope,
  provenanceEnvelopeDigest,
  provenanceSchemaRef,
  verifyProvenanceEnvelope,
} from './envelopes.js';
import { createProvenanceRecord } from './record.js';
import type { ArtifactRefView } from './shared.js';

const correlationId = toCorrelationId('provenance-flow-1');

function sampleRecord() {
  const corpus: ArtifactRefView = {
    namespace: 'acme',
    name: 'source-corpus',
    version: '1.0.0',
    digest: 'a'.repeat(64),
  };
  return createProvenanceRecord({
    artifact: { namespace: 'acme', name: 'reference-dataset', version: '1.4.2', digest: 'b'.repeat(64) },
    creator: { type: 'expert', tenant: 'acme', principalId: 'expert-42' },
    createdAt: '2026-09-26T12:00:00.000Z',
    parents: [{ parent: corpus, relation: 'derived-from' }],
    transformation: {
      transform: { namespace: 'acme', name: 'clean-and-normalize', version: '3.1.0', digest: 'e'.repeat(64) },
      inputs: [corpus],
    },
    rights: {
      license: 'CC-BY-4.0',
      commercialUse: 'allowed',
      redistribution: 'tenant-only',
      customerData: 'derived',
    },
    verification: [],
  });
}

describe('Provenance envelopes (positive)', () => {
  it('makes an idempotency-keyed record-provenance command', () => {
    const envelope = makeRecordProvenanceCommand(
      { record: sampleRecord() },
      { correlationId, idempotencyKey: newIdempotencyKey() },
    );
    expect(envelope.v).toBe(1);
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/provenance/record-provenance-command@1.0.0');
    expect(envelope.correlationId).toBe('provenance-flow-1');
    expect(envelope.idempotencyKey).not.toBeNull();
  });

  it('round-trips with schema pinning and digest verification', async () => {
    const record = sampleRecord();
    const command = makeRecordProvenanceCommand(
      { record },
      { correlationId, idempotencyKey: newIdempotencyKey() },
    );
    const raw = serializeEnvelope(command);
    const parsed = parseProvenanceEnvelope<{ record: typeof record }>(
      raw,
      'provenance/record-provenance-command',
    );
    expect(parsed.payload.record).toEqual(record);

    const digest = await provenanceEnvelopeDigest(command);
    await expect(verifyProvenanceEnvelope(raw, digest)).resolves.toBeDefined();
  });

  it('emits provenance-recorded events', () => {
    const record = sampleRecord();
    const event = makeProvenanceRecordedEvent({ record }, { correlationId });
    expect(event.kind).toBe('event');
    expect(event.idempotencyKey).toBeNull();
    expect(event.schema).toBe('arena:schema/provenance/provenance-recorded-event@1.0.0');
  });

  it('exposes the schema registry with consistent versions', () => {
    expect(PROVENANCE_SCHEMA_VERSION).toBe('1.0.0');
    expect(Object.keys(PROVENANCE_SCHEMAS)).toHaveLength(8);
    for (const [name, version] of Object.entries(PROVENANCE_SCHEMAS)) {
      expect(version).toBe(PROVENANCE_SCHEMA_VERSION);
      const ref = provenanceSchemaRef(name as keyof typeof PROVENANCE_SCHEMAS);
      expect(ref.namespace).toBe('provenance');
      expect(isKnownProvenanceSchema(ref)).toBe(true);
    }
    expect(
      isKnownProvenanceSchema({ namespace: 'provenance', name: 'envelope', version: '1.0.0' }),
    ).toBe(false);
  });
});

describe('Provenance envelopes (negative — protocol tripwires)', () => {
  it('a command without an idempotency key is rejected at construction', () => {
    expect(() =>
      makeRecordProvenanceCommand({ record: sampleRecord() }, { correlationId }),
    ).toThrow(/idempotency key/);
  });

  it('a wire command missing its idempotency key is rejected by the core parser', () => {
    const envelope = makeRecordProvenanceCommand(
      { record: sampleRecord() },
      { correlationId, idempotencyKey: newIdempotencyKey() },
    );
    const parsed = JSON.parse(serializeEnvelope(envelope)) as Record<string, unknown>;
    delete parsed['idempotencyKey'];
    try {
      parseProvenanceEnvelope(JSON.stringify(parsed));
      expect.unreachable('missing idempotencyKey must fail');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
    }
  });

  it('unknown envelope versions are rejected', () => {
    const envelope = makeRecordProvenanceCommand(
      { record: sampleRecord() },
      { correlationId, idempotencyKey: newIdempotencyKey() },
    );
    const parsed = JSON.parse(serializeEnvelope(envelope)) as Record<string, unknown>;
    parsed['v'] = 99;
    try {
      parseProvenanceEnvelope(JSON.stringify(parsed));
      expect.unreachable('unknown envelope version must fail');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(PROTOCOL_ERROR_CODES.UNSUPPORTED_VERSION);
    }
  });

  it('tampered envelopes fail digest verification', async () => {
    const envelope = makeRecordProvenanceCommand(
      { record: sampleRecord() },
      { correlationId, idempotencyKey: newIdempotencyKey() },
    );
    const raw = serializeEnvelope(envelope);
    const digest = await provenanceEnvelopeDigest(envelope);
    const tampered = JSON.parse(raw) as { payload: { record: { createdAt: string } } };
    tampered.payload.record.createdAt = '2020-01-01T00:00:00.000Z';
    await expect(verifyProvenanceEnvelope(JSON.stringify(tampered), digest)).rejects.toMatchObject(
      { code: PROTOCOL_ERROR_CODES.ENVELOPE_TAMPERED },
    );
  });

  it('schema pinning rejects the wrong payload schema', () => {
    const envelope = makeProvenanceRecordedEvent({ record: sampleRecord() }, { correlationId });
    const raw = serializeEnvelope(envelope);
    try {
      parseProvenanceEnvelope(raw, 'provenance/record-provenance-command');
      expect.unreachable('schema mismatch must fail');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(PROTOCOL_ERROR_CODES.SCHEMA_MISMATCH);
    }
  });

  it('invalid payloads are rejected at construction', () => {
    expect(() =>
      makeRecordProvenanceCommand({ record: { recordVersion: 1 } as never }, {
        correlationId,
        idempotencyKey: newIdempotencyKey(),
      }),
    ).toThrow(/structurally valid record/);
    expect(() =>
      makeProvenanceRecordedEvent({ record: null as never }, { correlationId }),
    ).toThrow(/structurally valid record/);
  });
});
