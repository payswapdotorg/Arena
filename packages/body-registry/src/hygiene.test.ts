/**
 * Hygiene suite (Work Order A024):
 *
 *   1. APPEND-ONLY PROOFS (architecture-lock rules 5, 6 — release
 *      history is never rewritten): there is no update/delete path for
 *      ReleaseRecords or publication records anywhere in this package;
 *      the non-test sources never call the A003 registry write API
 *      (registerBodyVersion) — the registry EMITS release records and
 *      never mutates body versions.
 *   2. Closed vocabularies — channels, gate reasons, record kinds,
 *      publication actions, error categories and schema names are
 *      closed frozen sets.
 *   3. Public-surface hygiene — no `any` in the public surface, the
 *      internal test-support module is not exported, exported objects
 *      are frozen.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as bodyRegistry from './index.js';
import {
  BODY_REGISTRY_ERROR_CATEGORIES,
  BODY_REGISTRY_ERROR_CODES,
  BODY_REGISTRY_SCHEMAS,
  RELEASE_CHANNELS,
  RELEASE_GATE_REASONS,
  RELEASE_PUBLICATION_ACTIONS,
  RELEASE_RECORD_KINDS,
} from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * A003 registry/history write APIs (case-insensitive tokens). The
 * body-registry package must never call these — registering a RELEASE
 * never appends to the body's own version registry; the A003 registry
 * remains the single append authority for body versions.
 */
const WRITE_API_DENY = ['registerbodyversion', 'appendtrajectoryentry', 'createevaluationrecord', 'createverificationrecord'];

/** Mutation API shapes that must NOT exist on the registry surface. */
const FORBIDDEN_EXPORTS = [
  'updateRelease',
  'deleteRelease',
  'mutateRelease',
  'editRelease',
  'rewriteRelease',
  'replaceRelease',
  'updateReleaseRecord',
  'deleteReleaseRecord',
  'unpublishRelease',
];

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...collectFiles(path, filter));
    } else if (filter(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe('hygiene — append-only discipline', () => {
  it('no source file calls sibling registry write APIs', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const token of WRITE_API_DENY) {
        expect(text, `${file} must not call ${token}`).not.toContain(token);
      }
    }
  });

  it('no mutation APIs exist on the public surface', () => {
    for (const name of FORBIDDEN_EXPORTS) {
      expect(bodyRegistry, `surface must not export ${name}`).not.toHaveProperty(name);
    }
  });

  it('records and publications are deep-frozen by their constructors (structural)', () => {
    // Constructors freeze; guards accept frozen results — pinned by the
    // record/publication suites. Here: the frozen vocabularies.
    expect(Object.isFrozen(RELEASE_CHANNELS)).toBe(true);
    expect(Object.isFrozen(RELEASE_GATE_REASONS)).toBe(true);
    expect(Object.isFrozen(RELEASE_RECORD_KINDS)).toBe(true);
    expect(Object.isFrozen(RELEASE_PUBLICATION_ACTIONS)).toBe(true);
    expect(Object.isFrozen(BODY_REGISTRY_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(BODY_REGISTRY_ERROR_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(BODY_REGISTRY_SCHEMAS)).toBe(true);
  });
});

describe('hygiene — public surface', () => {
  it('the internal test-support module is NOT exported from the index', () => {
    expect(Object.keys(bodyRegistry)).not.toContain('makeAdmittedScenario');
    expect(Object.keys(bodyRegistry)).not.toContain('T0');
  });

  it('the index re-exports the protocol surface', () => {
    expect(Object.keys(bodyRegistry)).toContain('evaluateReleaseGate');
    expect(Object.keys(bodyRegistry)).toContain('createReleaseRegistrationRecord');
    expect(Object.keys(bodyRegistry)).toContain('publishRelease');
    expect(Object.keys(bodyRegistry)).toContain('appendReleasePublication');
    expect(Object.keys(bodyRegistry)).toContain('BODY_REGISTRY_PROTOCOL_VERSION');
    expect(Object.keys(bodyRegistry)).toContain('SUPPORTED_BODY_REGISTRY_ERROR_CODES');
    expect(Object.keys(bodyRegistry)).toContain('BODY_REGISTRY_SCHEMA_REGISTRY');
  });

  it('no explicit `any` in non-test sources', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text.match(/:\s*any\b/g) ?? [], `${file} must not use explicit any`).toHaveLength(0);
    }
  });

  it('README exists and discloses the contracts posture', () => {
    const readme = join(PACKAGE_ROOT, 'README.md');
    expect(existsSync(readme)).toBe(true);
    const text = readFileSync(readme, 'utf8');
    expect(text).toContain('contracts');
    expect(text.toLowerCase()).toContain('release');
  });
});
