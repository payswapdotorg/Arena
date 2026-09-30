/**
 * In-package SchemaRef data (A019/A022 precedent).
 *
 * CONTRACTS DISCLOSURE: this package owns NO contracts/ surface. Its
 * data shapes live inside the package as SchemaRef-referenced data; no
 * existing contracts are redeclared and no generator is shipped, so
 * governance G9 has nothing to drift-check here.
 */

import type { SchemaRef } from '@arena/protocol-core';
import { parseSchemaRef } from '@arena/protocol-core';
import {
  STRUCTURAL_ENGINEER_BODY_ERROR_CODES,
  StructuralEngineerBodyError,
} from './shared.js';

export const STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION = '1.0.0' as const;

export const STRUCTURAL_ENGINEER_BODY_SCHEMAS = Object.freeze({
  'structural-engineer-body/tool-descriptor': STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION,
  'structural-engineer-body/practice-descriptor': STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION,
  'structural-engineer-body/capability-declaration': STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION,
  'structural-engineer-body/suite-requirement': STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION,
  'structural-engineer-body/body-manifest-input': STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION,
  'structural-engineer-body/reference-body': STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION,
  'structural-engineer-body/schema-registry': STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION,
} as const);

export type StructuralEngineerBodySchemaName = keyof typeof STRUCTURAL_ENGINEER_BODY_SCHEMAS;

const NAMES = new Set(Object.keys(STRUCTURAL_ENGINEER_BODY_SCHEMAS));

/** Build a SchemaRef for one of this package's data shapes. */
export function structuralEngineerBodySchemaRef(name: StructuralEngineerBodySchemaName): SchemaRef {
  if (!NAMES.has(name)) {
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_MANIFEST_INPUT,
      `unknown structural-engineer-body schema name: ${String(name)}`,
      { name },
    );
  }
  return parseSchemaRef(`arena:schema/${name}@${STRUCTURAL_ENGINEER_BODY_SCHEMA_VERSION}`);
}

/** Is the given SchemaRef one of this package's registered shapes? */
export function isKnownStructuralEngineerBodySchema(ref: SchemaRef): boolean {
  const key = `${ref.namespace}/${ref.name}`;
  return (
    NAMES.has(key) &&
    ref.version === STRUCTURAL_ENGINEER_BODY_SCHEMAS[key as StructuralEngineerBodySchemaName]
  );
}
