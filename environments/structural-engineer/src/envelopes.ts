/**
 * In-package SchemaRef data (A019/A022 precedent).
 *
 * CONTRACTS DISCLOSURE: this package owns NO contracts/ surface. Its
 * data shapes live inside the package as SchemaRef-referenced data; no
 * existing contracts are redeclared (the ENV1.0 environment contracts
 * remain owned by @arena/environment-protocol) and no generator is
 * shipped, so governance G9 has nothing to drift-check here.
 */

import type { SchemaRef } from '@arena/protocol-core';
import { parseSchemaRef } from '@arena/protocol-core';
import { STRUCTURAL_ENGINEER_ENV_ERROR_CODES } from './shared.js';

export class StructuralEngineerEnvironmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StructuralEngineerEnvironmentError';
    this.code = code;
  }
}

export const STRUCTURAL_ENGINEER_ENV_SCHEMA_VERSION = '1.0.0' as const;

export const STRUCTURAL_ENGINEER_ENV_SCHEMAS = Object.freeze({
  'structural-engineer-env/sandbox-definition': STRUCTURAL_ENGINEER_ENV_SCHEMA_VERSION,
  'structural-engineer-env/hermetic-definition': STRUCTURAL_ENGINEER_ENV_SCHEMA_VERSION,
  'structural-engineer-env/run-declaration': STRUCTURAL_ENGINEER_ENV_SCHEMA_VERSION,
  'structural-engineer-env/lifecycle-sequence': STRUCTURAL_ENGINEER_ENV_SCHEMA_VERSION,
  'structural-engineer-env/schema-registry': STRUCTURAL_ENGINEER_ENV_SCHEMA_VERSION,
} as const);

export type StructuralEngineerEnvironmentSchemaName = keyof typeof STRUCTURAL_ENGINEER_ENV_SCHEMAS;

const NAMES = new Set(Object.keys(STRUCTURAL_ENGINEER_ENV_SCHEMAS));

/** Build a SchemaRef for one of this package's data shapes. */
export function structuralEngineerEnvironmentSchemaRef(
  name: StructuralEngineerEnvironmentSchemaName,
): SchemaRef {
  if (!NAMES.has(name)) {
    throw new StructuralEngineerEnvironmentError(
      STRUCTURAL_ENGINEER_ENV_ERROR_CODES.INVALID_DECLARATION,
      `unknown structural-engineer-env schema name: ${String(name)}`,
    );
  }
  return parseSchemaRef(`arena:schema/${name}@${STRUCTURAL_ENGINEER_ENV_SCHEMA_VERSION}`);
}

/** Is the given SchemaRef one of this package's registered shapes? */
export function isKnownStructuralEngineerEnvironmentSchema(ref: SchemaRef): boolean {
  const key = `${ref.namespace}/${ref.name}`;
  return (
    NAMES.has(key) &&
    ref.version === STRUCTURAL_ENGINEER_ENV_SCHEMAS[key as StructuralEngineerEnvironmentSchemaName]
  );
}
