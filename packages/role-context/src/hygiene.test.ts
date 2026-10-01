/**
 * Source and surface hygiene suite (Work Order B003) — mirrors the
 * @arena/entitlements hygiene discipline: no `any` in non-test sources, no
 * provider names or credential-shaped words, dependency discipline (the
 * package's ONLY workspace dependency is @arena/protocol-core), and the
 * public surface exports exactly the B003 vocabulary (test-support is NOT
 * re-exported).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as surface from './index.js';
import type {
  ActiveRoleContext,
  CapabilityCaseView,
  CanonicalStateDescriptor,
  GrantedRole,
  Identity,
  PermissionPolicy,
  RoleDefinition,
  RoleProjection,
  RoleProjectionDefinition,
  RoleRegistry as RoleRegistryType,
  SwitchPreservation,
  WorkspaceContext,
} from './index.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const SRC_DIR = join(PACKAGE_ROOT, 'src');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const NON_TEST_SOURCES = listSourceFiles(SRC_DIR);

describe('source hygiene', () => {
  it('has no `any` in non-test sources', () => {
    const patterns = [/:\s*any\b/, /\bas\s+any\b/, /<any>/, /\bany\[\]/, /readonly\s+any\b/, /\bPromise<any>\b/];
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        if (pattern.test(text)) violations.push(`${file}: ${String(pattern)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('carries no provider names or credential-shaped words in non-test sources', () => {
    const denyList = [
      'openai', 'anthropic', 'claude', 'gemini', 'gpt',
      'api_key', 'api-key', 'apikey',
      'secret', 'credential', 'password', 'bearer', 'token',
    ];
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const word of denyList) {
        if (text.includes(word)) violations.push(`${file}: ${word}`);
      }
    }
    expect(NON_TEST_SOURCES.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('ships no credential-shaped literals (prefix fragments keep this scanner honest)', () => {
    const literalPattern = new RegExp(`(?:${['gh' + 'p_', 'sk' + '-', 'AK' + 'IA'].join('|')})[A-Za-z0-9]{16,}`);
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      if (literalPattern.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});

describe('dependency discipline', () => {
  it('the ONLY workspace dependency is @arena/protocol-core (protocol layer)', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@arena/protocol-core']);
    expect(manifest.dependencies?.['@arena/protocol-core']).toBe('workspace:*');
    // devDependencies are catalog-pinned tooling only
    for (const version of Object.values(manifest.devDependencies ?? {})) {
      expect(version).toBe('catalog:');
    }
  });

  it('imports only @arena/protocol-core across workspace boundaries', () => {
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from\s+'(@arena\/[a-z-]+)'/g)) {
        const imported = match[1];
        if (imported !== '@arena/protocol-core') {
          violations.push(`${file}: ${String(imported)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the package generator exists (G9 auto-discovery contract)', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'scripts', 'generate-contracts.mjs'))).toBe(true);
  });

  it('the committed contracts directory exists with the 7 artifacts', () => {
    const contractsDir = join(REPO_ROOT, 'contracts', 'role-context');
    const files = readdirSync(contractsDir).filter((name) => name.endsWith('.v1.json'));
    expect(files.sort()).toEqual([
      'active-role-context.v1.json',
      'canonical-state-kind.v1.json',
      'granted-role.v1.json',
      'role-definition.v1.json',
      'role-projection.v1.json',
      'role-registry.v1.json',
      'workspace-context.v1.json',
    ]);
  });
});

describe('public surface hygiene', () => {
  it('exports the B003 role/context vocabulary', () => {
    const expected = [
      // errors
      'RoleContextError',
      'ROLE_CONTEXT_ERROR_CODES',
      'fromRoleContextErrorStruct',
      'toRoleContextErrorStruct',
      'normalizeToRoleContextError',
      // shared
      'ROLE_IDS',
      'CANONICAL_STATE_KINDS',
      'CANONICAL_OBJECT_KINDS',
      'deepFreeze',
      'toRoleId',
      'toTenantId',
      // schemas
      'ROLE_CONTEXT_SCHEMAS',
      'roleContextSchemaRef',
      'ROLE_CONTEXT_VERSION',
      // roles
      'REFERENCE_ROLE_REGISTRY',
      'ROLE_REGISTRY_VERSION',
      'getRoleDefinition',
      'toRoleRegistry',
      'listRoleIds',
      // grants
      'createIdentity',
      'createTenantMembership',
      'isMemberOfTenant',
      'createPermissionPolicy',
      'permissionFingerprint',
      'grantRole',
      'isRoleGrantActive',
      'roleGrantInactivityReason',
      'createWorkspaceContext',
      'activateRole',
      'resolveActiveContext',
      'toWorkspaceContext',
      'workspacePermissionFingerprint',
      'grantedRoleIds',
      'activeRoleSurfaces',
      // projections
      'applyRoleProjection',
      'defineRoleProjection',
      'roleProjectionRecord',
      'CAPABILITY_CASE_OWNER_LENS',
      'CAPABILITY_CASE_EXPERT_LENS',
      'CAPABILITY_CASE_BUILDER_LENS',
      'CAPABILITY_CASE_RESEARCHER_LENS',
      'CAPABILITY_CASE_OPERATOR_LENS',
      'CAPABILITY_CASE_LENSES',
      'projectCapabilityCase',
      // states
      'CANONICAL_STATE_DESCRIPTORS',
      'classifyState',
      'canonicalStateDescriptor',
      'canonicalStateLabel',
      'DISTINCT_STATE_KINDS',
      'stateKindDisplayGroup',
      'areStateKindsDisplayEquivalent',
      'countStateKinds',
      'toCanonicalStateKind',
    ] as const;
    for (const name of expected) {
      expect(surface, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it('does NOT re-export test-support (fixtures stay internal)', () => {
    expect(surface).not.toHaveProperty('TENANT_A');
    expect(surface).not.toHaveProperty('CANONICAL_CASE');
    expect(surface).not.toHaveProperty('Lcg');
    expect(surface).not.toHaveProperty('fixtureMultiRoleWorkspace');
  });

  it('exports the B003 type vocabulary (compile-time proof)', () => {
    // If any of these types disappeared from the public surface, THIS file
    // would fail typecheck — the import above is the assertion.
    const typeProofs: readonly unknown[] = [
      null as unknown as RoleDefinition,
      null as unknown as RoleRegistryType,
      null as unknown as GrantedRole,
      null as unknown as Identity,
      null as unknown as PermissionPolicy,
      null as unknown as ActiveRoleContext,
      null as unknown as WorkspaceContext,
      null as unknown as SwitchPreservation,
      null as unknown as RoleProjectionDefinition<CapabilityCaseView, RoleProjection>,
      null as unknown as CanonicalStateDescriptor,
    ];
    expect(typeProofs).toHaveLength(10);
  });
});
