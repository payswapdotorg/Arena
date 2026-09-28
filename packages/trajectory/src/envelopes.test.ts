/**
 * Envelope wiring tests — commands with REQUIRED idempotency keys,
 * events, schema pinning, canonical digests and tamper verification,
 * mirroring the artifact-protocol / job-protocol envelope patterns
 * exactly (Work Order A011 gates 5, 11).
 */

import { describe, expect, it } from 'vitest';
import {
  ProtocolError,
  canonicalJson,
  newCorrelationId,
  serializeEnvelope,
  toCorrelationId,
  toIdempotencyKey,
} from '@arena/protocol-core';
import {
  TRAJECTORY_SCHEMAS,
  TRAJECTORY_SCHEMA_VERSION,
  isKnownTrajectorySchema,
  makeAppendTrajectoryEntryCommand,
  makeOpenTrajectoryCommand,
  makeTrajectoryEntryAppendedEvent,
  makeTrajectoryOpenedEvent,
  parseTrajectoryEnvelope,
  trajectoryEnvelopeDigest,
  trajectorySchemaRef,
  verifyTrajectoryEnvelope,
} from './envelopes.js';
import { openTrajectory, appendTrajectoryEntry } from './record.js';
import { TRAJECTORY_ERROR_CODES } from './errors.js';
import { toTrajectoryId, toTrajectoryTimestamp } from './shared.js';
import { makeHeaderInput, makeMixedSequence, T0 } from './test-support.js';
import type { TrajectoryRecord } from './record.js';

const CORRELATION = toCorrelationId('corr-envelope-test');
const IDEMPOTENCY = toIdempotencyKey('idem-envelope-test');
const TRAJECTORY_ID = toTrajectoryId('trajectory-000042');
const ENTRY_AT = toTrajectoryTimestamp(T0, 'envelope test fixture');

async function buildRecord(): Promise<TrajectoryRecord> {
  let record = await openTrajectory(makeHeaderInput());
  for (const input of makeMixedSequence()) {
    record = await appendTrajectoryEntry(record, input);
  }
  return record;
}

describe('schema registry', () => {
  it('registers every trajectory schema at v1.0.0', () => {
    expect(Object.keys(TRAJECTORY_SCHEMAS).sort()).toEqual([
      'trajectory/append-trajectory-entry-command',
      'trajectory/open-trajectory-command',
      'trajectory/schema-registry',
      'trajectory/trajectory-entry',
      'trajectory/trajectory-entry-appended-event',
      'trajectory/trajectory-error',
      'trajectory/trajectory-header',
      'trajectory/trajectory-opened-event',
      'trajectory/trajectory-record',
      'trajectory/trajectory-run-ref',
    ]);
    for (const version of Object.values(TRAJECTORY_SCHEMAS)) {
      expect(version).toBe(TRAJECTORY_SCHEMA_VERSION);
    }
  });

  it('resolves SchemaRefs and recognizes known refs only', () => {
    const ref = trajectorySchemaRef('trajectory/trajectory-header');
    expect(ref).toEqual({ namespace: 'trajectory', name: 'trajectory-header', version: '1.0.0' });
    expect(isKnownTrajectorySchema(ref)).toBe(true);
    expect(
      isKnownTrajectorySchema({ namespace: 'trajectory', name: 'trajectory-header', version: '9.9.9' }),
    ).toBe(false);
    expect(
      isKnownTrajectorySchema({ namespace: 'environment', name: 'trajectory-header', version: '1.0.0' }),
    ).toBe(false);
  });
});

