/**
 * Contract parity suite (Work Order B003) — binds the generated contracts
 * (contracts/role-context/*.json, produced by
 * packages/role-context/scripts/generate-contracts.mjs) to the TypeScript
 * surface of @arena/role-context.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001–A006 convention.
 */

import { describe, expect, it } from 'vitest';
import roleDefinitionSchema from '../../../contracts/role-context/role-definition.v1.json' with { type: 'json' };
import grantedRoleSchema from '../../../contracts/role-context/granted-role.v1.json' with { type: 'json' };
import activeRoleContextSchema from '../../../contracts/role-context/active-role-context.v1.json' with { type: 'json' };
import workspaceContextSchema from '../../../contracts/role-context/workspace-context.v1.json' with { type: 'json' };
import roleProjectionSchema from '../../../contracts/role-context/role-projection.v1.json' with { type: 'json' };
import canonicalStateKindSchema from '../../../contracts/role-context/canonical-state-kind.v1.json' with { type: 'json' };
import roleRegistrySchema from '../../../contracts/role-context/role-registry.v1.json' with { type: 'json' };
import {
  ACTIVE_ROLE_CONTEXT_RECORD_VERSION,
  CANONICAL_STATE_DESCRIPTORS,
  CANONICAL_STATE_KINDS,
  CANONICAL_STATE_RECORD_VERSION,
  CANONICAL_OBJECT_KINDS,
  IDENTITY_ID_PATTERN_SOURCE,
  PERMISSION_POLICY_RECORD_VERSION,
  POLICY_ID_PATTERN_SOURCE,
  PROJECTION_ID_PATTERN_SOURCE,
  REFERENCE_ROLE_REGISTRY,
  ROLE_CONTEXT_SCHEMA_VERSION,
  ROLE_CONTEXT_SCHEMAS,
  ROLE_DEFINITION_RECORD_VERSION,
  ROLE_GRANT_ID_PATTERN_SOURCE,
  ROLE_GRANT_RECORD_VERSION,
  ROLE_IDS,
  ROLE_PROJECTION_RECORD_VERSION,
  ROLE_REGISTRY_RECORD_VERSION,
  ROLE_REGISTRY_VERSION,
  ROLE_CONTEXT_TIMESTAMP_PATTERN_SOURCE,
  SURFACE_ID_PATTERN_SOURCE,
  TENANT_ID_PATTERN_SOURCE,
  WORKSPACE_CONTEXT_RECORD_VERSION,
  WORKSPACE_ID_PATTERN_SOURCE,
  ROLE_CONTEXT_SEMVER_PATTERN_SOURCE,
  CANONICAL_OBJECT_REF_PATTERN_SOURCE,
} from './index.js';
import { formatSchemaRef, parseSchemaRef } from '@arena/protocol-core';

type JsonSchema = { readonly $id?: string } & Record<string, unknown>;

function prop(schema: JsonSchema, name: string): Record<string, unknown> {
  const properties = schema['properties'] as Record<string, Record<string, unknown>>;
  const value = properties[name];
  if (value === undefined) throw new Error(`schema has no property ${name}`);
  return value;
}

function def(schema: JsonSchema, name: string): Record<string, unknown> {
  const defs = schema['$defs'] as Record<string, Record<string, unknown>>;
  const value = defs[name];
  if (value === undefined) throw new Error(`schema has no $def ${name}`);
  return value;
}

function patternOf(schemaPart: Record<string, unknown>): string {
  return schemaPart['pattern'] as string;
}

function enumOf(schemaPart: Record<string, unknown>): string[] {
  return schemaPart['enum'] as string[];
}

const ALL_SCHEMAS: readonly JsonSchema[] = [
  roleDefinitionSchema,
  grantedRoleSchema,
  activeRoleContextSchema,
  workspaceContextSchema,
  roleProjectionSchema,
  canonicalStateKindSchema,
  roleRegistrySchema,
];

