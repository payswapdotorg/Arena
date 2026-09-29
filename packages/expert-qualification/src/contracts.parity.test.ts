/**
 * Contract parity tests — bind the generated contracts
 * (contracts/expert-qualification/*.json, produced by
 * packages/expert-qualification/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/expert-qualification.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A006/A012/A013
 * convention.
 */

import { describe, expect, it } from 'vitest';
import evidenceSchemaJson from '../../../contracts/expert-qualification/qualification-evidence.v1.json' with { type: 'json' };
import claimSchemaJson from '../../../contracts/expert-qualification/competency-claim.v1.json' with { type: 'json' };
import policySchemaJson from '../../../contracts/expert-qualification/qualification-policy.v1.json' with { type: 'json' };
import recordSchemaJson from '../../../contracts/expert-qualification/qualification-record.v1.json' with { type: 'json' };
import cardSchemaJson from '../../../contracts/expert-qualification/qualified-expert.v1.json' with { type: 'json' };
import requestSchemaJson from '../../../contracts/expert-qualification/match-request.v1.json' with { type: 'json' };
import matchingPolicySchemaJson from '../../../contracts/expert-qualification/matching-policy.v1.json' with { type: 'json' };
import resultSchemaJson from '../../../contracts/expert-qualification/match-result.v1.json' with { type: 'json' };
import errorSchemaJson from '../../../contracts/expert-qualification/expert-qualification-error.v1.json' with { type: 'json' };
import qualifyCommandSchemaJson from '../../../contracts/expert-qualification/qualify-claim-command.v1.json' with { type: 'json' };
import expiryCommandSchemaJson from '../../../contracts/expert-qualification/record-qualification-expiry-command.v1.json' with { type: 'json' };
import recordedEventSchemaJson from '../../../contracts/expert-qualification/qualification-recorded-event.v1.json' with { type: 'json' };
import matchQuerySchemaJson from '../../../contracts/expert-qualification/match-experts-query.v1.json' with { type: 'json' };
import matchResponseSchemaJson from '../../../contracts/expert-qualification/match-completed-response.v1.json' with { type: 'json' };
import schemaRegistrySchemaJson from '../../../contracts/expert-qualification/expert-qualification-schema-registry.v1.json' with { type: 'json' };

import {
  AVAILABILITY_RECURRENCES,
  CAPABILITY_NODE_ID_PATTERN_SOURCE,
  COMPETENCY_NODE_KINDS,
  CONTENT_DIGEST_PATTERN_SOURCE,
  COUNTRY_CODE_PATTERN_SOURCE,
  CREDENTIAL_KINDS,
  DOMAIN_NODE_KIND,
  EXPERT_QUALIFICATION_ID_PATTERN_SOURCE,
  EXPERT_QUALIFICATION_TIMESTAMP_PATTERN_SOURCE,
  EXPERT_QUALIFICATION_VERSION_PATTERN_SOURCE,
  NEUTRAL_LOCATOR_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  PROFICIENCY_LEVELS,
  TENANT_PATTERN_SOURCE,
} from './shared.js';
import {
  EVIDENCE_CREDENTIAL_FIELDS,
  EVIDENCE_EVALUATION_FIELDS,
  EVIDENCE_VERIFICATION_FIELDS,
  EVIDENCE_WORK_PRODUCT_FIELDS,
  QUALIFICATION_EVIDENCE_KINDS,
  VERIFICATION_REF_OUTCOMES,
} from './evidence.js';
import { QUALIFICATION_EVIDENCE_FIELDS as _QUALIFICATION_EVIDENCE_FIELDS } from './evidence.js';
import { COMPETENCY_CLAIM_FIELDS } from './claim.js';
import {
  POLICY_CONFLICT_RULE_FIELDS,
  POLICY_EVIDENCE_REQUIREMENT_FIELDS,
  QUALIFICATION_POLICY_FIELDS,
} from './policy.js';
import {
  QUALIFICATION_RECORD_FIELDS,
  QUALIFICATION_STATUSES,
  REQUIREMENT_OUTCOME_FIELDS,
} from './qualification.js';
import { MATCH_REQUEST_FIELDS, MATCH_REQUIREMENT_FIELDS } from './match-request.js';
import { MATCHING_POLICY_FIELDS } from './matching-policy.js';
import { QUALIFIED_EXPERT_FIELDS } from './qualified-expert.js';
import {
  MATCH_CANDIDATE_FIELDS,
  MATCH_RESULT_FIELDS,
  PER_REQUIREMENT_ENTRY_FIELDS,
  UNMATCHED_REASONS,
} from './match-result.js';
import { EXPERT_QUALIFICATION_ERROR_CATEGORIES, EXPERT_QUALIFICATION_ERROR_CODES } from './errors.js';
import {
  EXPERT_QUALIFICATION_SCHEMAS,
  EXPERT_QUALIFICATION_SCHEMA_VERSION,
  expertQualificationSchemaRef,
} from './envelopes.js';

