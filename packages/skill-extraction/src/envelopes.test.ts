/**
 * Envelope wiring tests (Work Order A019; architecture-lock rules 17,
 * 18): command/event round trips, REQUIRED idempotency keys on
 * commands, schema pinning, digest checks and the in-package schema
 * registry.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  envelopeDigest,
  parseEnvelopeAs,
} from '@arena/protocol-core';
import { SKILL_EXTRACTION_ERROR_CODES, SkillExtractionError } from './errors.js';
import {
  SKILL_EXTRACTION_SCHEMAS,
  checkSkillExtractionEnvelope,
  isKnownSkillExtractionSchema,
  makeExtractionCompletedEvent,
  makeRunExtractionCommand,
  parseSkillExtractionEnvelope,
  skillExtractionEnvelopeDigest,
  skillExtractionSchemaRef,
} from './envelopes.js';
import type { RunExtractionCommandPayload } from './envelopes.js';
import { CORR_ID, DIGEST_A, DIGEST_B } from './test-support.js';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';

const CORRELATION = CORR_ID as CorrelationId;
const IDEM = 'idem-extraction-0001' as IdempotencyKey;

/** Assert a synchronous throw is a typed SkillExtractionError with the given code. */
function expectErrorCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SkillExtractionError);
    expect((error as SkillExtractionError).code).toBe(code);
    return;
  }
  expect.unreachable('expected a typed SkillExtractionError throw');
}

describe('envelope wiring — positive', () => {
  it('builds a run-extraction command with a REQUIRED idempotency key', () => {
    const envelope = makeRunExtractionCommand(
      { policyRef: DIGEST_A, inputs: [DIGEST_B] },
      { correlationId: CORRELATION, idempotencyKey: IDEM },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.idempotencyKey).toBe(IDEM);
    expect(envelope.schema).toBe('arena:schema/skill-extraction/run-extraction-command@1.0.0');
  });

  it('round-trips through canonical JSON with schema pinning', async () => {
    const envelope = makeRunExtractionCommand(
      { policyRef: DIGEST_A, inputs: [DIGEST_B] },
      { correlationId: CORRELATION, idempotencyKey: IDEM },
    );
    const raw = canonicalJson(envelope);
    const parsed = parseSkillExtractionEnvelope<RunExtractionCommandPayload>(
      raw,
      'skill-extraction/run-extraction-command',
    );
    expect(parsed.payload.policyRef).toBe(DIGEST_A);
    expect(parsed.payload.inputs).toEqual([DIGEST_B]);
    const digest = await skillExtractionEnvelopeDigest(envelope);
    const checked = await checkSkillExtractionEnvelope(raw, digest);
    expect(checked.id).toBe(envelope.id);
  });

  it('builds an extraction-completed event carrying the run-record digest', () => {
    const event = makeExtractionCompletedEvent(
      { runRecordDigest: DIGEST_A },
      { correlationId: CORRELATION, idempotencyKey: IDEM },
    );
    expect(event.kind).toBe('event');
    expect(event.schema).toBe('arena:schema/skill-extraction/extraction-completed-event@1.0.0');
    expect(event.idempotencyKey).toBe(IDEM);
  });

  it('the schema registry is closed and consistent', () => {
    for (const name of Object.keys(SKILL_EXTRACTION_SCHEMAS)) {
      const ref = skillExtractionSchemaRef(name as keyof typeof SKILL_EXTRACTION_SCHEMAS);
      expect(ref.namespace).toBe('skill-extraction');
      expect(isKnownSkillExtractionSchema(ref)).toBe(true);
    }
    expect(
      isKnownSkillExtractionSchema({ namespace: 'skill-extraction', name: 'nonexistent', version: '1.0.0' }),
    ).toBe(false);
    expect(
      isKnownSkillExtractionSchema({
        namespace: 'skill-extraction',
        name: 'run-extraction-command',
        version: '9.9.9',
      }),
    ).toBe(false);
  });
});

describe('envelope wiring — negatives', () => {
  it('REJECTS commands without an idempotency key (lock rule 17)', () => {
    expectErrorCode(
      () =>
        makeRunExtractionCommand(
          { policyRef: DIGEST_A, inputs: [DIGEST_B] },
          { correlationId: CORRELATION },
        ),
      SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD,
    );
  });

  it('REJECTS malformed command payloads (bad digests, empty inputs)', () => {
    expectErrorCode(
      () =>
        makeRunExtractionCommand(
          { policyRef: 'nope', inputs: [DIGEST_B] },
          { correlationId: CORRELATION, idempotencyKey: IDEM },
        ),
      SKILL_EXTRACTION_ERROR_CODES.INVALID_DIGEST,
    );
    expectErrorCode(
      () =>
        makeRunExtractionCommand(
          { policyRef: DIGEST_A, inputs: [] },
          { correlationId: CORRELATION, idempotencyKey: IDEM },
        ),
      SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD,
    );
    expectErrorCode(
      () =>
        makeRunExtractionCommand(
          { policyRef: DIGEST_A, inputs: ['nope'] },
          { correlationId: CORRELATION, idempotencyKey: IDEM },
        ),
      SKILL_EXTRACTION_ERROR_CODES.INVALID_DIGEST,
    );
  });

  it('REJECTS malformed event payloads', () => {
    expectErrorCode(
      () =>
        makeExtractionCompletedEvent(
          { runRecordDigest: 'nope' } as never,
          { correlationId: CORRELATION },
        ),
      SKILL_EXTRACTION_ERROR_CODES.INVALID_DIGEST,
    );
  });

  it('schema pinning rejects envelopes of a different schema', async () => {
    const envelope = makeExtractionCompletedEvent(
      { runRecordDigest: DIGEST_A },
      { correlationId: CORRELATION },
    );
    const raw = canonicalJson(envelope);
    expect(() =>
      parseSkillExtractionEnvelope(raw, 'skill-extraction/run-extraction-command'),
    ).toThrow();
  });

  it('detects envelope tampering via the digest tripwire', async () => {
    const envelope = makeRunExtractionCommand(
      { policyRef: DIGEST_A, inputs: [DIGEST_B] },
      { correlationId: CORRELATION, idempotencyKey: IDEM },
    );
    const digest = await envelopeDigest(envelope);
    const tampered = canonicalJson({
      ...envelope,
      payload: { policyRef: DIGEST_B, inputs: [DIGEST_B] },
    });
    await expect(checkSkillExtractionEnvelope(tampered, digest)).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.TAMPERED,
    });
  });

  it('the core parser still rejects malformed raw input', () => {
    expect(() => parseEnvelopeAs('not-json')).toThrow();
  });
});
