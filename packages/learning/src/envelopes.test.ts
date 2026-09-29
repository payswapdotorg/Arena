/**
 * Envelope tests - run-experiment-command / experiment-completed-event
 * wiring (lock rule 17: commands REQUIRE idempotency keys).
 */

import { describe, expect, it } from 'vitest';
import {
  checkLearningEnvelope,
  isKnownLearningSchema,
  learningEnvelopeDigest,
  learningSchemaRef,
  makeExperimentCompletedEvent,
  makeRunExperimentCommand,
  parseLearningEnvelope,
  LEARNING_SCHEMAS,
} from './envelopes.js';
import { LEARNING_ERROR_CODES } from './errors.js';
import { newCorrelationId, newIdempotencyKey, serializeEnvelope } from '@arena/protocol-core';
import { makeRunRecordFixture } from './run-record-fixture.js';

describe('learning schemas registry', () => {
  it('owns the nine learning schemas at 1.0.0', () => {
    expect(Object.keys(LEARNING_SCHEMAS)).toHaveLength(9);
    for (const [name, version] of Object.entries(LEARNING_SCHEMAS)) {
      const ref = learningSchemaRef(name as keyof typeof LEARNING_SCHEMAS);
      expect(ref.namespace).toBe('learning');
      expect(ref.version).toBe('1.0.0');
      expect(version).toBe('1.0.0');
      expect(isKnownLearningSchema(ref)).toBe(true);
    }
  });

  it('unknown names are rejected', () => {
    expect(() => learningSchemaRef('learning/nope' as never)).toThrow(
      /unknown learning protocol schema/,
    );
  });

  it('foreign refs at other versions are not known learning schemas', () => {
    expect(
      isKnownLearningSchema({ namespace: 'learning', name: 'intervention', version: '2.0.0' }),
    ).toBe(false);
    expect(
      isKnownLearningSchema({ namespace: 'evaluation', name: 'intervention', version: '1.0.0' }),
    ).toBe(false);
  });
});

describe('run-experiment-command envelope', () => {
  it('carries a REQUIRED idempotency key and the learning schema ref', () => {
    const envelope = makeRunExperimentCommand(
      { descriptorRef: 'd'.repeat(64), experimentKey: 'run-1' },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toContain('learning');
    expect(envelope.schema).toContain('run-experiment-command');
    expect(envelope.idempotencyKey).not.toBeNull();
  });

  it('REJECTS a missing idempotency key (lock rule 17)', () => {
    expect(() =>
      makeRunExperimentCommand(
        { descriptorRef: 'd'.repeat(64), experimentKey: 'run-1' },
        { correlationId: newCorrelationId() },
      ),
    ).toThrowError(
      expect.objectContaining({ code: LEARNING_ERROR_CODES.INVALID_RUN }),
    );
  });

  it('REJECTS malformed payload digests and keys', () => {
    expect(() =>
      makeRunExperimentCommand(
        { descriptorRef: 'not-a-digest', experimentKey: 'run-1' },
        { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
      ),
    ).toThrowError(
      expect.objectContaining({ code: LEARNING_ERROR_CODES.INVALID_DIGEST }),
    );
    expect(() =>
      makeRunExperimentCommand(
        { descriptorRef: 'd'.repeat(64), experimentKey: 'bad key!' },
        { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
      ),
    ).toThrowError(
      expect.objectContaining({ code: LEARNING_ERROR_CODES.INVALID_RUN }),
    );
  });

  it('round-trips through parse + digest check', async () => {
    const envelope = makeRunExperimentCommand(
      { descriptorRef: 'd'.repeat(64), experimentKey: 'run-1' },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    const raw = serializeEnvelope(envelope);
    const parsed = parseLearningEnvelope<{ descriptorRef: string; experimentKey: string }>(
      raw,
      'learning/run-experiment-command',
    );
    expect(parsed.payload.descriptorRef).toBe('d'.repeat(64));
    const digest = await learningEnvelopeDigest(envelope);
    await expect(checkLearningEnvelope(raw, digest)).resolves.toBeDefined();
    await expect(checkLearningEnvelope(raw, '0'.repeat(64))).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.TAMPERED,
    });
  });
});

describe('experiment-completed-event envelope', () => {
  it('carries the authoritative run record', async () => {
    const record = await makeRunRecordFixture();
    const envelope = makeExperimentCompletedEvent(
      { record },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    expect(envelope.kind).toBe('event');
    expect(envelope.schema).toContain('experiment-completed-event');
    expect(envelope.idempotencyKey).not.toBeNull();
    const raw = serializeEnvelope(envelope);
    const parsed = parseLearningEnvelope<{ record: unknown }>(
      raw,
      'learning/experiment-completed-event',
    );
    expect(parsed.payload.record).toBeDefined();
    expect((parsed.payload.record as { digest: string }).digest).toBe(record.digest);
  });

  it('REJECTS a structurally invalid record payload', () => {
    expect(() =>
      makeExperimentCompletedEvent(
        { record: {} as never },
        { correlationId: newCorrelationId() },
      ),
    ).toThrowError(
      expect.objectContaining({ code: LEARNING_ERROR_CODES.INVALID_RECORD }),
    );
  });

  it('events MAY omit the idempotency key (null is legal)', async () => {
    const record = await makeRunRecordFixture();
    const envelope = makeExperimentCompletedEvent(
      { record },
      { correlationId: newCorrelationId() },
    );
    expect(envelope.idempotencyKey).toBeNull();
  });
});

describe('envelope identity and determinism (property)', () => {
  it('each envelope carries a unique core id; the payload/schema wiring is identical', async () => {
    const context = { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() };
    const payload = { descriptorRef: 'd'.repeat(64), experimentKey: 'run-1' };
    const a = makeRunExperimentCommand(payload, context);
    const b = makeRunExperimentCommand(payload, context);
    expect(a.id).not.toBe(b.id); // per-instance envelope identity (core UUIDv4)
    expect(a.schema).toBe(b.schema);
    expect(a.correlationId).toBe(b.correlationId);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.payload).toEqual(b.payload);
  });

  it('the event schema ref is the versioned learning schema', () => {
    const ref = learningSchemaRef('learning/experiment-completed-event');
    expect(`arena:schema/${ref.namespace}/${ref.name}@${ref.version}`).toBe(
      'arena:schema/learning/experiment-completed-event@1.0.0',
    );
  });
});
