/**
 * Envelope wiring + the envelope-side per-job event log — positive AND
 * negative tests (gates 5, 12): versioned SchemaRefs, idempotency-keyed
 * commands, event envelopes with correlation ids, parse/verify round
 * trips, and the ordered JobEventLog (gap/duplicate/out-of-order
 * rejection at the wire level).
 */

import { describe, expect, it } from 'vitest';
import { newCorrelationId, serializeEnvelope, toIdempotencyKey } from '@arena/protocol-core';
import {
  appendJobEventEnvelope,
  asMutationAuditedEnvelope,
  createJobEventLog,
  isKnownJobSchema,
  jobEnvelopeDigest,
  JOB_SCHEMAS,
  jobEventSchemaName,
  jobSchemaRef,
  makeJobEventEnvelope,
  makeSubmitJobCommand,
  parseJobEnvelope,
  verifyJobEnvelope,
  verifyJobEventLog,
} from './envelopes.js';
import { createJobDefinition } from './definition.js';
import { makeMutationAuditedEvent } from './events.js';
import { JOB_ERROR_CODES } from './errors.js';
import type { JobEvent } from './events.js';

const T0 = '2026-01-15T09:30:00.000Z';
const T1 = '2026-01-15T09:30:30.000Z';
const T2 = '2026-01-15T09:31:00.000Z';
const UUID_A = '110e8400-e29b-41d4-a716-446655440000';
const UUID_B = '220e8400-e29b-41d4-a716-446655440000';
const CORR = newCorrelationId();
const IDEM = toIdempotencyKey('idem-42');

const DEFINITION_INPUT = {
  kind: { namespace: 'billing', name: 'reconcile-ledger', version: '1.2.0' },
  inputSchema: 'arena:schema/artifacts/material-artifact@1.0.0',
  correlationAddress: 'arena/jobs/billing/reconciliation',
  idempotency: { scope: 'billing-reconcile' },
  timeout: { timeoutMs: 30_000 },
  retry: { maxAttempts: 3, backoffScheduleMs: [1_000], retryableErrorClasses: ['transient'] },
};

function submittedEvent(sequence = 1): JobEvent {
  return {
    eventVersion: 1,
    kind: 'job-submitted',
    sequence,
    occurredAt: T0,
    jobId: 'job-0001',
    definitionDigest: 'ab'.repeat(32),
    input: { ledger: 'q3' },
  };
}

function startedEvent(sequence = 2, occurredAt = T1): JobEvent {
  return {
    eventVersion: 1,
    kind: 'job-started',
    sequence,
    occurredAt,
    jobId: 'job-0001',
    attempt: 1,
    timeoutAt: T2,
  };
}

describe('envelopes — schema registry (positive)', () => {
  it('owns the 14 events-namespace schemas at 1.0.0', () => {
    expect(Object.keys(JOB_SCHEMAS)).toHaveLength(14);
    expect(jobSchemaRef('events/job-definition')).toEqual({
      namespace: 'events',
      name: 'job-definition',
      version: '1.0.0',
    });
    expect(isKnownJobSchema({ namespace: 'events', name: 'job-record', version: '1.0.0' })).toBe(
      true,
    );
    expect(
      isKnownJobSchema({ namespace: 'events', name: 'job-record', version: '1.1.0' }),
    ).toBe(false);
    expect(
      isKnownJobSchema({ namespace: 'artifacts', name: 'job-record', version: '1.0.0' }),
    ).toBe(false);
  });

  it('maps every event kind to its payload schema', () => {
    expect(jobEventSchemaName('job-submitted')).toBe('events/job-submitted-event');
    expect(jobEventSchemaName('mutation-audited')).toBe('events/mutation-audited-event');
    expect(jobEventSchemaName('job-failed')).toBe('events/job-failed-event');
  });
});

