/**
 * SchemaRef — Arena's versioned addressing scheme (architecture-lock rules
 * 18 and 22: material artifacts are provenance-addressable; versioned
 * artifacts cannot silently redefine identity).
 *
 * String form: `arena:schema/<namespace>/<name>@<major.minor.patch>`
 *
 * Core schemas are exact `major.minor.patch` (no prerelease/build suffixes);
 * unknown names and unknown versions are rejected by the core registry.
 */

import { PROTOCOL_ERROR_CODES, ProtocolError } from './protocol-error.js';

export const SCHEMA_REF_PREFIX = 'arena:schema';

/** Exact pattern source; kept in sync with the generated contracts. */
export const SCHEMA_REF_PATTERN_SOURCE =
  '^arena:schema/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*@\\d+\\.\\d+\\.\\d+$';

const SCHEMA_REF_PATTERN = new RegExp(SCHEMA_REF_PATTERN_SOURCE);
const PARSE_PATTERN =
  /^arena:schema\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+)$/;

export interface SchemaRef {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}

export function isSchemaRef(value: unknown): value is SchemaRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['version'] === 'string' &&
    SCHEMA_REF_PATTERN.test(
      `${SCHEMA_REF_PREFIX}/${String(candidate['namespace'])}/${String(candidate['name'])}@${String(candidate['version'])}`,
    )
  );
}

export function formatSchemaRef(ref: SchemaRef): string {
  return `${SCHEMA_REF_PREFIX}/${ref.namespace}/${ref.name}@${ref.version}`;
}

/**
 * Strictly parse a SchemaRef string. Throws ProtocolError
 * (PROTOCOL_INVALID_SCHEMA_REF) for anything that is not an exact
 * `arena:schema/<ns>/<name>@<major.minor.patch>` reference — including
 * prerelease suffixes, which core schemas do not use.
 */
export function parseSchemaRef(value: string): SchemaRef {
  const match = PARSE_PATTERN.exec(value);
  if (!match) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `invalid schema ref: ${JSON.stringify(value)}`,
      details: { pattern: SCHEMA_REF_PATTERN_SOURCE },
    });
  }
  const namespace = match[1];
  const name = match[2];
  const version = match[3];
  if (namespace === undefined || name === undefined || version === undefined) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `invalid schema ref: ${JSON.stringify(value)}`,
    });
  }
  return { namespace, name, version };
}

export const CORE_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of core schemas owned by @arena/protocol-core.
 * Mirrored by the generated contract schema-registry.v1.json
 * (parity asserted in contracts.parity.test.ts).
 */
export const CORE_SCHEMAS = {
  'protocol/envelope': CORE_SCHEMA_VERSION,
  'protocol/schema-ref': CORE_SCHEMA_VERSION,
  'protocol/protocol-error': CORE_SCHEMA_VERSION,
  'protocol/schema-registry': CORE_SCHEMA_VERSION,
} as const;

export type CoreSchemaName = keyof typeof CORE_SCHEMAS;

/** Resolve a core schema name (e.g. 'protocol/envelope') to its SchemaRef. */
export function coreSchemaRef(name: CoreSchemaName): SchemaRef {
  const version = CORE_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.UNKNOWN_SCHEMA, {
      message: `unknown core schema: ${String(name)}`,
      details: { known: Object.keys(CORE_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a core schema AND carries the registered version. */
export function isKnownCoreSchema(ref: SchemaRef): boolean {
  const registered = (CORE_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}
