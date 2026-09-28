/**
 * Envelope wiring tests (Work Order A012 gate 5): run-evaluation-command
 * / evaluation-recorded-event inside @arena/protocol-core's Envelope<T>,
 * REQUIRED idempotency keys on commands, schema pinning, digest
 * integrity and tamper rejection — mirroring the artifact-protocol /
 * job-protocol / trajectory patterns exactly.
 */

import { describe, expect, it } from 'vitest';
import {
  EVALUATION_SCHEMA_VERSION,
  EVALUATION_SCHEMAS,
  checkEvaluationEnvelope,
  evaluationEnvelopeDigest,
  evaluationSchemaRef,
  isKnownEvaluationSchema,
  makeEvaluationRecordedEvent,
  makeRunEvaluationCommand,
  parseEvaluationEnvelope,
} from './envelopes.js';
import { EVALUATION_ERROR_CODES } from './errors.js';
import type { EvaluationRecord } from './record.js';
import { createEvaluationCriteria, createEvaluationRecord } from './index.js';
import { toCorrelationId, serializeEnvelope, toIdempotencyKey } from '@arena/protocol-core';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  T0,
  T1,
  makeCriteriaInput,
  makeVerdicts,
} from './test-support.js';

const CORR = toCorrelationId('corr-a012-0001');
const IDEM = toIdempotencyKey('idem-a012-0001');

const RUN_PAYLOAD = {
  evaluatorRef: DIGEST_C,
  caseRef: DIGEST_A,
  trajectoryRef: DIGEST_B,
  seed: 'seed-1234',
};

async function sampleRecord(): Promise<EvaluationRecord> {
  const criteria = await createEvaluationCriteria(makeCriteriaInput());
  return createEvaluationRecord(
    {
      evaluatorRef: DIGEST_C,
      caseRef: DIGEST_A,
      trajectoryRef: DIGEST_B,
      criteriaRef: criteria.digest,
      seed: 'seed-1234',
      verdicts: makeVerdicts(3, { scores: [1, 1, 0.75] }),
      confidence: 0.85,
      limitations: null,
      startedAt: T0,
      finishedAt: T1,
      provenance: { executedBy: 'evaluator-instance-01', recordedAt: T1, notes: null },
    },
    criteria,
  );
}

describe('schema registry (positive)', () => {
  it('owns exactly the seven A012 schemas at 1.0.0', () => {
    expect(Object.keys(EVALUATION_SCHEMAS)).toHaveLength(7);
    for (const [name, version] of Object.entries(EVALUATION_SCHEMAS)) {
      expect(version).toBe(EVALUATION_SCHEMA_VERSION);
      expect(name).toMatch(/^evaluation\//);
    }
  });

  it('evaluationSchemaRef resolves every name (positive)', () => {
    for (const name of Object.keys(EVALUATION_SCHEMAS)) {
      const ref = evaluationSchemaRef(name as keyof typeof EVALUATION_SCHEMAS);
      expect(ref.namespace).toBe('evaluation');
      expect(ref.version).toBe('1.0.0');
      expect(isKnownEvaluationSchema(ref)).toBe(true);
    }
  });

  it('isKnownEvaluationSchema rejects foreign/wrong-version refs (negative)', () => {
    expect(isKnownEvaluationSchema({ namespace: 'trajectory', name: 'trajectory-entry', version: '1.0.0' })).toBe(false);
    expect(isKnownEvaluationSchema({ namespace: 'evaluation', name: 'not-a-schema', version: '1.0.0' })).toBe(false);
    expect(isKnownEvaluationSchema({ namespace: 'evaluation', name: 'evaluation-record', version: '2.0.0' })).toBe(false);
  });
});

describe('makeRunEvaluationCommand (positive + negative)', () => {
  it('builds a command envelope with the REQUIRED idempotency key (positive)', () => {
    const envelope = makeRunEvaluationCommand(RUN_PAYLOAD, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe(
      `arena:schema/evaluation/run-evaluation-command@${EVALUATION_SCHEMA_VERSION}`,
    );
    expect(envelope.correlationId).toBe(CORR);
    expect(envelope.idempotencyKey).toBe(IDEM);
    expect(envelope.payload).toEqual(RUN_PAYLOAD);
  });

  it('rejects a MISSING idempotency key (negative — architecture-lock rule 17)', () => {
    expect(() =>
      makeRunEvaluationCommand(RUN_PAYLOAD, { correlationId: CORR }),
    ).toThrowError(/command envelopes require an idempotency key/);
  });

  it('rejects malformed digest refs in the payload (negative)', () => {
    for (const bad of ['', 'short', 'UPPER', 'nope']) {
      expect(() =>
        makeRunEvaluationCommand({ ...RUN_PAYLOAD, caseRef: bad }, { correlationId: CORR, idempotencyKey: IDEM }),
      ).toThrowError(
        expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_DIGEST }),
      );
      expect(() =>
        makeRunEvaluationCommand({ ...RUN_PAYLOAD, evaluatorRef: bad }, { correlationId: CORR, idempotencyKey: IDEM }),
      ).toThrowError(/valid content digest in 'evaluatorRef'/);
    }
  });

  it('rejects malformed seeds (negative)', () => {
    expect(() =>
      makeRunEvaluationCommand(
        { ...RUN_PAYLOAD, seed: 42 as unknown as string },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).toThrowError(/seed must be a neutral seed string or null/);
    expect(() =>
      makeRunEvaluationCommand(
        { ...RUN_PAYLOAD, seed: '-bad' },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).toThrowError(/seed must be a neutral seed string or null/);
  });
});

describe('makeEvaluationRecordedEvent (positive + negative)', () => {
  it('builds an event envelope carrying the authoritative record (positive)', async () => {
    const record = await sampleRecord();
    const envelope = makeEvaluationRecordedEvent(
      { record },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(envelope.kind).toBe('event');
    expect(envelope.schema).toBe(
      `arena:schema/evaluation/evaluation-recorded-event@${EVALUATION_SCHEMA_VERSION}`,
    );
    expect(envelope.correlationId).toBe(CORR);
    expect(envelope.idempotencyKey).toBe(IDEM); // carried from the command
    expect(envelope.payload.record.digest).toBe(record.digest);
  });

  it('events may omit the idempotency key (idempotencyKey: null allowed)', async () => {
    const record = await sampleRecord();
    const envelope = makeEvaluationRecordedEvent({ record }, { correlationId: CORR });
    expect(envelope.idempotencyKey).toBeNull();
  });

  it('rejects structurally invalid records (negative)', async () => {
    expect(() =>
      makeEvaluationRecordedEvent({ record: { digest: 'x' } as unknown as EvaluationRecord }, { correlationId: CORR }),
    ).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_RECORD }),
    );
  });
});

