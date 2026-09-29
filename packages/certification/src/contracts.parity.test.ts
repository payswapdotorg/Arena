/**
 * Contract parity tests — bind the generated contracts
 * (contracts/certification/*.json, produced by
 * packages/certification/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/certification.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A009/A011/A012/A013
 * convention.
 */

import { describe, expect, it } from 'vitest';
import suiteSchema from '../../../contracts/certification/certification-suite.v1.json' with { type: 'json' };
import recordSchema from '../../../contracts/certification/certification-record.v1.json' with { type: 'json' };
import statementSchema from '../../../contracts/certification/certification-statement.v1.json' with { type: 'json' };
import verdictSchema from '../../../contracts/certification/certification-verdict.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/certification/certification-error.v1.json' with { type: 'json' };
import runCommandSchema from '../../../contracts/certification/run-certification-command.v1.json' with { type: 'json' };
import recordedEventSchema from '../../../contracts/certification/certification-recorded-event.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/certification/certification-schema-registry.v1.json' with { type: 'json' };

import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  CERTIFICATION_TIMESTAMP_PATTERN_SOURCE,
  CERTIFICATION_VERSION_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  SUITE_REVISION_PATTERN_SOURCE,
} from './shared.js';
import {
  CERTIFICATION_VERDICTS,
  COMPONENT_VERDICTS,
  COMPONENT_VERDICT_ENTRY_FIELDS,
  UNKNOWN_CAUSE_FIELDS,
  UNKNOWN_REASONS,
  VERDICT_SEMANTICS_FIELDS,
} from './verdict.js';
import { COMPONENT_KINDS } from './component-kind.js';
import {
  CERTIFICATION_SUITE_DESCRIPTOR_FIELDS,
  SUITE_COMPONENT_REFS_FIELDS,
  SUITE_PROVENANCE_FIELDS,
  SUITE_ID_PATTERN_SOURCE,
} from './suite.js';
import {
  CERTIFICATION_RECORD_FIELDS,
  CERTIFICATION_RECORD_PROVENANCE_FIELDS,
} from './record.js';
import { CERTIFICATION_STATEMENT_FIELDS } from './statement.js';
import { CERTIFICATION_ERROR_CODES, CERTIFICATION_ERROR_CATEGORIES } from './errors.js';
import {
  CERTIFICATION_SCHEMAS,
  CERTIFICATION_SCHEMA_VERSION,
  certificationSchemaRef,
} from './envelopes.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — certification-protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      suiteSchema,
      recordSchema,
      statementSchema,
      verdictSchema,
      errorSchema,
      runCommandSchema,
      recordedEventSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(8);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(
        /^arena:schema\/certification\/[a-z0-9-]+@1\.0\.0$/,
      );
    }
  });

  it('the certification-suite contract mirrors the TS field list, kinds, verdict semantics and patterns', () => {
    expect(suiteSchema.additionalProperties).toBe(false);
    expect(sorted(suiteSchema.required as string[])).toEqual(
      sorted([...CERTIFICATION_SUITE_DESCRIPTOR_FIELDS, 'digest']),
    );
    expect(suiteSchema.properties.recordVersion.const).toBe(1);
    expect(suiteSchema.properties.suiteId.pattern).toBe(SUITE_ID_PATTERN_SOURCE);
    expect(suiteSchema.properties.version.pattern).toBe(CERTIFICATION_VERSION_PATTERN_SOURCE);
    expect(suiteSchema.properties.title.pattern).toBe(NEUTRAL_TEXT_PATTERN_SOURCE);
    expect(suiteSchema.properties.scopeStatement.pattern).toBe(NEUTRAL_TEXT_PATTERN_SOURCE);
    expect(suiteSchema.properties.components.minItems).toBe(1);
    expect(suiteSchema.properties.inputSchema.$ref).toBe('#/$defs/schemaRef');
    expect(suiteSchema.properties.outputSchema.$ref).toBe('#/$defs/schemaRef');
    expect(suiteSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // component refs $def mirrors SUITE_COMPONENT_REFS_FIELDS + the closed kinds
    expect(sorted(Object.keys(suiteSchema.$defs.suiteComponentRefs.properties))).toEqual(
      sorted([...SUITE_COMPONENT_REFS_FIELDS]),
    );
    expect(suiteSchema.$defs.suiteComponentRefs.properties.kind.enum).toEqual([
      ...COMPONENT_KINDS,
    ]);
    expect(suiteSchema.$defs.suiteComponentRefs.properties.refs.minItems).toBe(1);
    // verdict semantics $def mirrors VERDICT_SEMANTICS_FIELDS
    expect(sorted(Object.keys(suiteSchema.$defs.verdictSemantics.properties))).toEqual(
      sorted([...VERDICT_SEMANTICS_FIELDS]),
    );
    // suite provenance $def mirrors SUITE_PROVENANCE_FIELDS
    expect(sorted(Object.keys(suiteSchema.$defs.suiteProvenance.properties))).toEqual(
      sorted([...SUITE_PROVENANCE_FIELDS]),
    );
  });

  it('the certification-record contract mirrors the TS field list, verdicts and patterns', () => {
    expect(recordSchema.additionalProperties).toBe(false);
    expect(sorted(recordSchema.required as string[])).toEqual(
      sorted([...CERTIFICATION_RECORD_FIELDS, 'digest']),
    );
    expect(recordSchema.properties.suiteRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.possessionRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.bodyVersionRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.substrateRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.environmentRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.runtimeProfileRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.componentVerdicts.minItems).toBe(1);
    expect(recordSchema.properties.verdict.enum).toEqual([...CERTIFICATION_VERDICTS]);
    expect(recordSchema.properties.correlationId.pattern).toBe('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
    expect(recordSchema.properties.idempotencyKey.pattern).toBe('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
    expect(recordSchema.properties.inputDigest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.startedAt.pattern).toBe(CERTIFICATION_TIMESTAMP_PATTERN_SOURCE);
    expect(recordSchema.properties.finishedAt.pattern).toBe(CERTIFICATION_TIMESTAMP_PATTERN_SOURCE);
    expect(recordSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // component verdict entry $def mirrors COMPONENT_VERDICT_ENTRY_FIELDS + the closed component verdict enum
    expect(sorted(Object.keys(recordSchema.$defs.componentVerdictEntry.properties))).toEqual(
      sorted([...COMPONENT_VERDICT_ENTRY_FIELDS]),
    );
    expect(recordSchema.$defs.componentVerdictEntry.properties.refKind.enum).toEqual([
      ...COMPONENT_KINDS,
    ]);
    expect(recordSchema.$defs.componentVerdictEntry.properties.verdict.enum).toEqual([
      ...COMPONENT_VERDICTS,
    ]);
    // unknown cause $def mirrors UNKNOWN_CAUSE_FIELDS + the closed reason taxonomy
    expect(sorted(Object.keys(recordSchema.$defs.unknownCause.properties))).toEqual(
      sorted([...UNKNOWN_CAUSE_FIELDS]),
    );
    expect(recordSchema.$defs.unknownCause.properties.reason.enum).toEqual([...UNKNOWN_REASONS]);
    // statement $def mirrors CERTIFICATION_STATEMENT_FIELDS + the closed verdict enum
    expect(sorted(Object.keys(recordSchema.$defs.certificationStatement.properties))).toEqual(
      sorted([...CERTIFICATION_STATEMENT_FIELDS]),
    );
    expect(recordSchema.$defs.certificationStatement.properties.verdict.enum).toEqual([
      ...CERTIFICATION_VERDICTS,
    ]);
    expect(recordSchema.$defs.certificationStatement.properties.suiteRevision.pattern).toBe(
      SUITE_REVISION_PATTERN_SOURCE,
    );
    // record provenance $def mirrors CERTIFICATION_RECORD_PROVENANCE_FIELDS
    expect(sorted(Object.keys(recordSchema.$defs.recordProvenance.properties))).toEqual(
      sorted([...CERTIFICATION_RECORD_PROVENANCE_FIELDS]),
    );
  });

  it('the certification-statement contract mirrors the TS field list', () => {
    expect(statementSchema.additionalProperties).toBe(false);
    expect(sorted(statementSchema.required as string[])).toEqual(
      sorted([...CERTIFICATION_STATEMENT_FIELDS]),
    );
    expect(statementSchema.properties.verdict.enum).toEqual([...CERTIFICATION_VERDICTS]);
    expect(statementSchema.properties.suiteRevision.pattern).toBe(SUITE_REVISION_PATTERN_SOURCE);
    expect(statementSchema.properties.statementText.pattern).toBe(NEUTRAL_TEXT_PATTERN_SOURCE);
  });

  it('the certification-verdict contract mirrors the declared-semantics object', () => {
    expect(verdictSchema.allOf).toEqual([{ $ref: '#/$defs/verdictSemantics' }]);
    expect(verdictSchema.$id).toBe(
      `arena:schema/certification/certification-verdict@${CERTIFICATION_SCHEMA_VERSION}`,
    );
    expect(verdictSchema.$defs.verdictSemantics.properties.pass.pattern).toBe(
      NEUTRAL_TEXT_PATTERN_SOURCE,
    );
    expect(verdictSchema.$defs.verdictSemantics.required).toEqual([
      'pass',
      'conditional-pass',
      'fail',
      'unknown',
    ]);
  });

  it('the error contract mirrors the closed code set and categories', () => {
    expect(sorted(errorSchema.properties.code.enum as string[])).toEqual(
      sorted([...Object.values(CERTIFICATION_ERROR_CODES)]),
    );
    expect(sorted(errorSchema.properties.category.enum as string[])).toEqual(
      sorted([...CERTIFICATION_ERROR_CATEGORIES]),
    );
    expect(errorSchema.additionalProperties).toBe(false);
    expect(errorSchema.required).toEqual(['code', 'category', 'message']);
  });

  it('command / event contracts mirror the wire payloads', () => {
    expect(sorted(runCommandSchema.required as string[])).toEqual(
      sorted([
        'suiteRef',
        'possessionRef',
        'bodyVersionRef',
        'substrateRef',
        'environmentRef',
        'runtimeProfileRef',
        'componentVerdicts',
      ]),
    );
    expect(runCommandSchema.properties.suiteRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.properties.possessionRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.properties.bodyVersionRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.properties.substrateRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.properties.environmentRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.properties.runtimeProfileRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.properties.componentVerdicts.minItems).toBe(1);
    expect(runCommandSchema.additionalProperties).toBe(false);
    expect(sorted(Object.keys(runCommandSchema.$defs.componentVerdictEntry.properties))).toEqual(
      sorted([...COMPONENT_VERDICT_ENTRY_FIELDS]),
    );
    expect(sorted(recordedEventSchema.required as string[])).toEqual(sorted(['record']));
    expect(recordedEventSchema.properties.record.$ref).toBe(
      `arena:schema/certification/certification-record@${CERTIFICATION_SCHEMA_VERSION}`,
    );
    expect(recordedEventSchema.additionalProperties).toBe(false);
  });

  it('the schema registry enumerates exactly the TS registry', () => {
    const registered = Object.keys(CERTIFICATION_SCHEMAS).map(
      (name) => certificationSchemaRef(name as keyof typeof CERTIFICATION_SCHEMAS),
    );
    expect(schemaRegistrySchema.enum).toHaveLength(registered.length);
    expect(sorted(schemaRegistrySchema.enum as string[])).toEqual(
      sorted(registered.map((r) => `arena:schema/${r.namespace}/${r.name}@${r.version}`)),
    );
  });
});
