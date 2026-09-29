/**
 * Hygiene suite (Work Order A021):
 *
 *   1. PROPOSAL-ONLY PROOFS (architecture-lock rules 5, 6 — the forge
 *      never mutates BodyVersions; learning never rewrites history):
 *      composing leaves the manifest and policy bit-identical
 *      (canonical-form compare before/after) and frozen; the emitted
 *      BodyVersion proposal is a NEW object whose registration remains
 *      the body owner's move — the non-test sources never call the
 *      A003 registry write API (registerBodyVersion); there is no
 *      update/delete path for BodyVersions anywhere in this package.
 *   2. Closed vocabularies — citation kinds, capability kinds, error
 *      categories and schema names are closed frozen sets.
 *   3. Public-surface hygiene — no `any` in the public surface, the
 *      internal test-support module is not exported, exported objects
 *      are frozen.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import { isBodyVersion } from '@arena/agent-body';
import * as bodyForge from './index.js';
import {
  BODY_FORGE_ERROR_CATEGORIES,
  BODY_FORGE_ERROR_CODES,
  BODY_FORGE_SCHEMAS,
  MANIFEST_CAPABILITY_KINDS,
  MANIFEST_CITATION_KINDS,
  createBodyManifest,
  createForgePolicy,
  defaultForgePolicyInput,
  forge,
  forgeBodyVersion,
} from './index.js';
import { FORGE_KEY, makeManifestInput, makeRecipe } from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * A003 registry/history write APIs (case-insensitive tokens). The
 * forge package must never call these — it EMITS proposals; appending
 * them to a body's version registry is the body owner's move
 * (lock rules 5, 6; the A003 registry is the single append authority).
 */
const WRITE_API_DENY = ['registerbodyversion', 'appendtrajectoryentry', 'createevaluationrecord', 'createverificationrecord'];

/** Mutation API shapes that must NOT exist on the forge surface. */
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

const RECIPE = makeRecipe();

describe('proposal-only proofs (lock rules 5, 6)', () => {
  it('composing leaves the manifest and policy bit-identical and frozen', async () => {
    const manifest = await createBodyManifest(makeManifestInput());
    const policy = await createForgePolicy(defaultForgePolicyInput());
    const before = [canonicalJson(manifest), canonicalJson(policy)];
    const result = await forge(manifest, policy, RECIPE, { forgeKey: FORGE_KEY });
    const after = [canonicalJson(manifest), canonicalJson(policy)];
    expect(after).toEqual(before);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(result.bodyVersion)).toBe(true);
    expect(Object.isFrozen(result.record)).toBe(true);
  });

  it('the forge emits a NEW BodyVersion object; composing twice yields byte-identical, distinct proposals', async () => {
    const manifest = await createBodyManifest(makeManifestInput());
    const policy = await createForgePolicy(defaultForgePolicyInput());
    const first = await forgeBodyVersion(manifest, policy, RECIPE);
    const second = await forgeBodyVersion(manifest, policy, RECIPE);
    expect(second).not.toBe(first); // a NEW object, never a mutation
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    expect(isBodyVersion(first)).toBe(true);
  });

  it('the non-test sources never call the A003 registry/history write APIs', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    expect(sources.length).toBeGreaterThanOrEqual(7);
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
    const surfaceKeys = Object.keys(bodyForge);
    for (const forbidden of FORBIDDEN_EXPORTS) {
      expect(surfaceKeys, `public surface must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('closed vocabularies', () => {
  it('citation and capability kinds are closed frozen sets', () => {
    expect(MANIFEST_CITATION_KINDS).toEqual(['experiment-record', 'skill-draft']);
    expect(MANIFEST_CAPABILITY_KINDS).toEqual(['capability', 'sub-capability']);
    expect(Object.isFrozen(MANIFEST_CITATION_KINDS)).toBe(true);
    expect(Object.isFrozen(MANIFEST_CAPABILITY_KINDS)).toBe(true);
    expect(Object.isFrozen(BODY_FORGE_ERROR_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(BODY_FORGE_ERROR_CODES)).toBe(true);
  });

  it('the schema registry is closed and frozen', () => {
    expect(Object.isFrozen(BODY_FORGE_SCHEMAS)).toBe(true);
    expect(Object.keys(BODY_FORGE_SCHEMAS).every((name) => name.startsWith('body-forge/'))).toBe(true);
  });
});

describe('public-surface hygiene', () => {
  it('test-support is quarantined: its builders are not re-exported by the public surface', () => {
    const surfaceKeys = Object.keys(bodyForge);
    for (const builder of ['makeManifestInput', 'parentRefV1', 'TestLcg']) {
      expect(surfaceKeys).not.toContain(builder);
    }
  });

  it('the public surface declares no `any`', () => {
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

  it('default policy input is a fresh mutable object per call (no shared mutable state)', () => {
    const a = defaultForgePolicyInput();
    const b = defaultForgePolicyInput();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
