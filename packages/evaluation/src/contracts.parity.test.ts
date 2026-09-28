/**
 * Contract parity tests — bind the generated contracts
 * (contracts/evaluation/*.json, produced by
 * packages/evaluation/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/evaluation.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A009/A011
 * convention.
 */

import { describe, expect, it } from 'vitest';
import descriptorSchema from '../../../contracts/evaluation/evaluator-descriptor.v1.json' with { type: 'json' };
import criteriaSchema from '../../../contracts/evaluation/evaluation-criteria.v1.json' with { type: 'json' };
import recordSchema from '../../../contracts/evaluation/evaluation-record.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/evaluation/evaluation-error.v1.json' with { type: 'json' };
import runCommandSchema from '../../../contracts/evaluation/run-evaluation-command.v1.json' with { type: 'json' };
import recordedEventSchema from '../../../contracts/evaluation/evaluation-recorded-event.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/evaluation/evaluation-schema-registry.v1.json' with { type: 'json' };

import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  EVALUATION_ID_PATTERN_SOURCE,
  EVALUATION_TIMESTAMP_PATTERN_SOURCE,
  EVALUATION_VERSION_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  SEED_PATTERN_SOURCE,
} from './shared.js';
import {
  AGGREGATE_OUTCOMES,
  AGGREGATE_OUTCOME_FIELDS,
  CRITERION_VERDICT_FIELDS,
  EVALUATION_RECORD_FIELDS,
  EVALUATION_RECORD_PROVENANCE_FIELDS,
} from './record.js';
import {
  CRITERION_ENTRY_FIELDS,
  EVALUATION_CRITERIA_FIELDS,
  EVALUATION_THRESHOLDS_FIELDS,
} from './criteria.js';
import {
  EVALUATOR_DESCRIPTOR_FIELDS,
  EVALUATOR_ID_PATTERN_SOURCE,
  EVALUATOR_INPUT_FIELDS,
  EVALUATOR_PROVENANCE_FIELDS,
  EVALUATOR_REPRODUCIBILITY_FIELDS,
} from './descriptor.js';
import { EVALUATION_ERROR_CODES, EVALUATION_ERROR_CATEGORIES } from './errors.js';
import { EVALUATOR_KINDS } from './evaluator-kind.js';
import { AGGREGATION_POLICIES } from './criteria.js';
import {
  EVALUATION_SCHEMAS,
  EVALUATION_SCHEMA_VERSION,
  evaluationSchemaRef,
} from './envelopes.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — evaluation-protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      descriptorSchema,
      criteriaSchema,
      recordSchema,
      errorSchema,
      runCommandSchema,
      recordedEventSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(7);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/evaluation\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('the evaluator-descriptor contract mirrors the TS field list, kinds and patterns', () => {
    expect(descriptorSchema.additionalProperties).toBe(false);
    expect(sorted(descriptorSchema.required as string[])).toEqual(
      sorted([...EVALUATOR_DESCRIPTOR_FIELDS, 'digest']),
    );
    expect(descriptorSchema.properties.recordVersion.const).toBe(1);
    expect(descriptorSchema.properties.evaluatorId.pattern).toBe(EVALUATOR_ID_PATTERN_SOURCE);
    expect(descriptorSchema.properties.version.pattern).toBe(EVALUATION_VERSION_PATTERN_SOURCE);
    expect(descriptorSchema.properties.kind.enum).toEqual([...EVALUATOR_KINDS]);
    expect(descriptorSchema.properties.criteriaRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(descriptorSchema.properties.confidence.minimum).toBe(0);
    expect(descriptorSchema.properties.confidence.maximum).toBe(1);
    expect(descriptorSchema.properties.limitations.pattern).toBe(NEUTRAL_TEXT_PATTERN_SOURCE);
    expect(descriptorSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // input contract $def mirrors EVALUATOR_INPUT_FIELDS
    expect(sorted(Object.keys(descriptorSchema.$defs.inputContract.properties))).toEqual(
      sorted([...EVALUATOR_INPUT_FIELDS]),
    );
    // reproducibility $def mirrors EVALUATOR_REPRODUCIBILITY_FIELDS
    expect(sorted(Object.keys(descriptorSchema.$defs.reproducibility.properties))).toEqual(
      sorted([...EVALUATOR_REPRODUCIBILITY_FIELDS]),
    );
    // provenance $def mirrors EVALUATOR_PROVENANCE_FIELDS
    expect(sorted(Object.keys(descriptorSchema.$defs.evaluatorProvenance.properties))).toEqual(
      sorted([...EVALUATOR_PROVENANCE_FIELDS]),
    );
    expect(descriptorSchema.$defs.evaluatorProvenance.properties.submittedAt.pattern).toBe(
      EVALUATION_TIMESTAMP_PATTERN_SOURCE,
    );
  });

  it('the criteria contract mirrors the TS field list, policies and patterns', () => {
    expect(criteriaSchema.additionalProperties).toBe(false);
    expect(sorted(criteriaSchema.required as string[])).toEqual(
      sorted([...EVALUATION_CRITERIA_FIELDS, 'digest']),
    );
    expect(criteriaSchema.properties.aggregation.enum).toEqual([...AGGREGATION_POLICIES]);
    expect(criteriaSchema.properties.criteriaId.pattern).toBe(EVALUATION_ID_PATTERN_SOURCE);
    expect(criteriaSchema.properties.version.pattern).toBe(EVALUATION_VERSION_PATTERN_SOURCE);
    expect(criteriaSchema.properties.entries.minItems).toBe(1);
    expect(criteriaSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // criterion entry $def mirrors CRITERION_ENTRY_FIELDS
    expect(sorted(Object.keys(criteriaSchema.$defs.criterionEntry.properties))).toEqual(
      sorted([...CRITERION_ENTRY_FIELDS]),
    );
    expect(criteriaSchema.$defs.criterionEntry.properties.criterionId.pattern).toBe(
      EVALUATION_ID_PATTERN_SOURCE,
    );
    expect(criteriaSchema.$defs.criterionEntry.properties.description.pattern).toBe(
      NEUTRAL_TEXT_PATTERN_SOURCE,
    );
    expect(criteriaSchema.$defs.criterionEntry.properties.targetRef.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    // thresholds $def mirrors EVALUATION_THRESHOLDS_FIELDS
    expect(sorted(Object.keys(criteriaSchema.$defs.thresholds.properties))).toEqual(
      sorted([...EVALUATION_THRESHOLDS_FIELDS]),
    );
  });

  it('the record contract mirrors the TS field list, verdicts and aggregate', () => {
    expect(recordSchema.additionalProperties).toBe(false);
    expect(sorted(recordSchema.required as string[])).toEqual(
      sorted([...EVALUATION_RECORD_FIELDS, 'digest']),
    );
    expect(recordSchema.properties.seed.oneOf[1]?.pattern).toBe(SEED_PATTERN_SOURCE);
    expect(recordSchema.properties.verdicts.minItems).toBe(1);
    expect(recordSchema.properties.confidence.minimum).toBe(0);
    expect(recordSchema.properties.confidence.maximum).toBe(1);
    expect(recordSchema.properties.startedAt.pattern).toBe(EVALUATION_TIMESTAMP_PATTERN_SOURCE);
    expect(recordSchema.properties.finishedAt.pattern).toBe(EVALUATION_TIMESTAMP_PATTERN_SOURCE);
    expect(recordSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // verdict $def mirrors CRITERION_VERDICT_FIELDS
    expect(sorted(Object.keys(recordSchema.$defs.criterionVerdict.properties))).toEqual(
      sorted([...CRITERION_VERDICT_FIELDS]),
    );
    // aggregate $def mirrors AGGREGATE_OUTCOME_FIELDS and outcome vocabulary
    expect(sorted(Object.keys(recordSchema.$defs.aggregateOutcome.properties))).toEqual(
      sorted([...AGGREGATE_OUTCOME_FIELDS]),
    );
    expect(recordSchema.$defs.aggregateOutcome.properties.outcome.enum).toEqual([
      ...AGGREGATE_OUTCOMES,
    ]);
    // provenance $def mirrors EVALUATION_RECORD_PROVENANCE_FIELDS
    expect(sorted(Object.keys(recordSchema.$defs.recordProvenance.properties))).toEqual(
      sorted([...EVALUATION_RECORD_PROVENANCE_FIELDS]),
    );
  });

  it('the error contract mirrors the closed code set and categories', () => {
    expect(sorted(errorSchema.properties.code.enum as string[])).toEqual(
      sorted([...Object.values(EVALUATION_ERROR_CODES)]),
    );
    expect(sorted(errorSchema.properties.category.enum as string[])).toEqual(
      sorted([...EVALUATION_ERROR_CATEGORIES]),
    );
    expect(errorSchema.additionalProperties).toBe(false);
    expect(errorSchema.required).toEqual(['code', 'category', 'message']);
  });

  it('command / event contracts mirror the wire payloads', () => {
    expect(sorted(runCommandSchema.required as string[])).toEqual(
      sorted(['evaluatorRef', 'caseRef', 'trajectoryRef', 'seed']),
    );
    expect(runCommandSchema.properties.evaluatorRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.properties.seed.oneOf[1]?.pattern).toBe(SEED_PATTERN_SOURCE);
    expect(runCommandSchema.additionalProperties).toBe(false);
    expect(sorted(recordedEventSchema.required as string[])).toEqual(sorted(['record']));
    expect(recordedEventSchema.properties.record.$ref).toBe(
      `arena:schema/evaluation/evaluation-record@${EVALUATION_SCHEMA_VERSION}`,
    );
    expect(recordedEventSchema.additionalProperties).toBe(false);
  });

  it('the schema registry enumerates exactly the TS registry', () => {
    const registered = Object.keys(EVALUATION_SCHEMAS).map(
      (name) => evaluationSchemaRef(name as keyof typeof EVALUATION_SCHEMAS),
    );
    expect(schemaRegistrySchema.enum).toHaveLength(registered.length);
    expect(sorted(schemaRegistrySchema.enum as string[])).toEqual(
      sorted(registered.map((r) => `arena:schema/${r.namespace}/${r.name}@${r.version}`)),
    );
  });
});
