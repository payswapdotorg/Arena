import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_VERSION,
  envelopeDigest,
  isEnvelope,
  makeEnvelope,
  newCorrelationId,
  newIdempotencyKey,
  parseEnvelope,
  PROTOCOL_ERROR_CODES,
  serializeEnvelope,
  verifyEnvelope,
  coreSchemaRef,
} from '@arena/protocol-core';

const correlationId = newCorrelationId();

describe('@arena/web consumes @arena/protocol-core (layer: app -> package)', () => {
  it('builds, serializes, digests and verifies an envelope (positive)', async () => {
    const envelope = makeEnvelope({
      kind: 'command',
      schema: coreSchemaRef('protocol/envelope'),
      correlationId,
      idempotencyKey: newIdempotencyKey(),
      payload: { app: 'arena-web', action: 'selfcheck' },
    });

    expect(isEnvelope(envelope)).toBe(true);
    expect(envelope.v).toBe(ENVELOPE_VERSION);

    const wire = serializeEnvelope(envelope);
    const digest = await envelopeDigest(envelope);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);

    const verified = await verifyEnvelope(wire, digest);
    expect(verified.id).toBe(envelope.id);
    expect(parseEnvelope(wire)).toEqual(envelope);
  });

  it('rejects a tampered envelope (negative)', async () => {
    const envelope = makeEnvelope({
      kind: 'event',
      schema: coreSchemaRef('protocol/envelope'),
      correlationId,
      payload: { trusted: true },
    });
    const digest = await envelopeDigest(envelope);
    const tampered = serializeEnvelope(envelope).replace('"trusted":true', '"trusted":false');

    await expect(verifyEnvelope(tampered, digest)).rejects.toMatchObject({
      code: PROTOCOL_ERROR_CODES.ENVELOPE_TAMPERED,
    });
  });

  it('rejects an unknown envelope wire version (negative)', () => {
    const wire = serializeEnvelope(
      makeEnvelope({
        kind: 'event',
        schema: coreSchemaRef('protocol/envelope'),
        correlationId,
        payload: null,
      }),
    ).replace('"v":1', '"v":99');

    expect(() => parseEnvelope(wire)).toThrowError(
      /unsupported envelope wire version/,
    );
  });
});
