/**
 * Envelope tests (Work Order A021): command/event construction, the
 * required idempotency key on commands, schema wiring, parsing and
 * tamper tripwires (mirrors the sibling protocols' envelope suites).
 */

import { describe, expect, it } from 'vitest';
import { serializeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import {
  BODY_FORGE_ERROR_CODES,
  BODY_FORGE_PROTOCOL_VERSION,
  BODY_FORGE_SCHEMAS,
  BODY_FORGE_SCHEMA_REGISTRY,
  bodyForgeEnvelopeDigest,
  bodyForgeSchemaRef,
  checkBodyForgeEnvelope,
  isKnownBodyForgeSchema,
  makeForgeCompletedEvent,
  makeSubmitForgeCommand,
  parseBodyForgeEnvelope,
} from './index.js';
import { CORR_ID, DIGEST_A, DIGEST_B, DIGEST_C, expectSyncCode } from './test-support.js';

const CORR = CORR_ID as CorrelationId;
const KEY = 'forge-key-0001' as IdempotencyKey;

describe('schema registry', () => {
  it('owns the body-forge namespace at the registered versions', () => {
    expect(BODY_FORGE_PROTOCOL_VERSION).toBe('1.0.0');
    expect(Object.keys(BODY_FORGE_SCHEMAS).sort()).toEqual([
      'body-forge/body-manifest',
      'body-forge/forge-completed-event',
      'body-forge/forge-error',
      'body-forge/forge-policy',
      'body-forge/forge-recipe',
      'body-forge/forge-record',
      'body-forge/schema-registry',
      'body-forge/submit-forge-command',
    ]);
    expect(BODY_FORGE_SCHEMA_REGISTRY['body-forge/forge-record']).toBe('1.0.0');
    const ref = bodyForgeSchemaRef('body-forge/submit-forge-command');
    expect(ref).toEqual({ namespace: 'body-forge', name: 'submit-forge-command', version: '1.0.0' });
    expect(isKnownBodyForgeSchema(ref)).toBe(true);
    expect(isKnownBodyForgeSchema({ ...ref, version: '9.9.9' })).toBe(false);
  });

  it('rejects unknown schema names', () => {
    expectSyncCode(
      () => bodyForgeSchemaRef('body-forge/nope' as never),
      BODY_FORGE_ERROR_CODES.INVALID_SCHEMA_REF,
    );
  });
});

describe('submit-forge-command', () => {
  it('carries a REQUIRED idempotency key (lock rule 17)', () => {
    const envelope = makeSubmitForgeCommand(
      { manifestDigest: DIGEST_A, policyDigest: DIGEST_B },
      { correlationId: CORR, idempotencyKey: KEY },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.idempotencyKey).toBe('forge-key-0001');
    expect(envelope.schema).toBe('arena:schema/body-forge/submit-forge-command@1.0.0');
    expect(envelope.payload).toEqual({ manifestDigest: DIGEST_A, policyDigest: DIGEST_B });
    expectSyncCode(
      () => makeSubmitForgeCommand({ manifestDigest: DIGEST_A, policyDigest: DIGEST_B }, { correlationId: CORR }),
      BODY_FORGE_ERROR_CODES.INVALID_RECORD,
    );
  });

  it('rejects malformed payload digests', () => {
    expectSyncCode(
      () =>
        makeSubmitForgeCommand(
          { manifestDigest: 'nope', policyDigest: DIGEST_B },
          { correlationId: CORR, idempotencyKey: KEY },
        ),
      BODY_FORGE_ERROR_CODES.INVALID_DIGEST,
    );
    expectSyncCode(
      () =>
        makeSubmitForgeCommand(
          { manifestDigest: DIGEST_A, policyDigest: 1 as never },
          { correlationId: CORR, idempotencyKey: KEY },
        ),
      BODY_FORGE_ERROR_CODES.INVALID_DIGEST,
    );
  });
});

describe('forge-completed-event', () => {
  it('carries the authoritative record + version digests', () => {
    const envelope = makeForgeCompletedEvent(
      { forgeRecordDigest: DIGEST_B, bodyVersionDigest: DIGEST_C },
      { correlationId: CORR },
    );
    expect(envelope.kind).toBe('event');
    expect(envelope.idempotencyKey).toBeNull();
    expect(envelope.payload).toEqual({ forgeRecordDigest: DIGEST_B, bodyVersionDigest: DIGEST_C });
  });

  it('rejects malformed payload digests', () => {
    expectSyncCode(
      () => makeForgeCompletedEvent({ forgeRecordDigest: 'x', bodyVersionDigest: DIGEST_C }, { correlationId: CORR }),
      BODY_FORGE_ERROR_CODES.INVALID_DIGEST,
    );
    expectSyncCode(
      () => makeForgeCompletedEvent({ forgeRecordDigest: DIGEST_B, bodyVersionDigest: null as never }, { correlationId: CORR }),
      BODY_FORGE_ERROR_CODES.INVALID_DIGEST,
    );
  });
});

describe('parsing and integrity', () => {
  it('round-trips through the core parser with schema pinning', async () => {
    const command = makeSubmitForgeCommand(
      { manifestDigest: DIGEST_A, policyDigest: DIGEST_B },
      { correlationId: CORR, idempotencyKey: KEY },
    );
    const raw = serializeEnvelope(command);
    const parsed = parseBodyForgeEnvelope<{ manifestDigest: string; policyDigest: string }>(
      raw,
      'body-forge/submit-forge-command',
    );
    expect(parsed.payload).toEqual(command.payload);
    const digest = await bodyForgeEnvelopeDigest(command);
    const checked = await checkBodyForgeEnvelope(raw, digest);
    expect(checked.id).toBe(command.id);
  });

  it('the tamper tripwire rejects mutated wire forms', async () => {
    const command = makeSubmitForgeCommand(
      { manifestDigest: DIGEST_A, policyDigest: DIGEST_B },
      { correlationId: CORR, idempotencyKey: KEY },
    );
    const raw = serializeEnvelope(command);
    const digest = await bodyForgeEnvelopeDigest(command);
    await expect(checkBodyForgeEnvelope(raw.replace(DIGEST_A, DIGEST_C), digest)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.TAMPERED,
    });
  });

  it('the core parser rejects malformed wire forms (fail closed)', () => {
    expect(() => parseBodyForgeEnvelope('not json')).toThrow();
    expect(() => parseBodyForgeEnvelope('{"v":99}')).toThrow();
  });
});
