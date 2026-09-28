/**
 * Contract parity tests — bind the generated contracts
 * (contracts/trajectory/*.json, produced by
 * packages/trajectory/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/trajectory.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A009 convention.
 */

import { describe, expect, it } from 'vitest';
import runRefSchema from '../../../contracts/trajectory/trajectory-run-ref.v1.json' with { type: 'json' };
import headerSchema from '../../../contracts/trajectory/trajectory-header.v1.json' with { type: 'json' };
import entrySchema from '../../../contracts/trajectory/trajectory-entry.v1.json' with { type: 'json' };
import recordSchema from '../../../contracts/trajectory/trajectory-record.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/trajectory/trajectory-error.v1.json' with { type: 'json' };
import openCommandSchema from '../../../contracts/trajectory/open-trajectory-command.v1.json' with { type: 'json' };
import openedEventSchema from '../../../contracts/trajectory/trajectory-opened-event.v1.json' with { type: 'json' };
import appendCommandSchema from '../../../contracts/trajectory/append-trajectory-entry-command.v1.json' with { type: 'json' };
import appendedEventSchema from '../../../contracts/trajectory/trajectory-entry-appended-event.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/trajectory/trajectory-schema-registry.v1.json' with { type: 'json' };

import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  SEED_PATTERN_SOURCE,
  TRAJECTORY_ID_PATTERN_SOURCE,
  TRAJECTORY_TIMESTAMP_PATTERN_SOURCE,
} from './shared.js';
import {
  OBSERVATION_CHANNELS,
  TRAJECTORY_ENTRY_KINDS,
  TRAJECTORY_OUTCOMES,
} from './entry.js';
import { TRAJECTORY_HEADER_FIELDS, TRAJECTORY_HEADER_VERSION } from './header.js';
import { TRAJECTORY_ENTRY_FIELDS } from './entry.js';
import { TRAJECTORY_ERROR_CODES, TRAJECTORY_ERROR_CATEGORIES } from './errors.js';
import {
  TRAJECTORY_SCHEMAS,
  TRAJECTORY_SCHEMA_VERSION,
  trajectorySchemaRef,
} from './envelopes.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — trajectory-protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      runRefSchema,
      headerSchema,
      entrySchema,
      recordSchema,
      errorSchema,
      openCommandSchema,
      openedEventSchema,
      appendCommandSchema,
      appendedEventSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(10);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/trajectory\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('the run-ref contract mirrors the four address parts + optional record pin', () => {
    expect(runRefSchema.additionalProperties).toBe(false);
    expect(sorted(runRefSchema.required as string[])).toEqual(
      sorted([
        'taskVersion',
        'environmentVersion',
        'runId',
        'initialSnapshotDigest',
        'runRecordDigest',
      ]),
    );
    expect(runRefSchema.$defs.taskVersionRef.properties.taskId.pattern).toBe(
      '^[a-z][a-z0-9-]{0,63}$',
    );
    expect(runRefSchema.$defs.taskVersionRef.properties.version.pattern).toBe(
      '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$',
    );
    expect(runRefSchema.$defs.environmentVersionRef.properties.digest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    expect(runRefSchema.properties.initialSnapshotDigest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
  });

  it('the header contract mirrors the TS field list, patterns and version', () => {
    expect(sorted(headerSchema.required as string[])).toEqual(
      sorted([...TRAJECTORY_HEADER_FIELDS, 'digest']),
    );
    expect(headerSchema.additionalProperties).toBe(false);
    expect(headerSchema.properties.recordVersion.const).toBe(TRAJECTORY_HEADER_VERSION);
    expect(headerSchema.properties.trajectoryId.pattern).toBe(TRAJECTORY_ID_PATTERN_SOURCE);
    expect(headerSchema.properties.agentBodyRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(headerSchema.properties.substrateRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(headerSchema.properties.startedAt.pattern).toBe(TRAJECTORY_TIMESTAMP_PATTERN_SOURCE);
    expect(headerSchema.properties.seed.oneOf[1]?.pattern).toBe(SEED_PATTERN_SOURCE);
    expect(headerSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('the entry contract mirrors kinds, chained digests and payload defs', () => {
    expect(sorted(entrySchema.required as string[])).toEqual(
      sorted([...TRAJECTORY_ENTRY_FIELDS, 'prevDigest', 'stepDigest']),
    );
    expect(entrySchema.properties.kind.enum).toEqual([...TRAJECTORY_ENTRY_KINDS]);
    expect(entrySchema.properties.prevDigest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(entrySchema.properties.stepDigest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(entrySchema.properties.sequence.minimum).toBe(1);
    expect(entrySchema.$defs.observationPayload.properties.channel.enum).toEqual([
      ...OBSERVATION_CHANNELS,
    ]);
    expect(entrySchema.$defs.observationPayload.properties.content.pattern).toBe(
      NEUTRAL_TEXT_PATTERN_SOURCE,
    );
    expect(entrySchema.$defs.completionPayload.properties.outcome.enum).toEqual([
      ...TRAJECTORY_OUTCOMES,
    ]);
    expect(entrySchema.$defs.completionPayload.properties.evidenceDigests.items.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    expect(entrySchema.$defs.checkpointPayload.properties.snapshotDigest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
  });

  it('the record contract binds the header and entry schemas plus the chain head', () => {
    expect(sorted(recordSchema.required as string[])).toEqual(
      sorted(['header', 'entries', 'chainHead']),
    );
    expect(String(recordSchema.properties.header.$ref)).toContain('trajectory-header');
    expect(recordSchema.properties.entries.items.$ref).toBe(
      `arena:schema/trajectory/trajectory-entry@${TRAJECTORY_SCHEMA_VERSION}`,
    );
    expect(recordSchema.properties.chainHead.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('the error contract mirrors the closed code set and categories', () => {
    expect(sorted(errorSchema.properties.code.enum as string[])).toEqual(
      sorted([...Object.values(TRAJECTORY_ERROR_CODES)]),
    );
    expect(sorted(errorSchema.properties.category.enum as string[])).toEqual(
      sorted([...TRAJECTORY_ERROR_CATEGORIES]),
    );
    expect(errorSchema.additionalProperties).toBe(false);
  });

  it('command contracts require the digest-free append view and the header', () => {
    expect(openCommandSchema.properties.header.$ref).toBe(
      `arena:schema/trajectory/trajectory-header@${TRAJECTORY_SCHEMA_VERSION}`,
    );
    expect(sorted(appendCommandSchema.required as string[])).toEqual(
      sorted(['trajectoryId', 'sequence', 'kind', 'payload', 'occurredAt']),
    );
    expect(appendCommandSchema.properties.kind.enum).toEqual([...TRAJECTORY_ENTRY_KINDS]);
    expect('stepDigest' in appendCommandSchema.properties).toBe(false);
    expect(sorted(openedEventSchema.required as string[])).toEqual(sorted(['header']));
  });

  it('the entry-appended event contract carries the authoritative entry + chain head', () => {
    expect(sorted(appendedEventSchema.required as string[])).toEqual(
      sorted(['trajectoryId', 'entry', 'chainHead']),
    );
    expect(appendedEventSchema.properties.entry.$ref).toBe(
      `arena:schema/trajectory/trajectory-entry@${TRAJECTORY_SCHEMA_VERSION}`,
    );
    expect(appendedEventSchema.properties.chainHead.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('the schema registry enumerates exactly the TS registry', () => {
    const registered = Object.keys(TRAJECTORY_SCHEMAS).map(
      (name) => trajectorySchemaRef(name as keyof typeof TRAJECTORY_SCHEMAS),
    );
    expect(schemaRegistrySchema.enum).toHaveLength(registered.length);
    expect(sorted(schemaRegistrySchema.enum as string[])).toEqual(
      sorted(registered.map((r) => `arena:schema/${r.namespace}/${r.name}@${r.version}`)),
    );
  });
});
