/**
 * Envelope wiring tests (Work Order A013): run-verification-command /
 * verification-recorded-event round trips, REQUIRED command idempotency
 * keys, schema pinning and the envelope tamper tripwire.
 */

import { describe, expect, it } from 'vitest';
import {
  serializeEnvelope,
  parseEnvelope,
  toCorrelationId,
  toIdempotencyKey,
} from '@arena/protocol-core';
import { VERIFICATION_ERROR_CODES, VerificationError } from './errors.js';
import {
  VERIFICATION_SCHEMAS,
  VERIFICATION_SCHEMA_VERSION,
  checkVerificationEnvelope,
  isKnownVerificationSchema,
  makeRunVerificationCommand,
  makeVerificationRecordedEvent,
  parseVerificationEnvelope,
  verificationEnvelopeDigest,
  verificationSchemaRef,
} from './envelopes.js';
import type { RunVerificationCommandPayload } from './envelopes.js';
import { createVerifierDescriptor } from './descriptor.js';
import { createVerificationRecord } from './record.js';
import {
  evidenceFor,
  makeArtifact,
  makeDescriptorInput,
  makeRecordInput,
  support,
} from './test-support.js';

const CORR = toCorrelationId('corr-envelope-0001');
const IDEM = toIdempotencyKey('idem-envelope-0001');

async function commandFixture() {
  const descriptor = await createVerifierDescriptor(makeDescriptorInput());
  const report = await makeArtifact(21);
  const balance = await makeArtifact(22);
  const evidence = [
    evidenceFor(report, 'test-report'),
    evidenceFor(balance, 'balance-proof', 'erp-close-sandbox'),
  ];
  const record = await createVerificationRecord(
    makeRecordInput(descriptor.digest, evidence, [
      support('requirement-001', 'present-supported', report.digest),
      support('requirement-002', 'present-supported', balance.digest),
    ]),
    descriptor,
  );
  return { descriptor, evidence, record };
}

describe('VERIFICATION_SCHEMAS registry', () => {
  it('owns exactly the seven A013 schemas at 1.0.0', () => {
    expect({ ...VERIFICATION_SCHEMAS }).toEqual({
      'verification/verifier-descriptor': '1.0.0',
      'verification/verification-record': '1.0.0',
      'verification/verification-outcome': '1.0.0',
      'verification/verification-error': '1.0.0',
      'verification/run-verification-command': '1.0.0',
      'verification/verification-recorded-event': '1.0.0',
      'verification/schema-registry': '1.0.0',
    });
    expect(Object.isFrozen(VERIFICATION_SCHEMAS)).toBe(true);
    expect(VERIFICATION_SCHEMA_VERSION).toBe('1.0.0');
  });

  it('verificationSchemaRef resolves and isKnownVerificationSchema validates', () => {
    const ref = verificationSchemaRef('verification/verification-record');
    expect(ref).toEqual({ namespace: 'verification', name: 'verification-record', version: '1.0.0' });
    expect(isKnownVerificationSchema(ref)).toBe(true);
    expect(isKnownVerificationSchema({ ...ref, version: '2.0.0' })).toBe(false);
    expect(isKnownVerificationSchema({ namespace: 'other', name: 'verification-record', version: '1.0.0' })).toBe(false);
    expect(() => verificationSchemaRef('verification/nope' as never)).toThrowError(VerificationError);
  });
});

describe('run-verification-command', () => {
  it('carries a REQUIRED idempotency key and validates the evidence bundle', async () => {
    const { descriptor, evidence } = await commandFixture();
    const command = makeRunVerificationCommand(
      { verifierRef: descriptor.digest, evidence },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(command.kind).toBe('command');
    expect(command.idempotencyKey).toBe(IDEM);
    expect(command.schema).toBe('arena:schema/verification/run-verification-command@1.0.0');

    // missing idempotency key → rejected (lock rule 17)
    expect(() =>
      makeRunVerificationCommand({ verifierRef: descriptor.digest, evidence }, { correlationId: CORR }),
    ).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_RECORD }),
    );
    // malformed verifier ref → rejected
    expect(() =>
      makeRunVerificationCommand(
        { verifierRef: 'not-a-digest', evidence },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_DIGEST }),
    );
    // empty evidence bundle → rejected
    expect(() =>
      makeRunVerificationCommand(
        { verifierRef: descriptor.digest, evidence: [] },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
  });

  it('round trips through the core serializer with schema pinning', async () => {
    const { descriptor, evidence } = await commandFixture();
    const command = makeRunVerificationCommand(
      { verifierRef: descriptor.digest, evidence },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    const raw = serializeEnvelope(command);
    const parsed = parseVerificationEnvelope<RunVerificationCommandPayload>(
      raw,
      'verification/run-verification-command',
    );
    expect(parsed.idempotencyKey).toBe(IDEM);
    expect(parsed.payload.verifierRef).toBe(descriptor.digest);
    expect(parsed.payload.evidence).toHaveLength(2);
    // wrong-schema pin → core rejection
    expect(() =>
      parseVerificationEnvelope<RunVerificationCommandPayload>(
        raw,
        'verification/verification-record',
      ),
    ).toThrowError();
  });
});

describe('verification-recorded-event', () => {
  it('carries the authoritative record and the run idempotency key when provided', async () => {
    const { record } = await commandFixture();
    const event = makeVerificationRecordedEvent(
      { record },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(event.kind).toBe('event');
    expect(event.idempotencyKey).toBe(IDEM);
    expect(event.payload.record.digest).toBe(record.digest);
    // without a key, the event carries null (events MAY be idempotency-addressed)
    const bare = makeVerificationRecordedEvent({ record }, { correlationId: CORR });
    expect(bare.idempotencyKey).toBe(null);
    // structurally invalid records are rejected
    expect(() =>
      makeVerificationRecordedEvent({ record: { digest: 'x' } as never }, { correlationId: CORR }),
    ).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_RECORD }),
    );
  });
});

describe('envelope integrity', () => {
  it('the canonical envelope digest is stable and tamper detection works', async () => {
    const { descriptor, evidence } = await commandFixture();
    const command = makeRunVerificationCommand(
      { verifierRef: descriptor.digest, evidence },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    const raw = serializeEnvelope(command);
    const digest = await verificationEnvelopeDigest(command);
    const again = await verificationEnvelopeDigest(parseEnvelope(raw));
    expect(again).toBe(digest);
    await expect(checkVerificationEnvelope(raw, digest)).resolves.toBeDefined();
    await expect(checkVerificationEnvelope(raw, 'f'.repeat(64))).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.TAMPERED }),
    );
  });
});
