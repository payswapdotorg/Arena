/**
 * Dataset schema registry (Work Order A014) — the SchemaRef surface of
 * @arena/datasets. Every schema this package owns is registered here with
 * its exact version; the generated contract
 * contracts/dataset/dataset-schema-registry.v1.json enumerates the same set
 * (parity asserted by src/contracts.parity.test.ts; drift by
 * src/drift.test.ts and the governance G9 check).
 */

import type { SchemaRef } from '@arena/protocol-core';

export const DATASET_SCHEMA_VERSION = '1.0.0' as const;

/** Schema names owned by @arena/datasets (mirrored by the generated registry contract). */
export const DATASET_SCHEMAS = Object.freeze({
  'dataset/dataset-manifest': DATASET_SCHEMA_VERSION,
  'dataset/dataset-bundle': DATASET_SCHEMA_VERSION,
  'dataset/dataset-entry-role': DATASET_SCHEMA_VERSION,
  'dataset/lineage-edge': DATASET_SCHEMA_VERSION,
  'dataset/publication-ops': DATASET_SCHEMA_VERSION,
  'dataset/schema-registry': DATASET_SCHEMA_VERSION,
} as const);

export type DatasetSchemaName = keyof typeof DATASET_SCHEMAS;

/** Resolve a dataset schema name to its SchemaRef. */
export function datasetSchemaRef(name: DatasetSchemaName): SchemaRef {
  const version = DATASET_SCHEMAS[name];
  if (version === undefined) {
    throw new Error(`unknown dataset schema: ${String(name)}`);
  }
  return {
    namespace: 'dataset',
    name: name.split('/')[1] as string,
    version,
  };
}

/** True iff the ref names a dataset schema AND carries the registered version. */
export function isKnownDatasetSchema(ref: SchemaRef): boolean {
  const registered = (DATASET_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}
