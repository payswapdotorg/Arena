/**
 * Contract parity tests — bind the generated contracts
 * (contracts/certification/*.json, produced by
 * packages/certification/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/certification.
 *
 * If someone edits the TS constants without regenerating contracts (or
 * vice versa), these tests fail — and the drift suite (drift.test.ts)
 * fails when the committed JSON no longer matches the generator. Two
 * independent tripwires for contract drift, exactly like the
 * A001/A011/A012/A013 convention.
 */

import { describe, expect, it } from 'vitest';
import suiteSchema from '../../../contracts/certification/certification-suite.v1.json' with { type: 'json' };
import recordSchema from '../../../contracts/certification/certification-record.v1.json' with { type: 'json' };
import statementSchema from '../../../contracts/certification/certification-statement.v1.json' with { type: 'json' };
import outcomeSchema from '../../../contracts/certification/certification-outcome.v1.json' with { type: 'json' };
import levelSchema from '../../../contracts/certification/certification-level.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/certification/certification-error.v1.json' with { type: 'json' };
import runCommandSchema from '../../../contracts/certification/run-certification-command.v1.json' with { type: 'json' };
import recordedEventSchema from '../../../contracts/certification/certification-recorded-event.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/certification/certification-schema-registry.v1.json' with { type: 'json' };

import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  CERTIFICATION_ID_PATTERN_SOURCE,
  CERTIFICATION_TIMESTAMP_PATTERN_SOURCE,
  CERTIFICATION_VERSION_PATTERN_SOURCE,
  WORKSPACE_ID_PATTERN_SOURCE,
  TENANT_ID_PATTERN_SOURCE,
} from './shared.js';
import {
  CERTIFICATION_STAGE_KINDS,
  CERTIFICATION_SUITE_FIELDS,
  SUITE_PROVENANCE_FIELDS,
} from './suite.js';
import {
  CERTIFICATION_RECORD_FIELDS,
  CERTIFICATION_RECORD_KINDS,
  CERTIFICATION_RECORD_PROVENANCE_FIELDS,
} from './record.js';
import {
  CERTIFICATION_STATEMENT_FIELDS,
  CERTIFICATION_STATEMENT_SCOPE_FIELDS,
} from './statement.js';
import {
  CERTIFICATION_UNKNOWN_REASONS,
  CERTIFICATION_VERDICTS,
  STAGE_RESULT_FIELDS,
  STAGE_REASONS,
} from './outcome.js';
import { CERTIFICATION_GRANT_LEVELS, CERTIFICATION_LEVELS } from './level.js';
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

const AGENT_BODY_PATTERNS = {
  tenant: '^[a-z][a-z0-9-]{1,62}$',
  name: '^[a-z][a-z0-9-]{1,127}$',
};

