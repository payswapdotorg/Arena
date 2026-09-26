import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_KINDS,
  ENVELOPE_VERSION,
  envelopeDigest,
  isEnvelope,
  makeEnvelope,
  parseEnvelope,
  parseEnvelopeAs,
  serializeEnvelope,
  verifyEnvelope,
} from './envelope.js';
import { newCorrelationId, newIdempotencyKey, toCorrelationId } from './identifiers.js';
import { PROTOCOL_ERROR_CODES } from './protocol-error.js';
import { ProtocolError } from './protocol-error.js';
import { coreSchemaRef, formatSchemaRef, parseSchemaRef } from './schema-ref.js';

const correlationId = toCorrelationId('test-flow-1');

function commandEnvelope() {
  return makeEnvelope({
    kind: 'command',
    schema: coreSchemaRef('protocol/envelope'),
    correlationId,
    idempotencyKey: newIdempotencyKey(),
    payload: { action: 'demo', n: 1 },
  });
}

function validRaw(): string {
  return serializeEnvelope(
    makeEnvelope({
      kind: 'command',
      schema: coreSchemaRef('protocol/envelope'),
      correlationId,
      idempotencyKey: newIdempotencyKey(),
      payload: { value: 'original' },
    }),
  );
}

describe('makeEnvelope (positive)', () => {
  it('creates a fully populated, valid envelope', () => {
    const envelope = commandEnvelope();
    expect(envelope.v).toBe(1);
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/protocol/envelope@1.0.0');
    expect(envelope.correlationId).toBe('test-flow-1');
    expect(envelope.idempotencyKey).not.toBeNull();
    expect(envelope.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(envelope.payload).toEqual({ action: 'demo', n: 1 });
    expect(isEnvelope(envelope)).toBe(true);
  });

  it('accepts a raw schema ref string', () => {
    const envelope = makeEnvelope({
      kind: 'query',
      schema: 'arena:schema/protocol/envelope@1.0.0',
      correlationId,
      payload: null,
    });
    expect(envelope.schema).toBe('arena:schema/protocol/envelope@1.0.0');
  });

  it('nulls the idempotencyKey for non-command kinds', () => {
    for (const kind of ['event', 'query', 'response'] as const) {
      const envelope = makeEnvelope({
        kind,
        schema: coreSchemaRef('protocol/envelope'),
        correlationId,
        payload: null,
      });
      expect(envelope.idempotencyKey).toBeNull();
    }
  });

  it('exposes the closed kind list', () => {
    expect([...ENVELOPE_KINDS]).toEqual(['command', 'event', 'query', 'response']);
    expect(ENVELOPE_VERSION).toBe(1);
  });
});

describe('makeEnvelope (negative)', () => {
  it('rejects commands without an idempotency key', () => {
    expect(() =>
      makeEnvelope({
        kind: 'command',
        schema: coreSchemaRef('protocol/envelope'),
        correlationId,
        payload: null,
      }),
    ).toThrow(ProtocolError);
    try {
      makeEnvelope({
        kind: 'command',
        schema: coreSchemaRef('protocol/envelope'),
        correlationId,
        payload: null,
      });
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as ProtocolError).code).toBe(PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
    }
  });

  it('rejects malformed schema refs at construction', () => {
    expect(() =>
      makeEnvelope({
        kind: 'event',
        schema: 'not-a-schema-ref',
        correlationId,
        payload: null,
      }),
    ).toThrow(ProtocolError);
  });

  it('rejects an invalid correlation id', () => {
    expect(() =>
      makeEnvelope({
        kind: 'event',
        schema: coreSchemaRef('protocol/envelope'),
        correlationId: 'bad id!' as never,
        payload: null,
      }),
    ).toThrow(ProtocolError);
  });

  it('rejects a non-UUID id', () => {
    expect(() =>
      makeEnvelope({
        kind: 'event',
        schema: coreSchemaRef('protocol/envelope'),
        correlationId,
        id: 'not-a-uuid',
        payload: null,
      }),
    ).toThrow(ProtocolError);
  });

  it('rejects a non-RFC3339 issuedAt', () => {
    expect(() =>
      makeEnvelope({
        kind: 'event',
        schema: coreSchemaRef('protocol/envelope'),
        correlationId,
        issuedAt: 'yesterday',
        payload: null,
      }),
    ).toThrow(ProtocolError);
  });
});

