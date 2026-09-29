/**
 * Contract parity tests — bind the generated contracts
 * (contracts/verification/*.json, produced by
 * packages/verification/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/verification.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A009/A011/A012
 * convention.
 */

import { describe, expect, it } from 'vitest';
import descriptorSchema from '../../../contracts/verification/verifier-descriptor.v1.json' with { type: 'json' };
import recordSchema from '../../../contracts/verification/verification-record.v1.json' with { type: 'json' };
import outcomeSchema from '../../../contracts/verification/verification-outcome.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/verification/verification-error.v1.json' with { type: 'json' };
import runCommandSchema from '../../../contracts/verification/run-verification-command.v1.json' with { type: 'json' };
import recordedEventSchema from '../../../contracts/verification/verification-recorded-event.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/verification/verification-schema-registry.v1.json' with { type: 'json' };

import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  SEED_PATTERN_SOURCE,
  VERIFICATION_ID_PATTERN_SOURCE,
  VERIFICATION_TIMESTAMP_PATTERN_SOURCE,
  VERIFICATION_VERSION_PATTERN_SOURCE,
} from './shared.js';
import {
  EVIDENCE_REQUIREMENT_FIELDS,
  EVIDENCE_PROVENANCE_FIELDS,
  EVIDENCE_REFERENCE_FIELDS,
  EVIDENCE_SUPPORT_STATUSES,
  REQUIREMENT_SUPPORT_FIELDS,
} from './evidence.js';
import {
  OUTCOME_SEMANTICS_FIELDS,
  UNKNOWN_CAUSE_FIELDS,
  UNKNOWN_REASONS,
  VERIFICATION_OUTCOMES,
} from './outcome.js';
import {
  REPRODUCIBILITY_POLICIES,
  VERIFIER_DESCRIPTOR_FIELDS,
  VERIFIER_PROVENANCE_FIELDS,
  VERIFIER_REPRODUCIBILITY_FIELDS,
} from './descriptor.js';
import { VERIFIER_METHODS } from './verifier-method.js';
import { VERIFICATION_ERROR_CODES, VERIFICATION_ERROR_CATEGORIES } from './errors.js';
import {
  VERIFICATION_SCHEMAS,
  VERIFICATION_SCHEMA_VERSION,
  verificationSchemaRef,
} from './envelopes.js';
import { VERIFICATION_RECORD_FIELDS, VERIFICATION_RECORD_PROVENANCE_FIELDS } from './record.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const ARTIFACT_PATTERNS = {
  namespace: '^[a-z][a-z0-9-]{1,62}$',
  name: '^[a-z][a-z0-9-]{1,127}$',
  version: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$',
};

