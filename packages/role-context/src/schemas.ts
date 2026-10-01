/**
 * Schema registry for the role-context namespace (Work Order B003).
 *
 * Payload schemas are versioned SchemaRefs in the `role-context`
 * namespace (arena:schema/role-context/<name>@<major.minor.patch>) — the
 * same discipline as @arena/entitlements' envelopes.ts and
 * @arena/expert-registry's registry. The generated contract artifacts live
 * in contracts/role-context/ at the repository root (produced by
 * packages/role-context/scripts/generate-contracts.mjs; committed;
 * drift-checked by governance G9, the drift suite and the parity suite).
 */

import { formatSchemaRef } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from './errors.js';

export const ROLE_CONTEXT_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/role-context. Mirrored by the
 * generated contracts (contracts/role-context/*.v1.json); parity is
 * asserted by src/contracts.parity.test.ts.
 */
export const ROLE_CONTEXT_SCHEMAS = Object.freeze({
  'role-context/role-definition': ROLE_CONTEXT_SCHEMA_VERSION,
  'role-context/granted-role': ROLE_CONTEXT_SCHEMA_VERSION,
  'role-context/active-role-context': ROLE_CONTEXT_SCHEMA_VERSION,
  'role-context/workspace-context': ROLE_CONTEXT_SCHEMA_VERSION,
  'role-context/role-projection': ROLE_CONTEXT_SCHEMA_VERSION,
  'role-context/canonical-state-kind': ROLE_CONTEXT_SCHEMA_VERSION,
  'role-context/role-registry': ROLE_CONTEXT_SCHEMA_VERSION,
} as const);

export type RoleContextSchemaName = keyof typeof ROLE_CONTEXT_SCHEMAS;

/** Resolve a role-context schema name to its SchemaRef. */
export function roleContextSchemaRef(name: RoleContextSchemaName): SchemaRef {
  const version = ROLE_CONTEXT_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown role-context schema: ${String(name)}`,
      details: { known: Object.keys(ROLE_CONTEXT_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** The SchemaRef string form of a role-context schema (`arena:schema/...`). */
export function roleContextSchemaRefString(name: RoleContextSchemaName): string {
  return formatSchemaRef(roleContextSchemaRef(name));
}

/** True iff the ref names a role-context schema at the registered version. */
export function isKnownRoleContextSchema(ref: SchemaRef): boolean {
  const registered = (ROLE_CONTEXT_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}
