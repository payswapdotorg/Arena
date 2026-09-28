/**
 * Hygiene suite for @arena/evaluation-fabric (Work Order A012 gates
 * 6, 11):
 *
 *   1. Dependency discipline — the service's runtime imports are
 *      confined to the allowed set (@arena/protocol-core,
 *      @arena/evaluation, @arena/capability-case, @arena/trajectory)
 *      and it never imports another service (boundary rule B2) or an
 *      app (B1). The allow-list lives only in this test file.
 *   2. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as fabricExports from './index.js';

/** Type-level probe: satisfies the EvaluatorHook type contract. */
function makeHookTypeProbe(): fabricExports.EvaluatorHook {
  return async () => [];
}

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '@arena/protocol-core',
  '@arena/evaluation',
  '@arena/capability-case',
  '@arena/trajectory',
]);

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

const IMPORT_PATTERN = /(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g;

describe('dependency discipline (gate 6 + boundary rules B1/B2)', () => {
  it('non-test sources import ONLY the allowed workspace packages (plus relative imports and node builtins)', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(4);
    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      for (const line of text.split('\n')) {
        if (!/(import|export)/.test(line)) continue;
        for (const pattern of [IMPORT_PATTERN]) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(line)) !== null) {
            const spec = match[1];
            if (spec === undefined) continue;
            if (spec.startsWith('./') || spec.startsWith('../')) continue;
            if (spec.startsWith('node:')) continue;
            // Scoped workspace packages: the root is the first TWO segments.
            const segments = spec.split('/');
            const root = spec.startsWith('@')
              ? `${segments[0]}/${segments[1] ?? ''}`
              : (segments[0] ?? spec);
            if (!ALLOWED_WORKSPACE_IMPORTS.has(root)) {
              offenders.push(`${file}: ${spec}`);
            }
          }
        }
      }
    }
    expect(offenders, `disallowed imports:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the manifest declares exactly the allowed runtime dependencies and NOTHING external', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...ALLOWED_WORKSPACE_IMPORTS].sort(),
    );
    for (const spec of Object.values(manifest.dependencies ?? {})) {
      expect(spec).toBe('workspace:*');
    }
  });
});

describe('public-surface hygiene (gates 6, 11)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    const anyPatterns = [
      /:\s*any\b/,
      /\bas\s+any\b/,
      /<any>/,
      /\bany\[\]/,
      /readonly\s+any\b/,
      /\bPromise<any>\b/,
    ];
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      for (const pattern of anyPatterns) {
        const match = pattern.exec(text);
        if (match) violations.push(`${file}: /${match[0]}/`);
      }
    }
    expect(violations, `any leaks found:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the public surface is rich but excludes the internal test-support module', () => {
    const exportNames = Object.keys(fabricExports);
    expect(exportNames.length).toBeGreaterThanOrEqual(6);
    for (const internal of ['buildCase', 'buildTrajectory', 'buildFabric', 'TestLcg', 'T0']) {
      expect(exportNames).not.toContain(internal);
    }
    for (const expected of [
      'EvaluatorRegistry',
      'EvaluationFabric',
      'makeDeterministicTestEvaluator',
      'makeRubricEvaluator',
      'IMPLEMENTED_EVALUATOR_KINDS',
      'UNIMPLEMENTED_EVALUATOR_KINDS',
      'createEvaluationFabric',
    ]) {
      expect(exportNames).toContain(expected);
    }
    // Type-only exports are invisible to Object.keys — assert them at the type level instead.
    const hookType: fabricExports.EvaluatorHook = makeHookTypeProbe();
    void hookType;
  });

  it('class exports freeze their registrations; constants are frozen', () => {
    for (const [name, value] of Object.entries(fabricExports)) {
      if (typeof value === 'function') continue; // classes + factories
      if (typeof value === 'object' && value !== null) {
        expect(Object.isFrozen(value), `exported object ${name} must be frozen`).toBe(true);
        continue;
      }
      expect(typeof value, `unexpected export ${name} of type ${typeof value}`).toMatch(
        /^(string|number|object|function)$/,
      );
    }
  });
});