describe('serialization + parsing (positive)', () => {
  it('serializes to canonical JSON with sorted keys', () => {
    const envelope = makeEnvelope({
      kind: 'event',
      schema: coreSchemaRef('protocol/envelope'),
      correlationId,
      idempotencyKey: null,
      id: '00000000-0000-4000-8000-000000000000',
      issuedAt: '2026-01-01T00:00:00.000Z',
      payload: { b: 2, a: 1 },
    });
    expect(serializeEnvelope(envelope)).toBe(
      '{"correlationId":"test-flow-1","id":"00000000-0000-4000-8000-000000000000",' +
        '"idempotencyKey":null,"issuedAt":"2026-01-01T00:00:00.000Z","kind":"event",' +
        '"payload":{"a":1,"b":2},"schema":"arena:schema/protocol/envelope@1.0.0","v":1}',
    );
  });

  it('round-trips serialize -> parse', () => {
    const envelope = commandEnvelope();
    const parsed = parseEnvelope(serializeEnvelope(envelope));
    expect(parsed).toEqual(envelope);
  });

  it('is deterministic regardless of payload key order', async () => {
    const a = makeEnvelope({
      kind: 'event', schema: coreSchemaRef('protocol/envelope'), correlationId,
      idempotencyKey: null, id: '00000000-0000-4000-8000-000000000001',
      issuedAt: '2026-01-01T00:00:00Z', payload: { x: 1, y: 2 },
    });
    const b = makeEnvelope({
      kind: 'event', schema: coreSchemaRef('protocol/envelope'), correlationId,
      idempotencyKey: null, id: '00000000-0000-4000-8000-000000000001',
      issuedAt: '2026-01-01T00:00:00Z', payload: { y: 2, x: 1 },
    });
    expect(serializeEnvelope(a)).toBe(serializeEnvelope(b));
    expect(await envelopeDigest(a)).toBe(await envelopeDigest(b));
  });

  it('duplicate wire keys collapse deterministically (JSON.parse last-wins)', () => {
    const raw =
      '{"v":9,"v":1,"kind":"event","schema":"arena:schema/protocol/envelope@1.0.0",' +
      '"id":"00000000-0000-4000-8000-000000000000","correlationId":"test-flow-1",' +
      '"idempotencyKey":null,"issuedAt":"2026-01-01T00:00:00Z","payload":null}';
    const parsed = parseEnvelope(raw);
    expect(parsed.v).toBe(1);
  });
});