describe('generated contract artifacts (B003)', () => {
  it('ship exactly the 7 declared schemas at version 1.0.0', () => {
    expect(ALL_SCHEMAS).toHaveLength(7);
    for (const schema of ALL_SCHEMAS) {
      expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(typeof schema['$id']).toBe('string');
      const ref = parseSchemaRef(schema['$id'] as string);
      expect(ref.namespace).toBe('role-context');
      expect(ref.version).toBe(ROLE_CONTEXT_SCHEMA_VERSION);
    }
    const ids = ALL_SCHEMAS.map((schema) => schema['$id'] as string);
    expect(new Set(ids).size).toBe(7);
  });

  it('the $ids match the TS ROLE_CONTEXT_SCHEMAS registry exactly', () => {
    const contractIds = ALL_SCHEMAS.map((schema) => schema['$id'] as string).sort();
    const registryIds = Object.keys(ROLE_CONTEXT_SCHEMAS)
      .map((name) => {
        const parts = name.split('/');
        const namespace = parts[0];
        const schemaName = parts[1];
        if (namespace === undefined || schemaName === undefined) {
          throw new Error(`malformed registry key: ${name}`);
        }
        return formatSchemaRef({ namespace, name: schemaName, version: ROLE_CONTEXT_SCHEMA_VERSION });
      })
      .sort();
    expect(contractIds).toEqual(registryIds);
    expect(Object.keys(ROLE_CONTEXT_SCHEMAS)).toHaveLength(7);
  });

  it('role-definition: mirrors the TS vocabulary, patterns and record version', () => {
    expect(roleDefinitionSchema['$id']).toBe(
      `arena:schema/role-context/role-definition@${ROLE_CONTEXT_SCHEMA_VERSION}`,
    );
    expect(enumOf(prop(roleDefinitionSchema, 'roleId'))).toEqual([...ROLE_IDS]);
    expect(prop(roleDefinitionSchema, 'recordVersion')).toEqual({
      const: ROLE_DEFINITION_RECORD_VERSION,
    });
    expect(patternOf(prop(roleDefinitionSchema, 'version'))).toBe(
      ROLE_CONTEXT_SEMVER_PATTERN_SOURCE,
    );
    expect(
      patternOf((prop(roleDefinitionSchema, 'primarySurfaces') as Record<string, unknown>)['items'] as Record<string, unknown>),
    ).toBe(SURFACE_ID_PATTERN_SOURCE);
  });

  it('granted-role: mirrors grant ids, provenance, expiry and record version', () => {
    expect(enumOf(prop(grantedRoleSchema, 'roleId'))).toEqual([...ROLE_IDS]);
    expect(prop(grantedRoleSchema, 'recordVersion')).toEqual({ const: ROLE_GRANT_RECORD_VERSION });
    expect(patternOf(prop(grantedRoleSchema, 'grantId'))).toBe(ROLE_GRANT_ID_PATTERN_SOURCE);
    expect(patternOf(prop(grantedRoleSchema, 'identityId'))).toBe(IDENTITY_ID_PATTERN_SOURCE);
    expect(patternOf(prop(grantedRoleSchema, 'tenantId'))).toBe(TENANT_ID_PATTERN_SOURCE);
    expect(patternOf(prop(grantedRoleSchema, 'policyId'))).toBe(POLICY_ID_PATTERN_SOURCE);
    expect(patternOf(prop(grantedRoleSchema, 'validFrom'))).toBe(
      ROLE_CONTEXT_TIMESTAMP_PATTERN_SOURCE,
    );
    expect(patternOf(prop(grantedRoleSchema, 'expiresAt'))).toBe(
      ROLE_CONTEXT_TIMESTAMP_PATTERN_SOURCE,
    );
    const provenance = def(grantedRoleSchema, 'grantProvenance');
    expect(patternOf(prop(provenance as JsonSchema, 'grantedAt'))).toBe(
      ROLE_CONTEXT_TIMESTAMP_PATTERN_SOURCE,
    );
  });

  it('active-role-context: mirrors workspace binding and switch preservation', () => {
    expect(prop(activeRoleContextSchema, 'recordVersion')).toEqual({
      const: ACTIVE_ROLE_CONTEXT_RECORD_VERSION,
    });
    expect(patternOf(prop(activeRoleContextSchema, 'workspaceId'))).toBe(
      WORKSPACE_ID_PATTERN_SOURCE,
    );
    expect(patternOf(prop(activeRoleContextSchema, 'registryVersion'))).toBe(
      ROLE_CONTEXT_SEMVER_PATTERN_SOURCE,
    );
    const preserved = def(activeRoleContextSchema, 'switchPreservation');
    expect(patternOf(prop(preserved as JsonSchema, 'canonicalObjectRef'))).toBe(
      CANONICAL_OBJECT_REF_PATTERN_SOURCE,
    );
  });

  it('workspace-context: embeds granted-role, permission policy and active role', () => {
    expect(prop(workspaceContextSchema, 'recordVersion')).toEqual({
      const: WORKSPACE_CONTEXT_RECORD_VERSION,
    });
    expect(
      enumOf(prop(def(workspaceContextSchema, 'grantedRole') as JsonSchema, 'roleId')),
    ).toEqual([...ROLE_IDS]);
    const policy = def(workspaceContextSchema, 'permissionPolicy') as JsonSchema;
    expect(prop(policy, 'recordVersion')).toEqual({ const: PERMISSION_POLICY_RECORD_VERSION });
    expect(patternOf(prop(policy, 'policyId'))).toBe(POLICY_ID_PATTERN_SOURCE);
    const descriptor = prop(policy, 'descriptor') as Record<string, unknown>;
    expect(descriptor['type']).toBe('object');
  });

  it('role-projection: mirrors projection ids, kinds and canonical identity', () => {
    expect(prop(roleProjectionSchema, 'recordVersion')).toEqual({
      const: ROLE_PROJECTION_RECORD_VERSION,
    });
    expect(patternOf(prop(roleProjectionSchema, 'projectionId'))).toBe(
      PROJECTION_ID_PATTERN_SOURCE,
    );
    expect(enumOf(prop(roleProjectionSchema, 'roleId'))).toEqual([...ROLE_IDS]);
    expect(enumOf(prop(roleProjectionSchema, 'canonicalKind'))).toEqual([
      ...CANONICAL_OBJECT_KINDS,
    ]);
    const identity = def(roleProjectionSchema, 'canonicalObjectIdentity') as JsonSchema;
    expect(enumOf(prop(identity, 'kind'))).toEqual([...CANONICAL_OBJECT_KINDS]);
    expect(patternOf(prop(identity, 'tenant'))).toBe(TENANT_ID_PATTERN_SOURCE);
  });

  it('canonical-state-kind: mirrors the 11-kind taxonomy and record version', () => {
    expect(prop(canonicalStateKindSchema, 'recordVersion')).toEqual({
      const: CANONICAL_STATE_RECORD_VERSION,
    });
    expect(enumOf(prop(canonicalStateKindSchema, 'kind'))).toEqual([...CANONICAL_STATE_KINDS]);
  });

  it('role-registry: mirrors the registry record and the reference registry data', () => {
    expect(prop(roleRegistrySchema, 'recordVersion')).toEqual({
      const: ROLE_REGISTRY_RECORD_VERSION,
    });
    const roles = prop(roleRegistrySchema, 'roles') as Record<string, unknown>;
    expect(roles['type']).toBe('array');
    expect(enumOf(prop(def(roleRegistrySchema, 'roleDefinition') as JsonSchema, 'roleId'))).toEqual([
      ...ROLE_IDS,
    ]);
    // the committed contract pins the reference registry version semantics:
    // the TS registry validates against the contract's shape constraints
    expect(REFERENCE_ROLE_REGISTRY.registryVersion).toBe(ROLE_REGISTRY_VERSION);
    expect(REFERENCE_ROLE_REGISTRY.roles).toHaveLength(ROLE_IDS.length);
    for (const role of REFERENCE_ROLE_REGISTRY.roles) {
      expect(ROLE_IDS).toContain(role.roleId);
      expect(role.version).toMatch(new RegExp(ROLE_CONTEXT_SEMVER_PATTERN_SOURCE));
      for (const surface of role.primarySurfaces) {
        expect(surface).toMatch(new RegExp(SURFACE_ID_PATTERN_SOURCE));
      }
    }
  });

  it('the TS state descriptors all satisfy the committed descriptor schema constraints', () => {
    for (const descriptor of CANONICAL_STATE_DESCRIPTORS) {
      expect(CANONICAL_STATE_KINDS).toContain(descriptor.kind);
      expect(descriptor.label.length).toBeGreaterThanOrEqual(1);
      expect(descriptor.label.length).toBeLessThanOrEqual(200);
      expect(descriptor.meaning.length).toBeLessThanOrEqual(2000);
      expect(descriptor.guidance.length).toBeLessThanOrEqual(2000);
    }
  });
});
