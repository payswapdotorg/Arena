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
  SOFTWARE_ENGINEER_BODY_ERROR_CODES,
  SoftwareEngineerBodyError,
} from './shared.js';

export const SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION = '1.0.0' as const;

export const SOFTWARE_ENGINEER_BODY_SCHEMAS = Object.freeze({
  'software-engineer-body/tool-descriptor': SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION,
  'software-engineer-body/practice-descriptor': SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION,
  'software-engineer-body/capability-declaration': SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION,
  'software-engineer-body/suite-requirement': SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION,
  'software-engineer-body/body-manifest-input': SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION,
  'software-engineer-body/reference-body': SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION,
  'software-engineer-body/schema-registry': SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION,
} as const);

export type SoftwareEngineerBodySchemaName = keyof typeof SOFTWARE_ENGINEER_BODY_SCHEMAS;

const NAMES = new Set(Object.keys(SOFTWARE_ENGINEER_BODY_SCHEMAS));

/** Build a SchemaRef for one of this package's data shapes. */
export function softwareEngineerBodySchemaRef(name: SoftwareEngineerBodySchemaName): SchemaRef {
  if (!NAMES.has(name)) {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_MANIFEST_INPUT,
      `unknown software-engineer-body schema name: ${String(name)}`,
      { name },
    );
  }
  return parseSchemaRef(`arena:schema/${name}@${SOFTWARE_ENGINEER_BODY_SCHEMA_VERSION}`);
}

/** Is the given SchemaRef one of this package's registered shapes? */
export function isKnownSoftwareEngineerBodySchema(ref: SchemaRef): boolean {
  const key = `${ref.namespace}/${ref.name}`;
  return NAMES.has(key) && ref.version === SOFTWARE_ENGINEER_BODY_SCHEMAS[key as SoftwareEngineerBodySchemaName];
}
