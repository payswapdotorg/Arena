/**
 * Hygiene suite for the fabric (Work Order A021):
 *
 *   1. PROPOSAL-ONLY PROOFS (lock rules 5, 6): the fabric's non-test
 *      sources never call the A003 registry write API
 *      (registerBodyVersion) — the forge emits proposals, it never
 *      appends them to a body's version registry; and there is no
 *      BodyVersion mutation API on the public surface.
 *   2. LAYER HYGIENE: the fabric never imports another service's
 *      internals (boundary rule B2).
 *   3. Public-surface hygiene: no `any` in the sources, the internal
 *      test-support module is not exported.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as fabric from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** A003 registry write APIs (case-insensitive tokens). */
const WRITE_API_DENY = [
  'registerbodyversion',
  'appendtrajectoryentry',
  'createevaluationrecord',
  'createverificationrecord',
];

/** Mutation API shapes that must NOT exist on the fabric surface. */
const FORBIDDEN_EXPORTS = [
  'updateBodyVersion',
  'deleteBodyVersion',
  'mutateBodyVersion',
  'editBodyVersion',
  'rewriteBodyVersion',
  'replaceBodyVersion',
];

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, filter));
    } else if (entry.isFile() && filter(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

describe('proposal-only proofs (lock rules 5, 6)', () => {
  it('the non-test sources never call the A003 registry/history write APIs', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    expect(sources.length).toBeGreaterThanOrEqual(3);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8').toLowerCase();
      for (const token of WRITE_API_DENY) {
        if (text.includes(token)) violations.push(`${file}: ${token}`);
      }
    }
    expect(violations, `registry/history write API usage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('no BodyVersion mutation API exists on the public surface', () => {
    const surfaceKeys = Object.keys(fabric);
    for (const forbidden of FORBIDDEN_EXPORTS) {
      expect(surfaceKeys, `public surface must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('layer hygiene (boundary rule B2)', () => {
  it('the sources never import another service\'s internals', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      const matches = [...text.matchAll(/from\s+['"](@arena\/[a-z-]+)['"]/g)];
      for (const match of matches) {
        const imported = match[1];
        if (imported !== undefined && imported.endsWith('-fabric')) {
          violations.push(`${file}: ${imported}`);
        }
      }
    }
    expect(violations, `cross-service imports in sources:\n${violations.join('\n')}`).toEqual([]);
  });
});

describe('public-surface hygiene', () => {
  it('test-support is quarantined: its builders are not re-exported by the public surface', () => {
    const surfaceKeys = Object.keys(fabric);
    for (const builder of [
      'makeTrajectory',
      'makeEvaluation',
      'makeVerification',
      'makeValidatedRef',
      'makeSkillDraft',
      'makeExperimentRunRecord',
      'makeManifest',
      'makeManifestInput',
      'TestLcg',
    ]) {
      expect(surfaceKeys).not.toContain(builder);
    }
  });

  it('the non-test sources declare no `any`', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), (name) =>
      name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      const matches = text.match(/:\s*any\b/g);
      if (matches !== null) violations.push(`${file}: ${String(matches.length)} explicit any`);
    }
    expect(violations, `explicit any in sources:\n${violations.join('\n')}`).toEqual([]);
  });
});
