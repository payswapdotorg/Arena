/**
 * Envelope wiring tests (Work Order A023).
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { CertificationError } from './errors.js';
import {
  CERTIFICATION_SCHEMAS,
  CERTIFICATION_SCHEMA_VERSION,
  certificationEnvelopeDigest,
  certificationSchemaRef,
  checkCertificationEnvelope,
  isKnownCertificationSchema,
  makeCertificationRecordedEvent,
  makeRunCertificationCommand,
  parseCertificationEnvelope,
} from './envelopes.js';
import { createCertificationRecord } from './record.js';
import { createCertificationSuite } from './suite.js';
import {
  allPassSummary,
  digestOf,
  makeRecordInput,
  makeSuiteInput,
} from './test-support.js';

const CORR = toCorrelationId('corr-envelope-0001');
const IDEM = toIdempotencyKey('idem-envelope-0001');

describe('schema registry', () => {
  it('enumerates the eight certification schemas at version 1.0.0', () => {
    expect(CERTIFICATION_SCHEMA_VERSION).toBe('1.0.0');
    expect(Object.keys(CERTIFICATION_SCHEMAS)).toHaveLength(8);
    for (const name of Object.keys(CERTIFICATION_SCHEMAS)) {
      expect(CERTIFICATION_SCHEMAS[name as keyof typeof CERTIFICATION_SCHEMAS]).toBe('1.0.0');
    }
  });
  it('certificationSchemaRef resolves a known name to a versioned ref', () => {
    const ref = certificationSchemaRef('certification/certification-record');
    expect(ref).toEqual({
      namespace: 'certification',
      name: 'certification-record',
      version: '1.0.0',
    });
  });
  it('certificationSchemaRef rejects an unknown name', () => {
    expect(() =>
      certificationSchemaRef('certification/not-a-real-schema' as never),
    ).toThrowError(CertificationError);
  });
  it('isKnownCertificationSchema returns true only for registered refs at the registered version', () => {
    expect(
      isKnownCertificationSchema({
        namespace: 'certification',
        name: 'certification-record',
        version: '1.0.0',
      }),
    ).toBe(true);
    expect(
      isKnownCertificationSchema({
        namespace: 'certification',
        name: 'certification-record',
        version: '2.0.0',
      }),
    ).toBe(false);
  });
});

describe('run-certification-command envelope', () => {
  it('builds an envelope with a required idempotency key', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const payload = {
      suiteRef: suite.digest,
      possessionRef: await digestOf(104),
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      componentVerdicts: summary,
    };
    const env = makeRunCertificationCommand(payload, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    expect(env.kind).toBe('command');
    expect(env.idempotencyKey).toBe(IDEM);
    expect(env.correlationId).toBe(CORR);
    expect(env.schema).toContain('certification/run-certification-command@1.0.0');
  });

  it('rejects a command without an idempotency key (lock rule 17)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const payload = {
      suiteRef: suite.digest,
      possessionRef: await digestOf(104),
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      componentVerdicts: summary,
    };
    expect(() =>
      makeRunCertificationCommand(payload, {
        correlationId: CORR,
      }),
    ).toThrowError(CertificationError);
  });

  it('rejects a malformed suiteRef (not a sha256 hex)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const payload = {
      suiteRef: 'not-a-digest',
      possessionRef: await digestOf(104),
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      componentVerdicts: summary,
    };
    expect(() =>
      makeRunCertificationCommand(payload, {
        correlationId: CORR,
        idempotencyKey: IDEM,
      }),
    ).toThrowError(CertificationError);
  });

  it('rejects a malformed component-verdict summary', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const payload = {
      suiteRef: suite.digest,
      possessionRef: await digestOf(104),
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      // empty array is rejected by toComponentVerdictSummary
      componentVerdicts: [],
    };
    expect(() =>
      makeRunCertificationCommand(payload, {
        correlationId: CORR,
        idempotencyKey: IDEM,
      }),
    ).toThrowError(CertificationError);
  });
});

describe('certification-recorded-event envelope', () => {
  it('builds an event carrying the authoritative record', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(
      await makeRecordInput(suite, summary),
      suite,
    );
    const env = makeCertificationRecordedEvent(
      { record },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(env.kind).toBe('event');
    expect(env.idempotencyKey).toBe(IDEM);
    expect(env.schema).toContain('certification/certification-recorded-event@1.0.0');
  });

  it('rejects an event with a malformed record payload', async () => {
    expect(() =>
      makeCertificationRecordedEvent(
        { record: 'bad' as never },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).toThrowError(CertificationError);
  });
});

describe('envelope parsing + integrity', () => {
  it('parseCertificationEnvelope parses a serialized envelope (no schema pin)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const payload = {
      suiteRef: suite.digest,
      possessionRef: await digestOf(104),
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      componentVerdicts: summary,
    };
    const env = makeRunCertificationCommand(payload, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const serialized = JSON.stringify(env);
    const parsed = parseCertificationEnvelope(serialized);
    expect(parsed.id).toBe(env.id);
    expect(parsed.kind).toBe('command');
  });

  it('parseCertificationEnvelope pins to a known schema when given a name', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const payload = {
      suiteRef: suite.digest,
      possessionRef: await digestOf(104),
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      componentVerdicts: summary,
    };
    const env = makeRunCertificationCommand(payload, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const serialized = JSON.stringify(env);
    const parsed = parseCertificationEnvelope(
      serialized,
      'certification/run-certification-command',
    );
    expect(parsed.schema).toContain('certification/run-certification-command@1.0.0');
  });

  it('certificationEnvelopeDigest computes a stable sha256 over the envelope', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const payload = {
      suiteRef: suite.digest,
      possessionRef: await digestOf(104),
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      componentVerdicts: summary,
    };
    const env = makeRunCertificationCommand(payload, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const digest = await certificationEnvelopeDigest(env);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('checkCertificationEnvelope passes on a digest match and fails on mismatch', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const payload = {
      suiteRef: suite.digest,
      possessionRef: await digestOf(104),
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      componentVerdicts: summary,
    };
    const env = makeRunCertificationCommand(payload, {
      correlationId: CORR,
      idempotencyKey: IDEM,
    });
    const serialized = JSON.stringify(env);
    const digest = await certificationEnvelopeDigest(env);
    const checked = await checkCertificationEnvelope(serialized, digest);
    expect(checked.id).toBe(env.id);
    await expect(
      checkCertificationEnvelope(serialized, '0'.repeat(64)),
    ).rejects.toThrowError(CertificationError);
  });
});