describe('command constructors (idempotency keys REQUIRED — lock rule 17)', () => {
  it('makeOpenTrajectoryCommand builds a command envelope with the header payload', async () => {
    const record = await openTrajectory(makeHeaderInput());
    const envelope = makeOpenTrajectoryCommand(
      { header: record.header },
      { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/trajectory/open-trajectory-command@1.0.0');
    expect(envelope.correlationId).toBe(CORRELATION);
    expect(envelope.idempotencyKey).toBe(IDEMPOTENCY);
    expect(envelope.payload.header).toBe(record.header);
  });

  it('commands without an idempotency key are rejected', async () => {
    const record = await openTrajectory(makeHeaderInput());
    expect(() =>
      makeOpenTrajectoryCommand({ header: record.header }, { correlationId: CORRELATION }),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_ENTRY }),
    );
    expect(() =>
      makeAppendTrajectoryEntryCommand(
        {
          trajectoryId: TRAJECTORY_ID,
          sequence: 1,
          kind: 'action',
          payload: { actionId: 'x' },
          occurredAt: ENTRY_AT,
        },
        { correlationId: CORRELATION },
      ),
    ).toThrowError(/idempotency key/);
  });

  it('makeAppendTrajectoryEntryCommand carries the DIGEST-FREE entry view', () => {
    const envelope = makeAppendTrajectoryEntryCommand(
      {
        trajectoryId: TRAJECTORY_ID,
        sequence: 1,
        kind: 'action',
        payload: { actionId: 'shell-exec', input: { command: 'make' } },
        occurredAt: ENTRY_AT,
      },
      { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
    );
    expect(envelope.schema).toBe(
      'arena:schema/trajectory/append-trajectory-entry-command@1.0.0',
    );
    expect(envelope.payload.sequence).toBe(1);
    expect('stepDigest' in envelope.payload).toBe(false); // store computes digests
  });

  it('append command validates trajectory id and sequence (negatives)', () => {
    expect(() =>
      makeAppendTrajectoryEntryCommand(
        {
          trajectoryId: 'UPPER' as never,
          sequence: 1,
          kind: 'action',
          payload: {},
          occurredAt: ENTRY_AT,
        },
        { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
      ),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(() =>
      makeAppendTrajectoryEntryCommand(
        {
          trajectoryId: TRAJECTORY_ID,
          sequence: 0,
          kind: 'action',
          payload: {},
          occurredAt: ENTRY_AT,
        },
        { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
      ),
    ).toThrowError(/positive integer sequence/);
  });

  it('open command rejects structurally invalid headers', async () => {
    const record = await openTrajectory(makeHeaderInput());
    expect(() =>
      makeOpenTrajectoryCommand(
        { header: { ...record.header, digest: 'x'.repeat(64) } as never },
        { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
      ),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_HEADER }),
    );
  });
});

describe('event constructors', () => {
  it('makeTrajectoryOpenedEvent builds an event envelope (idempotency optional)', async () => {
    const record = await openTrajectory(makeHeaderInput());
    const envelope = makeTrajectoryOpenedEvent(
      { header: record.header },
      { correlationId: CORRELATION },
    );
    expect(envelope.kind).toBe('event');
    expect(envelope.schema).toBe('arena:schema/trajectory/trajectory-opened-event@1.0.0');
    expect(envelope.idempotencyKey).toBeNull();
    const keyed = makeTrajectoryOpenedEvent(
      { header: record.header },
      { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
    );
    expect(keyed.idempotencyKey).toBe(IDEMPOTENCY);
  });

  it('makeTrajectoryEntryAppendedEvent carries the authoritative entry + chain head', async () => {
    const record = await buildRecord();
    const entry = record.entries[record.entries.length - 1];
    if (entry === undefined) throw new Error('fixture record must have entries');
    const envelope = makeTrajectoryEntryAppendedEvent(
      { trajectoryId: record.header.trajectoryId, entry, chainHead: record.chainHead },
      { correlationId: CORRELATION },
    );
    expect(envelope.schema).toBe(
      'arena:schema/trajectory/trajectory-entry-appended-event@1.0.0',
    );
    expect(envelope.payload.entry).toBe(entry);
    expect(envelope.payload.chainHead).toBe(record.chainHead);
  });

  it('entry-appended event validates its payload (negatives)', async () => {
    const record = await buildRecord();
    const entry = record.entries[0];
    if (entry === undefined) throw new Error('fixture record must have entries');
    expect(() =>
      makeTrajectoryEntryAppendedEvent(
        { trajectoryId: 'UPPER' as never, entry, chainHead: record.chainHead },
        { correlationId: CORRELATION },
      ),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(() =>
      makeTrajectoryEntryAppendedEvent(
        {
          trajectoryId: record.header.trajectoryId,
          entry: { ...entry, stepDigest: 'x'.repeat(64) } as never,
          chainHead: record.chainHead,
        },
        { correlationId: CORRELATION },
      ),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_ENTRY }),
    );
    expect(() =>
      makeTrajectoryEntryAppendedEvent(
        { trajectoryId: record.header.trajectoryId, entry, chainHead: 'nope' as never },
        { correlationId: CORRELATION },
      ),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_DIGEST }),
    );
  });
});

describe('parse / digest / verify round-trip', () => {
  it('serializes, parses and re-digests identically', async () => {
    const record = await openTrajectory(makeHeaderInput());
    const envelope = makeOpenTrajectoryCommand(
      { header: record.header },
      { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
    );
    const raw = serializeEnvelope(envelope);
    const parsed = parseTrajectoryEnvelope<typeof envelope.payload>(raw);
    expect(parsed.schema).toBe(envelope.schema);
    expect(parsed.idempotencyKey).toBe(IDEMPOTENCY);
    expect(canonicalJson(parsed.payload)).toBe(canonicalJson(envelope.payload));
    const digest = await trajectoryEnvelopeDigest(envelope);
    await expect(verifyTrajectoryEnvelope(raw, digest)).resolves.toBeDefined();
  });

  it('schema pinning rejects foreign payload schemas', async () => {
    const record = await openTrajectory(makeHeaderInput());
    const envelope = makeOpenTrajectoryCommand(
      { header: record.header },
      { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
    );
    const raw = serializeEnvelope(envelope);
    expect(() =>
      parseTrajectoryEnvelope(raw, 'trajectory/append-trajectory-entry-command'),
    ).toThrowError(ProtocolError);
    expect(() => parseTrajectoryEnvelope(raw, 'trajectory/open-trajectory-command')).not.toThrow();
  });

  it('tampered envelope bytes fail digest verification', async () => {
    const record = await openTrajectory(makeHeaderInput());
    const envelope = makeTrajectoryOpenedEvent(
      { header: record.header },
      { correlationId: CORRELATION },
    );
    const raw = serializeEnvelope(envelope);
    const digest = await trajectoryEnvelopeDigest(envelope);
    const tampered = raw.replace('"kind":"event"', '"kind":"query"');
    await expect(verifyTrajectoryEnvelope(tampered, digest)).rejects.toThrowError(ProtocolError);
  });

  it('fresh correlation ids are mintable (wire plumbing sanity)', () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).not.toBe(b);
    expect(isKnownTrajectorySchema(trajectorySchemaRef('trajectory/schema-registry'))).toBe(true);
  });
});