describe('parsing (negative — tampered/invalid envelopes must fail)', () => {
  const expectCode = (raw: string, code: string): void => {
    try {
      parseEnvelope(raw);
      expect.unreachable('must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe(code);
    }
  };

  it('rejects non-JSON input (PROTOCOL_INVALID_JSON)', () => {
    expectCode('not json at all {', PROTOCOL_ERROR_CODES.INVALID_JSON);
  });

  it('rejects non-object envelopes', () => {
    expectCode('[]', PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
    expectCode('null', PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
    expectCode('"envelope"', PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
  });

  it('rejects unknown wire versions (PROTOCOL_UNSUPPORTED_VERSION)', () => {
    const raw = validRaw().replace('"v":1', '"v":2');
    expectCode(raw, PROTOCOL_ERROR_CODES.UNSUPPORTED_VERSION);
  });

  it('rejects a missing wire version', () => {
    const parsed = JSON.parse(validRaw()) as Record<string, unknown>;
    delete parsed['v'];
    expectCode(JSON.stringify(parsed), PROTOCOL_ERROR_CODES.UNSUPPORTED_VERSION);
  });

  it('rejects unknown kinds', () => {
    const raw = validRaw().replace('"kind":"command"', '"kind":"COMMAND"');
    expectCode(raw, PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
  });

  it('rejects malformed schema refs', () => {
    const raw = validRaw().replace(
      '"schema":"arena:schema/protocol/envelope@1.0.0"',
      '"schema":"envelope@1"',
    );
    expectCode(raw, PROTOCOL_ERROR_CODES.INVALID_SCHEMA_REF);
  });

  it('rejects ids that are not lowercase UUIDv4', () => {
    const raw = validRaw().replace(
      /"id":"[0-9a-f-]+"/,
      '"id":"NOT-A-UUID"',
    );
    expectCode(raw, PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
  });

  it('rejects uppercase UUID ids (wire form is lowercase)', () => {
    const raw = validRaw().replace(
      /"id":"[0-9a-f-]+"/,
      '"id":"AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"',
    );
    expectCode(raw, PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
  });
  it('rejects invalid correlation ids', () => {
    const raw = validRaw().replace('"correlationId":"test-flow-1"', '"correlationId":"bad id"');
    expectCode(raw, PROTOCOL_ERROR_CODES.INVALID_CORRELATION_ID);
  });

  it('rejects a missing correlation id', () => {
    const parsed = JSON.parse(validRaw()) as Record<string, unknown>;
    delete parsed['correlationId'];
    expectCode(JSON.stringify(parsed), PROTOCOL_ERROR_CODES.INVALID_CORRELATION_ID);
  });

  it('rejects invalid idempotency keys', () => {
    const raw = validRaw().replace(/"idempotencyKey":"[0-9a-f-]+"/, '"idempotencyKey":"nope!"');
    expectCode(raw, PROTOCOL_ERROR_CODES.INVALID_IDEMPOTENCY_KEY);
  });

  it('rejects a missing idempotencyKey field', () => {
    const parsed = JSON.parse(validRaw()) as Record<string, unknown>;
    delete parsed['idempotencyKey'];
    expectCode(JSON.stringify(parsed), PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
  });

  it('rejects parsed commands with null idempotencyKey', () => {
    const parsed = JSON.parse(validRaw()) as Record<string, unknown>;
    parsed['idempotencyKey'] = null;
    expectCode(JSON.stringify(parsed), PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
  });

  it('rejects a missing payload field', () => {
    const parsed = JSON.parse(validRaw()) as Record<string, unknown>;
    delete parsed['payload'];
    expectCode(JSON.stringify(parsed), PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
  });

  it('rejects invalid issuedAt timestamps', () => {
    const raw = validRaw().replace(/"issuedAt":"[^"]+"/, '"issuedAt":"2026-13-45T99:99:99Z"');
    expectCode(raw, PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
  });
});

describe('digest + verify (positive and negative)', () => {
  it('digest is stable across calls', async () => {
    const envelope = commandEnvelope();
    expect(await envelopeDigest(envelope)).toBe(await envelopeDigest(envelope));
  });

  it('verifyEnvelope accepts an untampered envelope', async () => {
    const raw = validRaw();
    const digest = await envelopeDigest(parseEnvelope(raw));
    const verified = await verifyEnvelope(raw, digest);
    expect(verified.kind).toBe('command');
  });

  it('verifyEnvelope rejects a tampered payload (PROTOCOL_ENVELOPE_TAMPERED)', async () => {
    const raw = validRaw();
    const digest = await envelopeDigest(parseEnvelope(raw));
    const tampered = raw.replace('"value":"original"', '"value":"tampered"');
    expect(tampered).not.toBe(raw);
    await expect(verifyEnvelope(tampered, digest)).rejects.toBeInstanceOf(ProtocolError);
    await expect(verifyEnvelope(tampered, digest)).rejects.toMatchObject({
      code: PROTOCOL_ERROR_CODES.ENVELOPE_TAMPERED,
    });
  });

  it('verifyEnvelope rejects a wrong expected digest', async () => {
    const raw = validRaw();
    await expect(verifyEnvelope(raw, '0'.repeat(64))).rejects.toMatchObject({
      code: PROTOCOL_ERROR_CODES.ENVELOPE_TAMPERED,
    });
  });
});

describe('typed parsing (schema pinning)', () => {
  it('accepts the expected schema', () => {
    const raw = validRaw();
    const envelope = parseEnvelopeAs<{ value: string }>(raw, coreSchemaRef('protocol/envelope'));
    expect(envelope.payload.value).toBe('original');
  });

  it('rejects a schema mismatch (PROTOCOL_SCHEMA_MISMATCH)', () => {
    const raw = validRaw();
    expect(() =>
      parseEnvelopeAs(raw, 'arena:schema/capability-case/case@1.0.0'),
    ).toThrow(ProtocolError);
    try {
      parseEnvelopeAs(raw, 'arena:schema/capability-case/case@1.0.0');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as ProtocolError).code).toBe(PROTOCOL_ERROR_CODES.SCHEMA_MISMATCH);
    }
  });
});

describe('structural guard + misc', () => {
  it('isEnvelope accepts envelopes and rejects junk', () => {
    expect(isEnvelope(commandEnvelope())).toBe(true);
    expect(isEnvelope({})).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope('envelope')).toBe(false);
    expect(isEnvelope({ v: 1, kind: 'event' })).toBe(false);
  });

  it('schema helpers agree with envelope schema fields', () => {
    const envelope = commandEnvelope();
    expect(parseSchemaRef(envelope.schema).name).toBe('envelope');
    expect(formatSchemaRef(coreSchemaRef('protocol/envelope'))).toBe(envelope.schema);
    expect(newCorrelationId()).not.toBe(newCorrelationId());
  });
});
