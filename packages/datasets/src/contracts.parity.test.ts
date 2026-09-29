/**
 * Contract parity tests (Work Order A014) — bind the generated contracts
 * (contracts/dataset/*.json, produced by
 * packages/datasets/scripts/generate-contracts.mjs) to the TypeScript
 * surface of @arena/datasets (and, where the contract reuses A002
 * vocabularies, to the owning packages' constants).
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A009/A011/A012/A013
 * convention.
 */

import { describe, expect, it } from 'vitest';
import manifestSchema from '../../../contracts/dataset/dataset-manifest.v1.json' with { type: 'json' };
import bundleSchema from '../../../contracts/dataset/dataset-bundle.v1.json' with { type: 'json' };
import entryRoleSchema from '../../../contracts/dataset/dataset-entry-role.v1.json' with { type: 'json' };
import lineageEdgeSchema from '../../../contracts/dataset/lineage-edge.v1.json' with { type: 'json' };
import publicationOpsSchema from '../../../contracts/dataset/publication-ops.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/dataset/dataset-schema-registry.v1.json' with { type: 'json' };

import { LINEAGE_RELATIONS, VERIFICATION_KINDS } from '@arena/provenance';
import {
  COMMERCIAL_USE_POLICIES,
  PRINCIPAL_TYPES,
  PUBLICATION_ACTIONS,
  REDISTRIBUTION_POLICIES,
  CUSTOMER_DATA_POLICIES,
} from '@arena/artifact-protocol';
import { DATASET_ENTRY_ROLES, DATASET_ENTRY_FIELDS } from './entry.js';
import {
  DATASET_MANIFEST_FIELDS,
  DATASET_MANIFEST_VERSION,
  DATASET_PROVENANCE_FIELDS,
  DATASET_LINEAGE_EDGE_FIELDS,
  DATASET_VERIFICATION_REF_FIELDS,
} from './manifest.js';
import { DATASET_BUNDLE_FIELDS, DATASET_BUNDLE_VERSION } from './bundle.js';
import { DATASET_VERSION_FIELDS } from './versioning.js';
import { DATASET_ERROR_CODES, DATASET_ERROR_CATEGORIES } from './errors.js';
import { DATASET_SCHEMAS, DATASET_SCHEMA_VERSION } from './schemas.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function objectKeysOf(schema: {
  properties?: Record<string, unknown>;
  required?: string[];
}): string[] {
  const props = Object.keys(schema.properties ?? {});
  const required = schema.required ?? [];
  expect(sorted(props)).toEqual(sorted(required)); // additionalProperties: false ⇒ required = properties
  return sorted(props);
}

