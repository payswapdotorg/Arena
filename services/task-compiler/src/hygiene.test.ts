/**
 * Hygiene suite (Work Order A008, service).
 *
 * Part 1 — no `any` in the service sources (AST-based).
 * Part 2 — provider/leakage vocabulary deny-list (lock rules 10, 23).
 * Part 3 — surface discipline: the public surface exposes NO case-mutating
 * compilation API and no removal API (compilation is a proposal; the case
 * is never mutated — lock rule 6).
 * Part 4 — layer purity: a SERVICE may import domain + protocol packages
 * only (@arena/task-spec, @arena/capability-case,
 * @arena/protocol-core) — never another service, never an app.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as serviceSurface from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

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

function nonTestSources(): string[] {
  return collectFiles(
    join(PACKAGE_ROOT, 'src'),
    (name) =>
      name.endsWith('.ts') &&
      !name.endsWith('.test.ts') &&
      name !== 'test-support.ts' &&
      name !== 'registry-fixtures.ts',
  );
}

function countAnyKeywordNodes(file: string): number {
  const source = readFileSync(file, 'utf-8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ES2022,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

describe('no `any` in the service sources (AST-based)', () => {
  it('the scan is wired: there are non-test sources to scan', () => {
    const files = nonTestSources();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some((file) => file.endsWith('fabric.ts'))).toBe(true);
  });

  it('no non-test source contains an `any` type node', () => {
    const violations: string[] = [];
    for (const file of nonTestSources()) {
      const count = countAnyKeywordNodes(file);
      if (count > 0) violations.push(`${file}: ${count} any-keyword node(s)`);
    }
    expect(violations, `any leaked into the service:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects any-keyword nodes (self-test, negative control)', () => {
    const synthetic = join(PACKAGE_ROOT, 'src', 'hygiene-selftest.tmp.ts');
    writeFileSync(synthetic, 'export const x: any = null;\n', 'utf-8');
    try {
      expect(countAnyKeywordNodes(synthetic)).toBe(1);
    } finally {
      rmSync(synthetic, { force: true });
    }
    const clean = join(PACKAGE_ROOT, 'src', 'compiler.ts');
    expect(countAnyKeywordNodes(clean)).toBe(0);
  });
});

const DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'gpt',
  'api[_-]?key',
  'credential',
  'password',
  'bearer',
  'authorization',
];

const DENY_PATTERN = new RegExp(`(?:${DENY_LIST.join('|')})`, 'i');

describe('provider-leakage hygiene (lock rules 10, 23)', () => {
  it('no deny-listed word appears in any non-test service source or the demo entry', () => {
    const files = [
      ...collectFiles(
        join(PACKAGE_ROOT, 'src'),
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
      ),
      ...collectFiles(PACKAGE_ROOT, (name) => name.endsWith('.mjs')),
    ];
    expect(files.length).toBeGreaterThanOrEqual(5);
    const violations: string[] = [];
    for (const file of files) {
      const match = DENY_PATTERN.exec(readFileSync(file, 'utf-8'));
      if (match) violations.push(`${file}: /${match[0]}/i`);
    }
    expect(violations, `provider leakage detected:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects the deny-list words (self-test, negative control)', () => {
    expect(DENY_PATTERN.test('provider: "gpt-4o"')).toBe(true);
    expect(DENY_PATTERN.test('correlationId and idempotencyKey')).toBe(false);
    expect(DENY_PATTERN.test('compile, pin, supersede, replay')).toBe(false);
  });
});

describe('surface discipline: compilation is a PROPOSAL (lock rule 6)', () => {
  it('the public surface exposes NO case-mutation, spec-removal or rewrite export', () => {
    const exports = Object.keys(serviceSurface);
    expect(exports.length).toBeGreaterThanOrEqual(5);
    const forbidden = exports.filter((name) =>
      /^(remove|delete|detach|drop|rewrite|clear|truncate|erase|mutate|update|set)[A-Z_]/.test(
        name,
      ),
    );
    expect(forbidden, `mutation-shaped exports found: ${forbidden.join(', ')}`).toEqual([]);
    // The positive half: the compile + pin + record surface exists.
    expect(exports).toContain('compileTarget');
    expect(exports).toContain('TaskSpecRegistry');
    expect(exports).toContain('TaskCompilerFabric');
  });

  it('test-support and registry-fixtures are NOT part of the public surface', () => {
    const exports = Object.keys(serviceSurface);
    expect(exports).not.toContain('validCaseInput');
    expect(exports).not.toContain('createFixtureSpecs');
  });
});

describe('layer purity: service imports domain + protocol packages only', () => {
  it('every package import is @arena/task-spec, @arena/capability-case or @arena/protocol-core', () => {
    const violations: string[] = [];
    const importPattern = /import\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
    for (const file of nonTestSources()) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[1] ?? '';
        if (specifier.startsWith('.')) continue;
        if (specifier.startsWith('node:')) continue;
        if (
          specifier === '@arena/task-spec' ||
          specifier === '@arena/capability-case' ||
          specifier === '@arena/protocol-core'
        ) {
          continue;
        }
        violations.push(`${file}: ${specifier}`);
      }
    }
    expect(
      violations,
      `forbidden service imports:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('package.json declares exactly the three workspace runtime dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@arena/capability-case',
      '@arena/protocol-core',
      '@arena/task-spec',
    ]);
    for (const spec of Object.values(manifest.dependencies ?? {})) {
      expect(spec).toBe('workspace:*');
    }
    for (const spec of Object.values(manifest.devDependencies ?? {})) {
      expect(spec === 'catalog:' || spec === 'workspace:*').toBe(true);
    }
  });

  it('zero external runtime dependencies (in-process reference implementation)', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    const external = Object.keys(manifest.dependencies ?? {}).filter(
      (name) => !name.startsWith('@arena/'),
    );
    expect(external).toEqual([]);
    expect(REPO_ROOT.length).toBeGreaterThan(0);
  });
});