describe('generated contract parity — verification-protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      descriptorSchema,
      recordSchema,
      outcomeSchema,
      errorSchema,
      runCommandSchema,
      recordedEventSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(7);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/verification\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('the verifier-descriptor contract mirrors the TS field list, methods and patterns', () => {
    expect(descriptorSchema.additionalProperties).toBe(false);
    expect(sorted(descriptorSchema.required as string[])).toEqual(
      sorted([...VERIFIER_DESCRIPTOR_FIELDS, 'digest']),
    );
    expect(descriptorSchema.properties.recordVersion.const).toBe(1);
    expect(descriptorSchema.properties.verifierId.pattern).toBe(VERIFICATION_ID_PATTERN_SOURCE);
    expect(descriptorSchema.properties.version.pattern).toBe(VERIFICATION_VERSION_PATTERN_SOURCE);
    expect(descriptorSchema.properties.method.enum).toEqual([...VERIFIER_METHODS]);
    expect(descriptorSchema.properties.requiredEvidence.minItems).toBe(1);
    expect(descriptorSchema.properties.inputSchema.$ref).toBe('#/$defs/schemaRef');
    expect(descriptorSchema.properties.outputSchema.$ref).toBe('#/$defs/schemaRef');
    expect(descriptorSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // evidence requirement $def mirrors EVIDENCE_REQUIREMENT_FIELDS
    expect(sorted(Object.keys(descriptorSchema.$defs.evidenceRequirement.properties))).toEqual(
      sorted([...EVIDENCE_REQUIREMENT_FIELDS]),
    );
    expect(descriptorSchema.$defs.evidenceRequirement.properties.requirementId.pattern).toBe(
      VERIFICATION_ID_PATTERN_SOURCE,
    );
    expect(descriptorSchema.$defs.evidenceRequirement.properties.claim.pattern).toBe(
      NEUTRAL_TEXT_PATTERN_SOURCE,
    );
    // artifact ref $def mirrors the A002 identity patterns
    expect(descriptorSchema.$defs.artifactRef.properties.namespace.pattern).toBe(ARTIFACT_PATTERNS.namespace);
    expect(descriptorSchema.$defs.artifactRef.properties.name.pattern).toBe(ARTIFACT_PATTERNS.name);
    expect(descriptorSchema.$defs.artifactRef.properties.version.pattern).toBe(ARTIFACT_PATTERNS.version);
    // outcome semantics $def mirrors OUTCOME_SEMANTICS_FIELDS
    expect(sorted(Object.keys(descriptorSchema.$defs.outcomeSemantics.properties))).toEqual(
      sorted([...OUTCOME_SEMANTICS_FIELDS]),
    );
    // reproducibility $def mirrors VERIFIER_REPRODUCIBILITY_FIELDS + the closed policies
    expect(sorted(Object.keys(descriptorSchema.$defs.reproducibility.properties))).toEqual(
      sorted([...VERIFIER_REPRODUCIBILITY_FIELDS]),
    );
    expect(descriptorSchema.$defs.reproducibility.properties.policy.enum).toEqual([
      ...REPRODUCIBILITY_POLICIES,
    ]);
    expect(descriptorSchema.$defs.reproducibility.properties.seed.oneOf[1]?.pattern).toBe(SEED_PATTERN_SOURCE);
    // provenance $def mirrors VERIFIER_PROVENANCE_FIELDS
    expect(sorted(Object.keys(descriptorSchema.$defs.verifierProvenance.properties))).toEqual(
      sorted([...VERIFIER_PROVENANCE_FIELDS]),
    );
  });

  it('the record contract mirrors the TS field list, statuses and outcome vocabulary', () => {
    expect(recordSchema.additionalProperties).toBe(false);
    expect(sorted(recordSchema.required as string[])).toEqual(
      sorted([...VERIFICATION_RECORD_FIELDS, 'digest']),
    );
    expect(recordSchema.properties.verifierRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.evidence.minItems).toBe(1);
    expect(recordSchema.properties.evidenceSupport.minItems).toBe(1);
    expect(recordSchema.properties.outcome.enum).toEqual([...VERIFICATION_OUTCOMES]);
    expect(recordSchema.properties.correlationId.pattern).toBe('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
    expect(recordSchema.properties.idempotencyKey.pattern).toBe('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
    expect(recordSchema.properties.inputDigest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(recordSchema.properties.startedAt.pattern).toBe(VERIFICATION_TIMESTAMP_PATTERN_SOURCE);
    expect(recordSchema.properties.finishedAt.pattern).toBe(VERIFICATION_TIMESTAMP_PATTERN_SOURCE);
    expect(recordSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // evidence reference $def mirrors EVIDENCE_REFERENCE_FIELDS
    expect(sorted(Object.keys(recordSchema.$defs.evidenceReference.properties))).toEqual(
      sorted([...EVIDENCE_REFERENCE_FIELDS]),
    );
    expect(sorted(Object.keys(recordSchema.$defs.evidenceProvenance.properties))).toEqual(
      sorted([...EVIDENCE_PROVENANCE_FIELDS]),
    );
    // support $def mirrors REQUIREMENT_SUPPORT_FIELDS + the closed status vocabulary
    expect(sorted(Object.keys(recordSchema.$defs.requirementSupport.properties))).toEqual(
      sorted([...REQUIREMENT_SUPPORT_FIELDS]),
    );
    expect(recordSchema.$defs.requirementSupport.properties.status.enum).toEqual([
      ...EVIDENCE_SUPPORT_STATUSES,
    ]);
    // unknown cause $def mirrors UNKNOWN_CAUSE_FIELDS + the closed reason taxonomy
    expect(sorted(Object.keys(recordSchema.$defs.unknownCause.properties))).toEqual(
      sorted([...UNKNOWN_CAUSE_FIELDS]),
    );
    expect(recordSchema.$defs.unknownCause.properties.reason.enum).toEqual([...UNKNOWN_REASONS]);
    // provenance $def mirrors VERIFICATION_RECORD_PROVENANCE_FIELDS
    expect(sorted(Object.keys(recordSchema.$defs.recordProvenance.properties))).toEqual(
      sorted([...VERIFICATION_RECORD_PROVENANCE_FIELDS]),
    );
  });

  it('the outcome contract mirrors the declared-semantics object', () => {
    expect(outcomeSchema.allOf).toEqual([{ $ref: '#/$defs/outcomeSemantics' }]);
    expect(outcomeSchema.$id).toBe(
      `arena:schema/verification/verification-outcome@${VERIFICATION_SCHEMA_VERSION}`,
    );
    expect(outcomeSchema.$defs.outcomeSemantics.properties.pass.pattern).toBe(NEUTRAL_TEXT_PATTERN_SOURCE);
    expect(outcomeSchema.$defs.outcomeSemantics.required).toEqual(['pass', 'fail', 'unknown']);
  });

  it('the error contract mirrors the closed code set and categories', () => {
    expect(sorted(errorSchema.properties.code.enum as string[])).toEqual(
      sorted([...Object.values(VERIFICATION_ERROR_CODES)]),
    );
    expect(sorted(errorSchema.properties.category.enum as string[])).toEqual(
      sorted([...VERIFICATION_ERROR_CATEGORIES]),
    );
    expect(errorSchema.additionalProperties).toBe(false);
    expect(errorSchema.required).toEqual(['code', 'category', 'message']);
  });

  it('command / event contracts mirror the wire payloads', () => {
    expect(sorted(runCommandSchema.required as string[])).toEqual(sorted(['verifierRef', 'evidence']));
    expect(runCommandSchema.properties.verifierRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.properties.evidence.minItems).toBe(1);
    expect(runCommandSchema.additionalProperties).toBe(false);
    expect(sorted(Object.keys(runCommandSchema.$defs.evidenceReference.properties))).toEqual(
      sorted([...EVIDENCE_REFERENCE_FIELDS]),
    );
    expect(sorted(recordedEventSchema.required as string[])).toEqual(sorted(['record']));
    expect(recordedEventSchema.properties.record.$ref).toBe(
      `arena:schema/verification/verification-record@${VERIFICATION_SCHEMA_VERSION}`,
    );
    expect(recordedEventSchema.additionalProperties).toBe(false);
  });

  it('the schema registry enumerates exactly the TS registry', () => {
    const registered = Object.keys(VERIFICATION_SCHEMAS).map(
      (name) => verificationSchemaRef(name as keyof typeof VERIFICATION_SCHEMAS),
    );
    expect(schemaRegistrySchema.enum).toHaveLength(registered.length);
    expect(sorted(schemaRegistrySchema.enum as string[])).toEqual(
      sorted(registered.map((r) => `arena:schema/${r.namespace}/${r.name}@${r.version}`)),
    );
  });
});
