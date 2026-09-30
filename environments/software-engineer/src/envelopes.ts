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
import { SOFTWARE_ENGINEER_ENV_ERROR_CODES } from './shared.js';

export class SoftwareEngineerEnvironmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SoftwareEngineerEnvironmentError';
    this.code = code;
  }
}

export const SOFTWARE_ENGINEER_ENV_SCHEMA_VERSION = '1.0.0' as const;

export const SOFTWARE_ENGINEER_ENV_SCHEMAS = Object.freeze({
  'software-engineer-env/sandbox-definition': SOFTWARE_ENGINEER_ENV_SCHEMA_VERSION,
  'software-engineer-env/hermetic-definition': SOFTWARE_ENGINEER_ENV_SCHEMA_VERSION,
  'software-engineer-env/run-declaration': SOFTWARE_ENGINEER_ENV_SCHEMA_VERSION,
  'software-engineer-env/lifecycle-sequence': SOFTWARE_ENGINEER_ENV_SCHEMA_VERSION,
  'software-engineer-env/schema-registry': SOFTWARE_ENGINEER_ENV_SCHEMA_VERSION,
} as const);

export type SoftwareEngineerEnvironmentSchemaName = keyof typeof SOFTWARE_ENGINEER_ENV_SCHEMAS;

const NAMES = new Set(Object.keys(SOFTWARE_ENGINEER_ENV_SCHEMAS));

/** Build a SchemaRef for one of this package's data shapes. */
export function softwareEngineerEnvironmentSchemaRef(
  name: SoftwareEngineerEnvironmentSchemaName,
): SchemaRef {
  if (!NAMES.has(name)) {
    throw new SoftwareEngineerEnvironmentError(
      SOFTWARE_ENGINEER_ENV_ERROR_CODES.INVALID_DECLARATION,
      `unknown software-engineer-env schema name: ${String(name)}`,
    );
  }
  return parseSchemaRef(`arena:schema/${name}@${SOFTWARE_ENGINEER_ENV_SCHEMA_VERSION}`);
}

/** Is the given SchemaRef one of this package's registered shapes? */
export function isKnownSoftwareEngineerEnvironmentSchema(ref: SchemaRef): boolean {
  const key = `${ref.namespace}/${ref.name}`;
  return (
    NAMES.has(key) &&
    ref.version === SOFTWARE_ENGINEER_ENV_SCHEMAS[key as SoftwareEngineerEnvironmentSchemaName]
  );
}