describe('generated contract parity — datasets', () => {
  it('every contract is draft 2020-12 with a versioned dataset SchemaRef $id', () => {
    for (const schema of [
      manifestSchema,
      bundleSchema,
      entryRoleSchema,
      lineageEdgeSchema,
      publicationOpsSchema,
      schemaRegistrySchema,
    ]) {
      expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(String(schema['$id'])).toMatch(
        /^arena:schema\/dataset\/[a-z0-9-]+@1\.0\.0$/,
      );
    }
  });

  it('the manifest contract mirrors the TS field list, roles and vocabularies', () => {
    expect(manifestSchema['type']).toBe('object');
    expect(manifestSchema['additionalProperties']).toBe(false);
    expect(objectKeysOf(manifestSchema)).toEqual(sorted(DATASET_MANIFEST_FIELDS));
    expect(manifestSchema['properties']['manifestVersion']['const']).toBe(
      DATASET_MANIFEST_VERSION,
    );

    const defs = manifestSchema['$defs'] as Record<
      string,
      { properties: Record<string, { enum?: string[]; type?: string }> }
    >;
    // entries: role enum mirrors the closed TS vocabulary
    expect(defs['datasetEntry']?.['properties']['role']?.['enum']).toEqual([
      ...DATASET_ENTRY_ROLES,
    ]);
    expect(sorted(Object.keys(defs['datasetEntry']?.['properties'] ?? {}))).toEqual(
      sorted(DATASET_ENTRY_FIELDS),
    );
    // provenance fields
    const provenanceProps = manifestSchema['properties']['provenance'] as {
      required: string[];
    };
    expect(sorted(provenanceProps['required'])).toEqual(sorted(DATASET_PROVENANCE_FIELDS));
    // lineage edge relation vocabulary is the REUSED A002 provenance set
    expect(defs['lineageEdge']?.['properties']['relation']?.['enum']).toEqual([
      ...LINEAGE_RELATIONS,
    ]);
    expect(sorted(Object.keys(defs['lineageEdge']?.['properties'] ?? {}))).toEqual(
      sorted(DATASET_LINEAGE_EDGE_FIELDS),
    );
    // verification kinds are the REUSED A002 provenance set
    expect(defs['verificationRef']?.['properties']['kind']?.['enum']).toEqual([
      ...VERIFICATION_KINDS,
    ]);
    expect(sorted(Object.keys(defs['verificationRef']?.['properties'] ?? {}))).toEqual(
      sorted(DATASET_VERIFICATION_REF_FIELDS),
    );
    // rights policies are the REUSED A002 set
    expect(defs['rightsMetadata']?.['properties']['commercialUse']?.['enum']).toEqual([
      ...COMMERCIAL_USE_POLICIES,
    ]);
    expect(defs['rightsMetadata']?.['properties']['redistribution']?.['enum']).toEqual([
      ...REDISTRIBUTION_POLICIES,
    ]);
    expect(defs['rightsMetadata']?.['properties']['customerData']?.['enum']).toEqual([
      ...CUSTOMER_DATA_POLICIES,
    ]);
    // principal types are the REUSED A002 set
    expect(defs['principalRef']?.['properties']['type']?.['enum']).toEqual([
      ...PRINCIPAL_TYPES,
    ]);
  });

  it('the bundle contract mirrors the TS field list and version', () => {
    expect(bundleSchema['type']).toBe('object');
    expect(bundleSchema['additionalProperties']).toBe(false);
    expect(objectKeysOf(bundleSchema)).toEqual(sorted(DATASET_BUNDLE_FIELDS));
    expect(bundleSchema['properties']['bundleVersion']['const']).toBe(DATASET_BUNDLE_VERSION);
    expect(bundleSchema['properties']['manifest']['$ref']).toBe(
      `arena:schema/dataset/dataset-manifest@${DATASET_SCHEMA_VERSION}`,
    );
    expect(String(bundleSchema['properties']['bundleDigest']['pattern'])).toBe(
      '^[0-9a-f]{64}$',
    );
  });

  it('the entry-role contract enumerates exactly the TS vocabulary', () => {
    expect(entryRoleSchema['type']).toBe('string');
    expect(entryRoleSchema['enum']).toEqual([...DATASET_ENTRY_ROLES]);
    expect(String(entryRoleSchema['$id'])).toBe(
      `arena:schema/dataset/dataset-entry-role@${DATASET_SCHEMA_VERSION}`,
    );
  });

  it('the lineage-edge contract mirrors the reused relation vocabulary', () => {
    expect(lineageEdgeSchema['type']).toBe('object');
    expect(lineageEdgeSchema['additionalProperties']).toBe(false);
    const defs = lineageEdgeSchema['$defs'] as Record<string, unknown>;
    expect(defs['artifactRef']).toBeDefined();
    expect(lineageEdgeSchema['properties']['relation']['enum']).toEqual([
      ...LINEAGE_RELATIONS,
    ]);
    expect(sorted(Object.keys(lineageEdgeSchema['properties']))).toEqual(
      sorted(DATASET_LINEAGE_EDGE_FIELDS),
    );
  });

  it('the publication-ops contract mirrors the A002 publication action set', () => {
    expect(publicationOpsSchema['type']).toBe('object');
    const oneOf = publicationOpsSchema['oneOf'] as {
      properties: Record<string, { const?: string }>;
    }[];
    expect(oneOf).toHaveLength(2);
    const opConsts = oneOf.map((variant) => variant['properties']['op']?.['const']);
    expect(sorted(opConsts as string[])).toEqual(sorted([...PUBLICATION_ACTIONS]));
    const defs = publicationOpsSchema['$defs'] as Record<string, unknown>;
    expect(defs['artifactRef']).toBeDefined();
    expect(defs['principalRef']).toBeDefined();
    expect(defs['rightsMetadata']).toBeDefined();
    // Every variant is fully closed (additionalProperties: false).
    for (const variant of oneOf) {
      expect(variant['additionalProperties']).toBe(false);
    }
  });

  it('the schema registry enumerates exactly the TS registry', () => {
    expect(schemaRegistrySchema['type']).toBe('string');
    const expected = Object.entries(DATASET_SCHEMAS).map(
      ([name, version]) =>
        `arena:schema/dataset/${name.split('/')[1]}@${version}`,
    );
    expect(sorted(schemaRegistrySchema['enum'] as string[])).toEqual(sorted(expected));
    expect(DATASET_SCHEMA_VERSION).toBe('1.0.0');
    expect(Object.keys(DATASET_SCHEMAS)).toHaveLength(6);
  });

  it('the TS version-pin fields are a documented A014 surface', () => {
    // The pin shape is carried inside versioning.ts (not a standalone
    // contract file); its field list stays parity-checked here.
    expect(sorted(DATASET_VERSION_FIELDS)).toEqual(['identity', 'manifestDigest']);
  });

  it('the TS error taxonomy stays closed and category-mapped', () => {
    // The error taxonomy follows the house protocol-error contract shape;
    // the codes and categories are the parity surface (no dedicated
    // contract file mirrors them — same as A002's ARTIFACT_* set).
    expect(Object.values(DATASET_ERROR_CODES)).toHaveLength(9);
    expect([...DATASET_ERROR_CATEGORIES]).toEqual([
      'validation',
      'encoding',
      'versioning',
      'integrity',
      'unknown',
    ]);
  });
});