describe('parse / digest / integrity round trip (positive + negative)', () => {
  it('serializes, parses and pins the payload schema (positive)', async () => {
    const command = makeRunEvaluationCommand(RUN_PAYLOAD, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const raw = serializeEnvelope(command);
    const parsed = parseEvaluationEnvelope<typeof RUN_PAYLOAD>(raw, 'evaluation/run-evaluation-command');
    expect(parsed.kind).toBe('command');
    expect(parsed.idempotencyKey).toBe(IDEM);
    expect(parsed.payload).toEqual(RUN_PAYLOAD);

    const record = await sampleRecord();
    const event = makeEvaluationRecordedEvent({ record }, { correlationId: CORR });
    const rawEvent = serializeEnvelope(event);
    const parsedEvent = parseEvaluationEnvelope(rawEvent, {
      namespace: 'evaluation',
      name: 'evaluation-recorded-event',
      version: EVALUATION_SCHEMA_VERSION,
    });
    expect(parsedEvent.kind).toBe('event');
  });

  it('the core parser rejects envelopes pinned to a foreign schema (negative)', async () => {
    const command = makeRunEvaluationCommand(RUN_PAYLOAD, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const raw = serializeEnvelope(command);
    expect(() =>
      parseEvaluationEnvelope(raw, 'evaluation/evaluation-recorded-event'),
    ).toThrowError(/schema/i);
  });

  it('evaluationEnvelopeDigest is canonical and stable (positive)', async () => {
    const command = makeRunEvaluationCommand(RUN_PAYLOAD, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const first = await evaluationEnvelopeDigest(command);
    const second = await evaluationEnvelopeDigest(command);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });

  it('checkEvaluationEnvelope passes on genuine wire bytes (positive)', async () => {
    const command = makeRunEvaluationCommand(RUN_PAYLOAD, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const raw = serializeEnvelope(command);
    const digest = await evaluationEnvelopeDigest(command);
    const checked = await checkEvaluationEnvelope(raw, digest);
    expect(checked.id).toBe(command.id);
  });

  it('checkEvaluationEnvelope throws TAMPERED on tampered bytes (negative)', async () => {
    const command = makeRunEvaluationCommand(RUN_PAYLOAD, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const raw = serializeEnvelope(command);
    const tampered = raw.replace('seed-1234', 'seed-9999');
    const digest = await evaluationEnvelopeDigest(command);
    await expect(checkEvaluationEnvelope(tampered, digest)).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.TAMPERED }),
    );
    await expect(checkEvaluationEnvelope(raw, '0'.repeat(64))).rejects.toThrowError(
      /digest mismatch/,
    );
  });
});
