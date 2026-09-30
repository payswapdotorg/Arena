/**
 * Hygiene suite (Work Order A025):
 *
 *   1. READ-ONLY PROOFS — the SDK is a read/query surface: there is no
 *      write/mutation API anywhere in this package, and the non-test
 *      sources never call any sibling WRITE API (registerRelease,
 *      certify, createAndRegister, registerBodyVersion, appendNode,
 *      registerCase …) — the API layer reads the completed platform
 *      core; it never mutates it.
 *   2. Closed vocabularies — query kinds, error codes/categories,
 *      lifecycle states, visibilities and schema names are closed
 *      frozen sets.
 *   3. Public-surface hygiene — no `any` in the public surface, the
 *      internal test-support module is not exported, exported objects
 *      are frozen.
 *   4. Contracts posture — the package owns contracts/api/ with a
 *      committed generator, and the battery wiring (vitest config +
 *      package scripts) is present.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as arenaSdk from './index.js';
import {
  API_QUERY_KINDS,
  API_RELEASE_LIFECYCLE_STATES,
  API_RELEASE_VISIBILITIES,
} from './queries.js';
import { ARENA_API_ERROR_CATEGORIES, ARENA_API_ERROR_CODES } from './errors.js';
import { API_SCHEMAS } from './envelopes.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Sibling WRITE APIs (case-insensitive tokens). The SDK must never
 * call these — it is the typed read surface over the completed
 * platform core, never a second write path. (Pure record CONSTRUCTORS
 * — createBodyVersion, createCertificationRecord, publishRelease,
 * evaluateReleaseGate — are value builders used only by the internal
 * test fixtures; registry/fabric MUTATION methods are what the SDK
 * must never touch.)
 */
const WRITE_API_DENY = [
  'registerrelease(',
  'registersuite(',
  'registerbodyversion(',
  'appendtrajectoryentry(',
  'createevaluationrecord(',
  'createverificationrecord(',
  '.supersede(',
  '.retire(',
  '.publish(',
  '.retract(',
  'certify(',
  '.revoke(',
  '.clear()',
];

/** Mutation API shapes that must NOT exist on the SDK surface. */
const FORBIDDEN_EXPORTS = [
  'putReleaseRecord',
  'putCertificationRecord',
  'registerRelease',
  'deleteRelease',
  'updateRelease',
  'mutateRecord',
  'certify',
  'revoke',
];

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(path, filter));
    else if (filter(entry.name)) out.push(path);
  }
  return out;
}

const isSource = (name: string) => name.endsWith('.ts') && !name.endsWith('.test.ts');

describe('hygiene: the SDK is a read-only surface', () => {
  it('the domain package non-test sources never call a sibling write API', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), isSource);
    expect(sources.length).toBeGreaterThan(5);
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8').toLowerCase();
      for (const token of WRITE_API_DENY) {
        expect(text.includes(token)).toBe(false);
      }
    }
  });

  it('no mutation API exists on the exported surface', () => {
    for (const forbidden of FORBIDDEN_EXPORTS) {
      expect(arenaSdk).not.toHaveProperty(forbidden);
    }
  });
});

describe('hygiene: closed frozen vocabularies', () => {
  it('every exported vocabulary object is frozen', () => {
    expect(Object.isFrozen(API_QUERY_KINDS)).toBe(true);
    expect(Object.isFrozen(ARENA_API_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(ARENA_API_ERROR_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(API_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(API_RELEASE_LIFECYCLE_STATES)).toBe(true);
    expect(Object.isFrozen(API_RELEASE_VISIBILITIES)).toBe(true);
  });

  it('the internal test-support module is NOT exported', () => {
    expect(arenaSdk).not.toHaveProperty('makeScenario');
    expect(arenaSdk).not.toHaveProperty('makeBodyVersion');
    expect((arenaSdk as Record<string, unknown>)['default']).toBeUndefined();
  });
});

describe('hygiene: no explicit any in non-test sources', () => {
  it('the public surface contains no `: any` annotations', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), isSource);
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8');
      expect(text.match(/:\s*any\b/g) ?? []).toHaveLength(0);
    }
  });
});

describe('hygiene: contracts posture + battery wiring', () => {
  it('the committed generated contracts exist (7 files)', () => {
    const contracts = collectFiles(
      join(REPO_ROOT, 'contracts', 'api'),
      (name) => name.endsWith('.json'),
    );
    expect(contracts).toHaveLength(7);
    for (const contract of contracts) {
      const parsed = JSON.parse(readFileSync(contract, 'utf-8')) as Record<string, unknown>;
      expect(parsed['$id']).toMatch(/^arena:schema\/api\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('the package-level generator exists and is G9-discoverable', () => {
    const generator = join(PACKAGE_ROOT, 'scripts', 'generate-contracts.mjs');
    expect(statSync(generator).isFile()).toBe(true);
  });

  it('the vitest config and manifest are present (battery wiring)', () => {
    expect(statSync(join(PACKAGE_ROOT, 'vitest.config.ts')).isFile()).toBe(true);
    const scripts = (
      JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
        scripts: Record<string, string>;
      }
    )['scripts'];
    expect(scripts['contracts:generate']).toContain('generate-contracts.mjs');
    expect(scripts['contracts:check']).toContain('--check');
    expect(scripts['typecheck']).toContain('tsc');
    expect(scripts['test']).toContain('vitest');
  });

  it('the README exists and discloses the contracts posture', () => {
    const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf-8');
    expect(readme.length).toBeGreaterThan(200);
    expect(readme.toLowerCase()).toContain('contracts');
  });
});
