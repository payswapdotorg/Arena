/**
 * Envelope wiring tests (Work Order A023; architecture-lock rules 17, 18).
 *
 * Positive: command/event round trips inside protocol-core envelopes
 * with REQUIRED idempotency keys on commands; schema registry parity.
 * Negative: null idempotency keys, wrong-namespace schemas and
 * malformed payloads reject.
 */

import { describe, expect, it } from 'vitest';
import {
  CERTIFICATION_RECORDED_EVENT_FIELDS,
  CERTIFICATION_SCHEMAS,
  CERTIFICATION_SCHEMA_VERSION,
  RUN_CERTIFICATION_COMMAND_FIELDS,
  certificationEnvelopeDigest,
  certificationSchemaRef,
  isCertificationRecordedEvent,
  isKnownCertificationSchema,
  isRunCertificationCommand,
  makeCertificationRecordedEvent,
  makeRunCertificationCommand,
  parseCertificationRecordedEvent,
  parseRunCertificationCommand,
} from './envelopes.js';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { createRevocationRecord } from './record.js';
import { CertificationError } from './errors.js';
import { DIGEST_A, T0, T1, T2, makeSubject } from './test-support.js';

const CORR = toCorrelationId('corr-envelope-1');
const IDEM = toIdempotencyKey('idem-envelope-1');

describe('certification envelope wiring', () => {
  it('exposes the certification schema registry at 1.0.0', () => {
    expect(CERTIFICATION_SCHEMA_VERSION).toBe('1.0.0');
    expect(Object.keys(CERTIFICATION_SCHEMAS)).toHaveLength(9);
    expect(CERTIFICATION_SCHEMAS['certification/certification-suite']).toBe('1.0.0');
    const ref = certificationSchemaRef('certification/run-certification-command');
    expect(ref).toEqual({
      namespace: 'certification',
      name: 'run-certification-command',
      version: '1.0.0',
    });
    expect(isKnownCertificationSchema(ref)).toBe(true);
    expect(
      isKnownCertificationSchema({ namespace: 'certification', name: 'nope', version: '1.0.0' }),
    ).toBe(false);
    expect(() => certificationSchemaRef('certification/nope' as never)).toThrow(CertificationError);
  });

  it('round-trips run-certification-command', () => {
    const payload = {
      suiteRef: DIGEST_A,
      subject: makeSubject(),
      evidenceRefs: [DIGEST_A],
    };
    expect(isRunCertificationCommand(payload)).toBe(true);
    expect(RUN_CERTIFICATION_COMMAND_FIELDS).toEqual(['suiteRef', 'subject', 'evidenceRefs']);
    const envelope = makeRunCertificationCommand(payload, CORR, IDEM);
    const serialized = JSON.stringify(envelope);
    const parsed = parseRunCertificationCommand(serialized);
    expect(parsed.idempotencyKey).toBe(IDEM);
    expect(parsed.correlationId).toBe(CORR);
    expect(parsed.payload.suiteRef).toBe(DIGEST_A);
    expect(parsed.payload.subject.substrateRef.substrateId).toBe('substrate-x');
  });

  it('round-trips certification-recorded-event with the authoritative record', async () => {
    const record = await createRevocationRecord({
      revokes: DIGEST_A,
      grounds: 'suite deprecated',
      correlationId: 'corr-revoke-2',
      idempotencyKey: 'idem-revoke-2',
      tenantId: null,
      workspaceId: null,
      startedAt: T1,
      finishedAt: T2,
      provenance: { executedBy: 'arena-architect', recordedAt: T2, notes: null },
    });
    expect(CERTIFICATION_RECORDED_EVENT_FIELDS).toEqual(['record']);
    const envelope = makeCertificationRecordedEvent({ record }, CORR, IDEM);
    const parsed = parseCertificationRecordedEvent(JSON.stringify(envelope));
    expect(parsed.payload.record.digest).toBe(record.digest);
    expect(isCertificationRecordedEvent({ record })).toBe(true);
    expect(isCertificationRecordedEvent({ record: { junk: 1 } })).toBe(false);
    const digest = await certificationEnvelopeDigest(envelope);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('NEGATIVE: malformed payloads and missing idempotency keys reject', () => {
    expect(
      isRunCertificationCommand({ suiteRef: 'nope', subject: makeSubject(), evidenceRefs: [] }),
    ).toBe(false);
    expect(() =>
      makeRunCertificationCommand(
        { suiteRef: 'nope', subject: makeSubject(), evidenceRefs: [] } as never,
        CORR,
        IDEM,
      ),
    ).toThrow(/structurally invalid/);
    // a command envelope without an idempotency key fails the strict parse
    const bare = makeRunCertificationCommand(
      {
        suiteRef: DIGEST_A,
        subject: makeSubject(),
        evidenceRefs: [DIGEST_A],
      },
      CORR,
      IDEM,
    );
    const stripped = JSON.parse(JSON.stringify(bare));
    stripped.idempotencyKey = null;
    expect(() => parseRunCertificationCommand(JSON.stringify(stripped))).toThrow(/idempotency/i);
    // foreign-namespace envelope rejects (protocol-core schema mismatch)
    const foreign = JSON.parse(JSON.stringify(bare));
    foreign.schema = 'arena:schema/verification/run-verification-command@1.0.0';
    expect(() => parseRunCertificationCommand(JSON.stringify(foreign))).toThrow(/schema/i);
    expect(() =>
      parseCertificationRecordedEvent(JSON.stringify({ ...bare, payload: { record: T0 } })),
    ).toThrow(/schema/i);
  });
});