// ---------------------------------------------------------------------------
// Loose JSON access (the literal-typed JSON imports are re-cast to a
// structural view so property access stays explicit in this file only).
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const J = (value: unknown): Json => value as Json;
const props = (schema: Json): Record<string, Json> => J(schema['properties']) as Record<string, Json>;
const def = (schema: Json, name: string): Json => {
  const found = (J(schema['$defs']) as Record<string, Json>)[name];
  if (found === undefined) throw new Error(`missing $defs.${name}`);
  return found;
};
const pattern = (schema: Json, field: string): string => (props(schema)[field] as { pattern: string }).pattern;
const enumOf = (schema: Json, field: string): string[] => (props(schema)[field] as { enum: string[] }).enum;

const evidenceSchema = J(evidenceSchemaJson);
const claimSchema = J(claimSchemaJson);
const policySchema = J(policySchemaJson);
const recordSchema = J(recordSchemaJson);
const cardSchema = J(cardSchemaJson);
const requestSchema = J(requestSchemaJson);
const matchingPolicySchema = J(matchingPolicySchemaJson);
const resultSchema = J(resultSchemaJson);
const errorSchema = J(errorSchemaJson);
const qualifyCommandSchema = J(qualifyCommandSchemaJson);
const expiryCommandSchema = J(expiryCommandSchemaJson);
const recordedEventSchema = J(recordedEventSchemaJson);
const matchQuerySchema = J(matchQuerySchemaJson);
const matchResponseSchema = J(matchResponseSchemaJson);
const schemaRegistrySchema = J(schemaRegistrySchemaJson);

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — expert-qualification-protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      evidenceSchema,
      claimSchema,
      policySchema,
      recordSchema,
      cardSchema,
      requestSchema,
      matchingPolicySchema,
      resultSchema,
      errorSchema,
      qualifyCommandSchema,
      expiryCommandSchema,
      recordedEventSchema,
      matchQuerySchema,
      matchResponseSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(15);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(
        /^arena:schema\/expert-qualification\/[a-z0-9-]+@1\.0\.0$/,
      );
    }
  });

  it('the schema-registry contract enumerates EXACTLY the TS schema registry', () => {
    const expected = Object.keys(EXPERT_QUALIFICATION_SCHEMAS).map((key) => {
      const [namespace, name] = key.split('/');
      if (namespace === undefined || name === undefined) throw new Error('bad key');
      return `arena:schema/${namespace}/${name}@${EXPERT_QUALIFICATION_SCHEMA_VERSION}`;
    });
    expect((schemaRegistrySchema['enum'] as string[]).slice().sort()).toEqual(expected.sort());
    expect(expertQualificationSchemaRef('expert-qualification/qualification-record')).toEqual({
      namespace: 'expert-qualification',
      name: 'qualification-record',
      version: EXPERT_QUALIFICATION_SCHEMA_VERSION,
    });
  });

  it('the evidence contract mirrors the oneOf kinds, payload fields and patterns', () => {
    const oneOf = evidenceSchema['oneOf'] as Json[];
    expect(oneOf).toHaveLength(4);
    const kinds = oneOf.map((variant) => (props(variant)['kind'] as { const: string }).const);
    expect(kinds.sort()).toEqual([...QUALIFICATION_EVIDENCE_KINDS].sort());
    for (const variant of oneOf) {
      const properties = props(variant);
      const kind = (properties['kind'] as { const: string }).const;
      const required = variant['required'] as string[];
      expect(J(properties['recordVersion'])['const']).toBe(1);
      expect((properties['observedAt'] as { pattern: string }).pattern).toBe(
        EXPERT_QUALIFICATION_TIMESTAMP_PATTERN_SOURCE,
      );
      expect((properties['supersedes'] as { pattern: string }).pattern).toBe(
        CONTENT_DIGEST_PATTERN_SOURCE,
      );
      expect((properties['digest'] as { pattern: string }).pattern).toBe(
        CONTENT_DIGEST_PATTERN_SOURCE,
      );
      const expectedPayload =
        kind === 'credential-ref'
          ? ['credential']
          : kind === 'work-product-ref'
            ? ['workProduct']
            : kind === 'verification-ref'
              ? ['verification']
              : ['evaluation'];
      expect(required).toEqual(
        expect.arrayContaining([
          ...expectedPayload,
          'recordVersion',
          'kind',
          'observedAt',
          'digest',
        ]),
      );
      const allowed = Object.keys(properties);
      const common = ['recordVersion', 'kind', 'observedAt', 'supersedes', 'note'];
      expect(sorted(allowed)).toEqual(sorted([...common, ...expectedPayload, 'digest']));
      // every TS field is covered by the common shape, some variant's
      // payload or the digest
      const unionOfVariantFields = new Set<string>([
        ...common,
        ..._QUALIFICATION_EVIDENCE_FIELDS,
      ]);
      for (const field of allowed) {
        expect([...unionOfVariantFields]).toContain(field);
      }
    }
  });

  it('the credential-ref $def and payload variants mirror the A006 vocabulary', () => {
    const credential = def(evidenceSchema, 'credentialRef');
    expect(sorted(Object.keys(props(credential)))).toEqual(sorted([...EVIDENCE_CREDENTIAL_FIELDS]));
    expect(enumOf(credential, 'kind')).toEqual([...CREDENTIAL_KINDS]);
    expect((props(credential)['reference'] as { pattern: string }).pattern).toBe(
      NEUTRAL_LOCATOR_PATTERN_SOURCE,
    );
    // work-product payload fields
    const workProductVariant = (evidenceSchema['oneOf'] as Json[]).find(
      (v) => (props(v)['kind'] as { const: string }).const === 'work-product-ref',
    );
    const workProduct = props(workProductVariant as Json)['workProduct'] as Json;
    expect(sorted(Object.keys(props(workProduct)))).toEqual(
      sorted([...EVIDENCE_WORK_PRODUCT_FIELDS]),
    );
    // verification payload fields
    const verificationVariant = (evidenceSchema['oneOf'] as Json[]).find(
      (v) => (props(v)['kind'] as { const: string }).const === 'verification-ref',
    );
    const verification = props(verificationVariant as Json)['verification'] as Json;
    expect(sorted(Object.keys(props(verification)))).toEqual(
      sorted([...EVIDENCE_VERIFICATION_FIELDS]),
    );
    expect(enumOf(verification, 'outcome')).toEqual([...VERIFICATION_REF_OUTCOMES]);
    // evaluation payload fields
    const evaluationVariant = (evidenceSchema['oneOf'] as Json[]).find(
      (v) => (props(v)['kind'] as { const: string }).const === 'evaluation-ref',
    );
    const evaluation = props(evaluationVariant as Json)['evaluation'] as Json;
    expect(sorted(Object.keys(props(evaluation)))).toEqual(
      sorted([...EVIDENCE_EVALUATION_FIELDS]),
    );
  });

  it('the claim contract mirrors the TS field list, capability endpoint kinds and proficiency', () => {
    expect(claimSchema['additionalProperties']).toBe(false);
    expect(sorted(claimSchema['required'] as string[])).toEqual(
      sorted([...COMPETENCY_CLAIM_FIELDS.filter((f) => f !== 'supersedes' && f !== 'digest'), 'digest']),
    );
    expect(J(props(claimSchema)['claimVersion'])['const']).toBe(1);
    expect(pattern(claimSchema, 'expertId')).toBe(NEUTRAL_LOCATOR_PATTERN_SOURCE);
    expect(pattern(claimSchema, 'tenant')).toBe(TENANT_PATTERN_SOURCE);
    expect((props(claimSchema)['capability'] as { $ref: string }).$ref).toBe('#/$defs/capabilityRef');
    expect(enumOf(claimSchema, 'proficiency')).toEqual([...PROFICIENCY_LEVELS]);
    expect(J(props(claimSchema)['evidence'])['minItems']).toBe(1);
    expect(pattern(claimSchema, 'declaredAt')).toBe(EXPERT_QUALIFICATION_TIMESTAMP_PATTERN_SOURCE);
    expect(pattern(claimSchema, 'digest')).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    const capability = def(claimSchema, 'capabilityRef');
    expect(enumOf(capability, 'kind').sort()).toEqual(
      [...COMPETENCY_NODE_KINDS, DOMAIN_NODE_KIND].sort(),
    );
    expect(pattern(capability, 'id')).toBe(CAPABILITY_NODE_ID_PATTERN_SOURCE);
  });

  it('the policy contract mirrors the TS field list, requirements and conflict rules', () => {
    expect(policySchema['additionalProperties']).toBe(false);
    expect(sorted(policySchema['required'] as string[])).toEqual(
      sorted([...QUALIFICATION_POLICY_FIELDS.filter((f) => f !== 'digest'), 'digest']),
    );
    expect(pattern(policySchema, 'policyId')).toBe(EXPERT_QUALIFICATION_ID_PATTERN_SOURCE);
    expect(pattern(policySchema, 'version')).toBe(EXPERT_QUALIFICATION_VERSION_PATTERN_SOURCE);
    expect(J(props(policySchema)['requirements'])['minItems']).toBe(1);
    const requirement = def(policySchema, 'policyRequirement');
    expect(sorted(Object.keys(props(requirement)))).toEqual(
      sorted([...POLICY_EVIDENCE_REQUIREMENT_FIELDS]),
    );
    expect(enumOf(requirement, 'evidenceKind')).toEqual([...QUALIFICATION_EVIDENCE_KINDS]);
    expect(J(props(requirement)['minimumCount'])['minimum']).toBe(1);
    expect(J(props(policySchema)['freshnessWindowDays'])['minimum']).toBe(1);
    expect(J(props(policySchema)['validityWindowDays'])['minimum']).toBe(1);
    const conflictRule = def(policySchema, 'conflictRule');
    expect(sorted(Object.keys(props(conflictRule)))).toEqual(
      sorted([...POLICY_CONFLICT_RULE_FIELDS]),
    );
    const outcomeOneOf = (props(conflictRule)['outcome'] as { oneOf: Json[] }).oneOf;
    expect((outcomeOneOf[1] as { enum: string[] }).enum).toEqual([...VERIFICATION_REF_OUTCOMES]);
  });

  it('the record contract mirrors the TS field list, statuses and outcome fields', () => {
    expect(recordSchema['additionalProperties']).toBe(false);
    expect(sorted(recordSchema['required'] as string[])).toEqual(
      sorted([
        ...QUALIFICATION_RECORD_FIELDS.filter(
          (f) =>
            f !== 'validFrom' && f !== 'validUntil' && f !== 'supersedes' && f !== 'note' && f !== 'digest',
        ),
        'digest',
      ]),
    );
    expect(J(props(recordSchema)['recordVersion'])['const']).toBe(1);
    expect(pattern(recordSchema, 'claimDigest')).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(enumOf(recordSchema, 'status')).toEqual([...QUALIFICATION_STATUSES]);
    expect(pattern(recordSchema, 'evaluatedAt')).toBe(EXPERT_QUALIFICATION_TIMESTAMP_PATTERN_SOURCE);
    const outcome = def(recordSchema, 'requirementOutcome');
    expect(sorted(Object.keys(props(outcome)))).toEqual(sorted([...REQUIREMENT_OUTCOME_FIELDS]));
    const reasonOneOf = (props(outcome)['reason'] as { oneOf: Json[] }).oneOf;
    expect((reasonOneOf[1] as { pattern: string }).pattern).toBe(NEUTRAL_TEXT_PATTERN_SOURCE);
  });

  it('the expert-card contract mirrors the TS field list, jurisdictions and availability', () => {
    expect(cardSchema['additionalProperties']).toBe(false);
    expect(sorted(cardSchema['required'] as string[])).toEqual(
      sorted([...QUALIFIED_EXPERT_FIELDS.filter((f) => f !== 'digest'), 'digest']),
    );
    expect(pattern(cardSchema, 'expertId')).toBe(NEUTRAL_LOCATOR_PATTERN_SOURCE);
    const jurisdiction = def(cardSchema, 'jurisdiction');
    expect(sorted(Object.keys(props(jurisdiction)))).toEqual([
      'country',
      'jurisdictionVersion',
      'region',
    ]);
    expect(pattern(jurisdiction, 'country')).toBe(COUNTRY_CODE_PATTERN_SOURCE);
    const availability = def(cardSchema, 'availabilityWindow');
    expect(enumOf(availability, 'recurrence')).toEqual([...AVAILABILITY_RECURRENCES]);
    expect(J(props(availability)['windowVersion'])['const']).toBe(1);
  });

  it('the match-request contract mirrors the TS field list and requirement fields', () => {
    expect(requestSchema['additionalProperties']).toBe(false);
    expect(sorted(requestSchema['required'] as string[])).toEqual(
      sorted([
        ...MATCH_REQUEST_FIELDS.filter(
          (f) =>
            f !== 'domainRef' && f !== 'jurisdictions' && f !== 'availabilityWindow' && f !== 'digest',
        ),
        'digest',
      ]),
    );
    const requirement = J(props(requestSchema)['requirements'])['items'] as Json;
    expect(sorted(Object.keys(props(requirement)))).toEqual(sorted([...MATCH_REQUIREMENT_FIELDS]));
    expect(J(props(requestSchema)['requirements'])['minItems']).toBe(1);
    expect(enumOf(requirement, 'minimumProficiency')).toEqual([...PROFICIENCY_LEVELS]);
    expect(J(props(requestSchema)['jurisdictions'])['minItems']).toBe(1);
    const window = props(requestSchema)['availabilityWindow'] as Json;
    expect((props(window)['from'] as { pattern: string }).pattern).toBe(
      EXPERT_QUALIFICATION_TIMESTAMP_PATTERN_SOURCE,
    );
  });

  it('the matching-policy contract mirrors the TS field list', () => {
    expect(matchingPolicySchema['additionalProperties']).toBe(false);
    expect(sorted(matchingPolicySchema['required'] as string[])).toEqual(
      sorted([...MATCHING_POLICY_FIELDS.filter((f) => f !== 'digest'), 'digest']),
    );
    expect(J(props(matchingPolicySchema)['maxCandidates'])['minimum']).toBe(1);
    expect(J(props(matchingPolicySchema)['includePartialMatches'])['type']).toBe('boolean');
    expect(J(props(matchingPolicySchema)['availabilityRequired'])['type']).toBe('boolean');
  });

  it('the match-result contract mirrors the TS field lists and closed vocabularies', () => {
    expect(resultSchema['additionalProperties']).toBe(false);
    expect(sorted(resultSchema['required'] as string[])).toEqual(
      sorted([...MATCH_RESULT_FIELDS.filter((f) => f !== 'digest'), 'digest']),
    );
    const candidate = def(resultSchema, 'matchCandidate');
    expect(sorted(Object.keys(props(candidate)))).toEqual(sorted([...MATCH_CANDIDATE_FIELDS]));
    expect(J(props(candidate)['perRequirement'])['minItems']).toBe(1);
    const satisfied = def(resultSchema, 'satisfiedEntry');
    const unsatisfied = def(resultSchema, 'unsatisfiedEntry');
    const entryFields = PER_REQUIREMENT_ENTRY_FIELDS as readonly string[];
    const satisfiedExpected = entryFields.filter((f) => f !== 'unmatchedReason');
    const unsatisfiedExpected = entryFields.filter(
      (f) => f !== 'matchedProficiency' && f !== 'claimDigest' && f !== 'recordDigest',
    );
    expect(sorted(Object.keys(props(satisfied)))).toEqual(sorted(satisfiedExpected));
    expect(sorted(Object.keys(props(unsatisfied)))).toEqual(sorted(unsatisfiedExpected));
    expect(J(props(satisfied)['satisfied'])['const']).toBe(true);
    expect(J(props(unsatisfied)['satisfied'])['const']).toBe(false);
    expect(enumOf(unsatisfied, 'unmatchedReason')).toEqual([...UNMATCHED_REASONS]);
    expect(enumOf(satisfied, 'matchedProficiency')).toEqual([...PROFICIENCY_LEVELS]);
  });

  it('the error contract mirrors the closed error codes and categories', () => {
    expect(errorSchema['additionalProperties']).toBe(false);
    expect(sorted(errorSchema['required'] as string[])).toEqual(['category', 'code', 'message']);
    expect(enumOf(errorSchema, 'code').sort()).toEqual(
      Object.values(EXPERT_QUALIFICATION_ERROR_CODES).slice().sort(),
    );
    expect(enumOf(errorSchema, 'category').sort()).toEqual(
      [...EXPERT_QUALIFICATION_ERROR_CATEGORIES].sort(),
    );
    expect(pattern(errorSchema, 'correlationId')).toBe(
      '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
    );
  });

  it('the command/event/query/response payload contracts mirror their TS shapes', () => {
    expect(qualifyCommandSchema['additionalProperties']).toBe(false);
    expect(sorted(qualifyCommandSchema['required'] as string[])).toEqual([
      'claimRef',
      'evaluatedAt',
      'policyRef',
      'renew',
    ]);
    expect(pattern(qualifyCommandSchema, 'claimRef')).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(expiryCommandSchema['additionalProperties']).toBe(false);
    expect(sorted(expiryCommandSchema['required'] as string[])).toEqual([
      'claimRef',
      'evaluatedAt',
    ]);
    expect(recordedEventSchema['additionalProperties']).toBe(false);
    expect((props(recordedEventSchema)['record'] as { $ref: string }).$ref).toBe(
      'arena:schema/expert-qualification/qualification-record@1.0.0',
    );
    expect((props(matchQuerySchema)['request'] as { $ref: string }).$ref).toBe(
      'arena:schema/expert-qualification/match-request@1.0.0',
    );
    expect((props(matchQuerySchema)['policy'] as { $ref: string }).$ref).toBe(
      'arena:schema/expert-qualification/matching-policy@1.0.0',
    );
    expect((props(matchResponseSchema)['result'] as { $ref: string }).$ref).toBe(
      'arena:schema/expert-qualification/match-result@1.0.0',
    );
  });
});