describe('generated contract parity — certification-protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      suiteSchema,
      recordSchema,
      statementSchema,
      outcomeSchema,
      levelSchema,
      errorSchema,
      runCommandSchema,
      recordedEventSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(9);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/certification\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('the certification-suite contract mirrors the TS field list, kinds and patterns', () => {
    expect(suiteSchema.additionalProperties).toBe(false);
    expect(sorted(suiteSchema.required as string[])).toEqual(
      sorted([...CERTIFICATION_SUITE_FIELDS, 'digest']),
    );
    expect(suiteSchema.properties.recordVersion.const).toBe(1);
    expect(suiteSchema.properties.suiteId.pattern).toBe(CERTIFICATION_ID_PATTERN_SOURCE);
    expect(suiteSchema.properties.version.pattern).toBe(CERTIFICATION_VERSION_PATTERN_SOURCE);
    expect(suiteSchema.properties.levelGrant.enum).toEqual([...CERTIFICATION_GRANT_LEVELS]);
    expect(suiteSchema.properties.stages.minItems).toBe(1);
    expect(suiteSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // stage $def mirrors the closed kind vocabulary
    expect(suiteSchema.$defs.suiteStage.properties.kind.enum).toEqual([
      ...CERTIFICATION_STAGE_KINDS,
    ]);
    expect(sorted(Object.keys(suiteSchema.$defs.suiteStage.properties))).toEqual([
      'criteriaRef',
      'datasetRef',
      'environmentRequirement',
      'evaluatorRef',
      'kind',
      'requiredTestSuites',
      'runtimeRequirement',
      'stageId',
      'verifierRef',
    ]);
    expect(suiteSchema.$defs.suiteStage.properties.stageId.pattern).toBe(
      CERTIFICATION_ID_PATTERN_SOURCE,
    );
    // suite provenance $def mirrors SUITE_PROVENANCE_FIELDS
    expect(sorted(Object.keys(suiteSchema.$defs.suiteProvenance.properties))).toEqual(
      sorted([...SUITE_PROVENANCE_FIELDS]),
    );
    expect(suiteSchema.$defs.suiteProvenance.properties.submittedAt.pattern).toBe(
      CERTIFICATION_TIMESTAMP_PATTERN_SOURCE,
    );
  });

  it('the certification-record contract mirrors the TS record surface', () => {
    expect(recordSchema.additionalProperties).toBe(false);
    expect(sorted(recordSchema.required as string[])).toEqual(
      sorted([...CERTIFICATION_RECORD_FIELDS, 'digest']),
    );
    expect(recordSchema.properties.recordVersion.const).toBe(1);
    expect(recordSchema.properties.kind.enum).toEqual([...CERTIFICATION_RECORD_KINDS]);
    expect(
      (recordSchema.properties.verdict as { oneOf: { enum?: string[] }[] }).oneOf?.[1]?.enum,
    ).toEqual([...CERTIFICATION_VERDICTS]);
    expect(
      (recordSchema.properties.grantedLevel as { oneOf: { enum?: string[] }[] }).oneOf?.[1]?.enum,
    ).toEqual([...CERTIFICATION_LEVELS]);
    // stage-result $def mirrors STAGE_RESULT_FIELDS + the closed reason vocabulary
    expect(sorted(Object.keys(recordSchema.$defs.stageResult.properties))).toEqual(
      sorted([...STAGE_RESULT_FIELDS]),
    );
    expect(recordSchema.$defs.stageResult.properties.reason.enum).toEqual([...STAGE_REASONS]);
    expect(recordSchema.$defs.unknownCause.properties.reason.enum).toEqual([
      ...CERTIFICATION_UNKNOWN_REASONS,
    ]);
    // record provenance $def mirrors CERTIFICATION_RECORD_PROVENANCE_FIELDS
    expect(sorted(Object.keys(recordSchema.$defs.recordProvenance.properties))).toEqual(
      sorted([...CERTIFICATION_RECORD_PROVENANCE_FIELDS]),
    );
    // subject $def carries the full five-component scope + tenant scoping
    expect(sorted(Object.keys(recordSchema.$defs.subject.properties))).toEqual([
      'bodyVersionRef',
      'environmentRef',
      'possessionRef',
      'runtimeProfile',
      'substrateRef',
      'tenantId',
      'workspaceId',
    ]);
    expect(recordSchema.$defs.subject!.properties.tenantId.oneOf[1]!.pattern).toBe(
      TENANT_ID_PATTERN_SOURCE,
    );
    expect(recordSchema.$defs.subject!.properties.workspaceId.oneOf[1]!.pattern).toBe(
      WORKSPACE_ID_PATTERN_SOURCE,
    );
    // the A003 body ref patterns are mirrored verbatim
    expect(recordSchema.$defs.bodyVersionRef!.properties.tenant.pattern).toBe(
      AGENT_BODY_PATTERNS.tenant,
    );
    expect(recordSchema.$defs.bodyVersionRef!.properties.name.pattern).toBe(AGENT_BODY_PATTERNS.name);
  });

  it('the certification-statement contract mirrors the design-law scope', () => {
    const statement = statementSchema.allOf[0]! as { $ref?: string };
    expect(statement.$ref).toBe('#/$defs/statement');
    expect(sorted(Object.keys(statementSchema.$defs.statement.properties))).toEqual(
      sorted([...CERTIFICATION_STATEMENT_FIELDS]),
    );
    expect(sorted(Object.keys(statementSchema.$defs.statementScope.properties))).toEqual(
      sorted([...CERTIFICATION_STATEMENT_SCOPE_FIELDS]),
    );
    // the statement requires EVERY scope component — an unscoped statement
    // cannot satisfy the contract (the design law, enforced by schema)
    expect(statementSchema.$defs.statementScope.required).toHaveLength(10);
    expect(statementSchema.$defs.statement!.properties.limitations.pattern).toBe(
      NEUTRAL_TEXT_PATTERN_SOURCE,
    );
  });

  it('the outcome, level and error contracts mirror the closed vocabularies', () => {
    expect(outcomeSchema.properties.verdict.enum).toEqual([...CERTIFICATION_VERDICTS]);
    expect(outcomeSchema.$defs.unknownCause.properties.reason.enum).toEqual([
      ...CERTIFICATION_UNKNOWN_REASONS,
    ]);
    expect(levelSchema.properties.level.enum).toEqual([...CERTIFICATION_LEVELS]);
    expect([...(errorSchema.properties.code.enum as string[])].sort()).toEqual(
      [...Object.values(CERTIFICATION_ERROR_CODES)].sort(),
    );
    expect([...(errorSchema.properties.category.enum as string[])]).toEqual(
      [...CERTIFICATION_ERROR_CATEGORIES].sort(),
    );
  });

  it('the wire contracts mirror the envelope payloads and the schema registry', () => {
    expect(sorted(runCommandSchema.required as string[])).toEqual([
      'evidenceRefs',
      'subject',
      'suiteRef',
    ]);
    expect(runCommandSchema.properties.suiteRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(sorted(Object.keys(runCommandSchema.$defs.subject.properties))).toContain(
      'bodyVersionRef',
    );
    expect(recordedEventSchema.required).toEqual(['record']);
    expect(recordedEventSchema.properties.record.$ref).toBe(
      `arena:schema/certification/certification-record@${CERTIFICATION_SCHEMA_VERSION}`,
    );
    const registry = certificationSchemaRef('certification/schema-registry' as never);
    expect(registry).toEqual({ namespace: 'certification', name: 'schema-registry', version: '1.0.0' });
    expect([...schemaRegistrySchema.enum].sort()).toEqual(
      Object.keys(CERTIFICATION_SCHEMAS)
        .map((name) => `arena:schema/certification/${name.split('/')[1]}@1.0.0`)
        .sort(),
    );
    expect(schemaRegistrySchema.enum).toHaveLength(9);
  });
});