describe('envelopes — commands (positive + negative)', () => {
  it('makeSubmitJobCommand builds an idempotency-keyed command envelope', async () => {
    const definition = await createJobDefinition(DEFINITION_INPUT);
    const envelope = makeSubmitJobCommand(
      { definition, input: { ledger: 'q3' } },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/events/submit-job-command@1.0.0');
    expect(envelope.correlationId).toBe(CORR);
    expect(envelope.idempotencyKey).toBe(IDEM);
    expect(envelope.payload.definition.digest).toBe(definition.digest);
  });

  it('commands REQUIRE an idempotency key (lock rule 17)', async () => {
    const definition = await createJobDefinition(DEFINITION_INPUT);
    expect(() =>
      makeSubmitJobCommand({ definition, input: null }, { correlationId: CORR }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_EVENT }));
    expect(() =>
      makeSubmitJobCommand(
        { definition: { ...definition, digest: 'nope' } as unknown as typeof definition, input: null },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_DEFINITION }));
  });
});

describe('envelopes — event envelopes (positive + negative)', () => {
  it('wraps lifecycle events with kind-specific schemas and the job\u2019s addressability pair', () => {
    const envelope = makeJobEventEnvelope(submittedEvent(), {
      correlationId: CORR,
      idempotencyKey: IDEM,
      id: UUID_A,
      issuedAt: T0,
    });
    expect(envelope.kind).toBe('event');
    expect(envelope.schema).toBe('arena:schema/events/job-submitted-event@1.0.0');
    expect(envelope.id).toBe(UUID_A);
    expect(envelope.idempotencyKey).toBe(IDEM);
    expect(envelope.correlationId).toBe(CORR);
    expect(envelope.payload.kind).toBe('job-submitted');
  });

  it('wraps audit events with the mutation-audited schema', () => {
    const audit = makeMutationAuditedEvent({
      sequence: 1,
      occurredAt: T0,
      jobId: 'job-0001',
      mutation: 'job.submit',
      actor: { type: 'service', tenant: 'arena', principalId: 'job-orchestrator' },
      correlationId: CORR,
      envelopeId: UUID_B,
    });
    const envelope = makeJobEventEnvelope(audit, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    expect(envelope.schema).toBe('arena:schema/events/mutation-audited-event@1.0.0');
    expect(asMutationAuditedEnvelope(envelope).payload.mutation).toBe('job.submit');
  });

  it('rejects structurally invalid payloads', () => {
    expect(() =>
      makeJobEventEnvelope({ ...submittedEvent(), sequence: 0 } as JobEvent, {
        correlationId: CORR,
      }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_EVENT }));
    expect(() =>
      makeJobEventEnvelope('nope' as unknown as JobEvent, { correlationId: CORR }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_EVENT }));
  });
});

describe('envelopes — parse / verify round trip (positive + negative)', () => {
  it('round-trips through serialize/parse with a pinned schema', () => {
    const envelope = makeJobEventEnvelope(submittedEvent(), {
      correlationId: CORR,
      idempotencyKey: IDEM,
      id: UUID_A,
      issuedAt: T0,
    });
    const raw = serializeEnvelope(envelope);
    const parsed = parseJobEnvelope<JobEvent>(raw, 'events/job-submitted-event');
    expect(parsed.id).toBe(envelope.id);
    expect(parsed.payload.sequence).toBe(1);
    // wrong pin => schema mismatch from the core parser
    expect(() => parseJobEnvelope(raw, 'events/job-started-event')).toThrow();
  });

  it('digest verification detects tampering (fail closed)', async () => {
    const envelope = makeJobEventEnvelope(submittedEvent(), {
      correlationId: CORR,
      idempotencyKey: IDEM,
      id: UUID_A,
      issuedAt: T0,
    });
    const raw = serializeEnvelope(envelope);
    const digest = await jobEnvelopeDigest(envelope);
    await expect(verifyJobEnvelope(raw, digest)).resolves.toBeDefined();
    const tampered = raw.replace('"sequence":1', '"sequence":9');
    await expect(verifyJobEnvelope(tampered, digest)).rejects.toThrow();
  });
});

