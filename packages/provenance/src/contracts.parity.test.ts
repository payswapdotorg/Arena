/**
 * Contract parity tests — bind the generated provenance contracts
 * (contracts/artifacts/*.json, produced by
 * packages/artifact-protocol/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/provenance.
 */

import { describe, expect, it } from 'vitest';
import lineageEdgeSchema from '../../../contracts/artifacts/lineage-edge.v1.json' with { type: 'json' };
import provenanceErrorSchema from '../../../contracts/artifacts/provenance-error.v1.json' with { type: 'json' };
import provenanceRecordSchema from '../../../contracts/artifacts/provenance-record.v1.json' with { type: 'json' };
import recordedEventSchema from '../../../contracts/artifacts/provenance-recorded-event.v1.json' with { type: 'json' };
import recordCommandSchema from '../../../contracts/artifacts/record-provenance-command.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/artifacts/provenance-schema-registry.v1.json' with { type: 'json' };
import transformationSchema from '../../../contracts/artifacts/transformation-lineage.v1.json' with { type: 'json' };
import verificationRefSchema from '../../../contracts/artifacts/verification-ref.v1.json' with { type: 'json' };
import {
  PROVENANCE_ERROR_CATEGORIES,
  PROVENANCE_ERROR_CODES,
} from './errors.js';
import {
  LINEAGE_RELATIONS,
  PROVENANCE_RECORD_VERSION,
  VERIFICATION_KINDS,
} from './record.js';
import {
  ARTIFACT_NAME_PATTERN_SOURCE,
  ARTIFACT_NAMESPACE_PATTERN_SOURCE,
  ARTIFACT_VERSION_PATTERN_SOURCE,
  CONTENT_DIGEST_PATTERN_SOURCE,
  PROVENANCE_TIMESTAMP_PATTERN_SOURCE,
} from './shared.js';
import { PROVENANCE_SCHEMAS, provenanceSchemaRef } from './envelopes.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — provenance (positive)', () => {
  it('lineage edge schema mirrors the relation enum and ref patterns', () => {
    expect(sorted(lineageEdgeSchema.properties.relation.enum as string[])).toEqual(
      sorted([...LINEAGE_RELATIONS]),
    );
    expect(lineageEdgeSchema.$defs.artifactRef.properties.namespace.pattern).toBe(
      ARTIFACT_NAMESPACE_PATTERN_SOURCE,
    );
    expect(lineageEdgeSchema.$defs.artifactRef.properties.name.pattern).toBe(
      ARTIFACT_NAME_PATTERN_SOURCE,
    );
    expect(lineageEdgeSchema.$defs.artifactRef.properties.version.pattern).toBe(
      ARTIFACT_VERSION_PATTERN_SOURCE,
    );
    expect(lineageEdgeSchema.$defs.artifactRef.properties.digest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    expect(sorted(lineageEdgeSchema.required as string[])).toEqual(
      sorted(['parent', 'relation']),
    );
  });

  it('transformation lineage schema mirrors transform + inputs', () => {
    expect(sorted(transformationSchema.required as string[])).toEqual(
      sorted(['transform', 'inputs']),
    );
    expect(transformationSchema.properties.transform.$ref).toBe('#/$defs/artifactRef');
    expect(transformationSchema.properties.inputs.type).toBe('array');
  });

  it('verification ref schema mirrors the verification kinds', () => {
    expect(sorted(verificationRefSchema.properties.kind.enum as string[])).toEqual(
      sorted([...VERIFICATION_KINDS]),
    );
    expect(sorted(verificationRefSchema.required as string[])).toEqual(
      sorted(['kind', 'evidence']),
    );
  });

  it('provenance record schema mirrors the §15 record shape', () => {
    expect(sorted(provenanceRecordSchema.required as string[])).toEqual(
      sorted([
        'recordVersion',
        'artifact',
        'creator',
        'createdAt',
        'recordedAt',
        'parents',
        'transformation',
        'rights',
        'verification',
      ]),
    );
    expect(provenanceRecordSchema.properties.recordVersion.const).toBe(
      PROVENANCE_RECORD_VERSION,
    );
    expect(provenanceRecordSchema.properties.createdAt.pattern).toBe(
      PROVENANCE_TIMESTAMP_PATTERN_SOURCE,
    );
    expect(provenanceRecordSchema.properties.recordedAt.pattern).toBe(
      PROVENANCE_TIMESTAMP_PATTERN_SOURCE,
    );
    expect(provenanceRecordSchema.additionalProperties).toBe(false);
    expect(provenanceRecordSchema.$defs.principal.properties.type.enum).toEqual([
      'agent-body',
      'expert',
      'user',
      'service',
      'system',
    ]);
  });

  it('provenance error schema enumerates exactly the TS taxonomy', () => {
    expect(sorted(provenanceErrorSchema.properties.code.enum as string[])).toEqual(
      sorted(Object.values(PROVENANCE_ERROR_CODES)),
    );
    expect(sorted(provenanceErrorSchema.properties.category.enum as string[])).toEqual(
      sorted([...PROVENANCE_ERROR_CATEGORIES]),
    );
  });

  it('command and event payload schemas require the record', () => {
    expect(recordCommandSchema.required).toEqual(['record']);
    expect(recordCommandSchema.properties.record.$ref).toBe('provenance-record.v1.json');
    expect(recordedEventSchema.required).toEqual(['record']);
    expect(recordedEventSchema.properties.record.$ref).toBe('provenance-record.v1.json');
  });

  it('schema registry enumerates exactly the provenance schemas', () => {
    const expected = sorted(
      Object.entries(PROVENANCE_SCHEMAS).map(
        ([name, version]) => `arena:schema/${name}@${version}`,
      ),
    );
    expect(sorted(registrySchema.enum as string[])).toEqual(expected);
  });

  it('contract $ids are the formatted provenance schema refs', () => {
    for (const name of Object.keys(PROVENANCE_SCHEMAS)) {
      const ref = provenanceSchemaRef(name as keyof typeof PROVENANCE_SCHEMAS);
      expect(`arena:schema/${name}@${ref.version}`).toMatch(
        /^arena:schema\/provenance\/[a-z-]+@\d+\.\d+\.\d+$/,
      );
    }
    expect(provenanceRecordSchema.$id).toBe('arena:schema/provenance/provenance-record@1.0.0');
    expect(registrySchema.$id).toBe('arena:schema/provenance/schema-registry@1.0.0');
  });

  it('contracts target JSON Schema draft 2020-12', () => {
    for (const schema of [
      lineageEdgeSchema,
      provenanceErrorSchema,
      provenanceRecordSchema,
      recordedEventSchema,
      recordCommandSchema,
      registrySchema,
      transformationSchema,
      verificationRefSchema,
    ]) {
      expect(schema.$schema).toBe(DRAFT);
    }
  });
});

describe('generated contract parity — provenance (negative)', () => {
  it('a hypothetical extra relation would not match the contract enum', () => {
    const hypothetical = sorted([...LINEAGE_RELATIONS, 'depends-on']);
    expect(hypothetical).not.toEqual(
      sorted(lineageEdgeSchema.properties.relation.enum as string[]),
    );
  });

  it('a hypothetical extra verification kind would not match the contract enum', () => {
    const hypothetical = sorted([...VERIFICATION_KINDS, 'benchmark']);
    expect(hypothetical).not.toEqual(
      sorted(verificationRefSchema.properties.kind.enum as string[]),
    );
  });

  it('a hypothetical extra error code would not match the contract enum', () => {
    const hypothetical = sorted([
      ...Object.values(PROVENANCE_ERROR_CODES),
      'PROVENANCE_MADE_UP',
    ]);
    expect(hypothetical).not.toEqual(
      sorted(provenanceErrorSchema.properties.code.enum as string[]),
    );
  });

  it('artifact-protocol schemas are not provenance-registry members', () => {
    const registry = registrySchema.enum as string[];
    expect(registry).not.toContain('arena:schema/artifacts/publication@1.0.0');
  });
});