describe('JobEventLog — envelope-side append-only stream', () => {
  it('happy path: ordered appends with contiguous sequences', () => {
    let log = createJobEventLog('job-0001');
    log = appendJobEventEnvelope(
      log,
      makeJobEventEnvelope(submittedEvent(1), {
        correlationId: CORR,
        idempotencyKey: IDEM,
        id: UUID_A,
        issuedAt: T0,
      }),
    );
    log = appendJobEventEnvelope(
      log,
      makeJobEventEnvelope(startedEvent(2), {
        correlationId: CORR,
        idempotencyKey: IDEM,
        id: UUID_B,
        issuedAt: T1,
      }),
    );
    expect(log.envelopes).toHaveLength(2);
    expect(log.envelopes.map((envelope) => envelope.payload.sequence)).toEqual([1, 2]);
    expect(Object.isFrozen(log)).toBe(true);
    expect(() => verifyJobEventLog(log)).not.toThrow();
  });

  it('rejects a sequence GAP', () => {
    const log = appendJobEventEnvelope(
      createJobEventLog('job-0001'),
      makeJobEventEnvelope(submittedEvent(1), { correlationId: CORR, issuedAt: T0 }),
    );
    expect(() =>
      appendJobEventEnvelope(
        log,
        makeJobEventEnvelope(startedEvent(3), { correlationId: CORR, issuedAt: T1 }),
      ),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_SEQUENCE_GAP }));
  });

  it('rejects a sequence DUPLICATE / regression', () => {
    const log = appendJobEventEnvelope(
      createJobEventLog('job-0001'),
      makeJobEventEnvelope(submittedEvent(1), { correlationId: CORR, issuedAt: T0 }),
    );
    expect(() =>
      appendJobEventEnvelope(
        log,
        makeJobEventEnvelope(submittedEvent(1), { correlationId: CORR, issuedAt: T1 }),
      ),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_SEQUENCE_DUPLICATE }));
  });

  it('rejects an OUT-OF-ORDER kind (completed after submitted)', () => {
    const log = appendJobEventEnvelope(
      createJobEventLog('job-0001'),
      makeJobEventEnvelope(submittedEvent(1), { correlationId: CORR, issuedAt: T0 }),
    );
    const completed: JobEvent = {
      eventVersion: 1,
      kind: 'job-completed',
      sequence: 2,
      occurredAt: T1,
      jobId: 'job-0001',
      attempt: 1,
      result: null,
    };
    expect(() =>
      appendJobEventEnvelope(
        log,
        makeJobEventEnvelope(completed, { correlationId: CORR, issuedAt: T1 }),
      ),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_OUT_OF_ORDER }));
  });

  it('rejects events belonging to ANOTHER job', () => {
    const log = createJobEventLog('job-0001');
    const foreign = { ...submittedEvent(1), jobId: 'job-9999' };
    expect(() =>
      appendJobEventEnvelope(
        log,
        makeJobEventEnvelope(foreign, { correlationId: CORR, issuedAt: T0 }),
      ),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_OUT_OF_ORDER }));
  });

  it('rejects a timestamp regression', () => {
    const later = { ...submittedEvent(1), occurredAt: T1 };
    const log = appendJobEventEnvelope(
      createJobEventLog('job-0001'),
      makeJobEventEnvelope(later, { correlationId: CORR, issuedAt: T1 }),
    );
    expect(() =>
      appendJobEventEnvelope(
        log,
        makeJobEventEnvelope(startedEvent(2, T0), { correlationId: CORR, issuedAt: T1 }),
      ),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_OUT_OF_ORDER }));
  });

  it('createJobEventLog rejects malformed job ids; verifyJobEventLog catches drift', () => {
    expect(() => createJobEventLog('bad id!')).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_IDENTITY }),
    );
    const log = appendJobEventEnvelope(
      createJobEventLog('job-0001'),
      makeJobEventEnvelope(submittedEvent(1), { correlationId: CORR, issuedAt: T0 }),
    );
    // splice a drifted copy (sequence 9) — revalidation fails
    const drifted = {
      jobId: 'job-0001',
      envelopes: [
        makeJobEventEnvelope({ ...submittedEvent(1), sequence: 9 }, { correlationId: CORR, issuedAt: T0 }),
      ],
    };
    expect(() => verifyJobEventLog(drifted)).toThrow();
    void log;
  });
});
