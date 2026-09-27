/**
 * Hygiene suite (Work Order A005 gate 11).
 *
 * Part 1 — no `any` in the public surface: every non-test TypeScript source
 * of the package is parsed with the TypeScript compiler API and walked for
 * TSAnyKeyword type nodes (the AST walk ignores comments, so prose cannot
 * false-positive the way a text scan would).
 *
 * Part 2 — provider/credential leakage (mirrors the A002/A004 hygiene
 * suites): the non-test sources, the contract generator and the generated
 * contracts are scanned for a deny-list of model/provider names and
 * credential-shaped words. The deny-list lives only in this test file so
 * the checker is never part of the scanned surface.
 *
 * Part 3 — evidence-discipline surface assertion (gate 6, lock rule 6): the
 * package's public export surface must contain NO evidence-removal or
 * history-rewriting API. Evidence can only be attached; there is no
 * removeEvidence / detachEvidence / rewriteHistory / deleteEvent.
 *
 * Part 4 — domain purity (gate 10): the package's runtime imports come from
 * @arena/protocol-core and its own modules ONLY (no sibling domain package,
 * no external package).
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as packageSurface from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

// ---------------------------------------------------------------------------
// Part 1: no `any` in the public surface (AST-based)
// ---------------------------------------------------------------------------

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
      name !== 'test-support.ts',
  );
}

/** Count TSAnyKeyword nodes in a source file (comments excluded by the AST). */
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

describe('no `any` in the public surface (gate 11, AST-based)', () => {
  it('the scan is wired: there are non-test sources to scan', () => {
    const files = nonTestSources();
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.some((file) => file.endsWith('index.ts'))).toBe(true);
  });

  it('no non-test source contains an `any` type node', () => {
    const violations: string[] = [];
    for (const file of nonTestSources()) {
      const count = countAnyKeywordNodes(file);
      if (count > 0) violations.push(`${file}: ${count} any-keyword node(s)`);
    }
    expect(violations, `any leaked into the public surface:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects any-keyword nodes (self-test, negative control)', () => {
    // A synthetic source with an explicit any must be counted...
    const synthetic = join(PACKAGE_ROOT, 'src', 'hygiene-selftest.tmp.ts');
    writeFileSync(synthetic, 'export const x: any = null;\n', 'utf-8');
    try {
      expect(countAnyKeywordNodes(synthetic)).toBe(1);
    } finally {
      rmSync(synthetic, { force: true });
    }
    // ...and clean sources must count zero.
    const clean = join(PACKAGE_ROOT, 'src', 'timestamp.ts');
    expect(countAnyKeywordNodes(clean)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Part 2: provider/credential leakage (lock rules 10, 23)
// ---------------------------------------------------------------------------

/** Model/provider names and credential-shaped words (case-insensitive). */
const DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'gpt',
  'api[_-]?key',
  'secret',
  'credential',
  'password',
  'bearer',
  'authorization',
];

// Substring semantics (no \b): word boundaries would miss snake_case shapes
// like OPENAI_API_KEY.
const DENY_PATTERN = new RegExp(`(?:${DENY_LIST.join('|')})`, 'i');

function scannedSurfaces(): { label: string; files: string[] }[] {
  return [
    {
      label: 'packages/capability-case/src (non-test sources + test-support)',
      files: collectFiles(
        join(PACKAGE_ROOT, 'src'),
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
      ),
    },
    {
      label: 'packages/capability-case/scripts (contract generator)',
      files: collectFiles(join(PACKAGE_ROOT, 'scripts'), (name) => name.endsWith('.mjs')),
    },
    {
      label: 'contracts/capability-case (committed canonical objects)',
      files: statSync(join(REPO_ROOT, 'contracts', 'capability-case'), {
        throwIfNoEntry: false,
      })
        ? collectFiles(join(REPO_ROOT, 'contracts', 'capability-case'), (name) =>
            name.endsWith('.json'),
          )
        : [],
    },
  ];
}

describe('provider-leakage hygiene (lock rules 10, 23)', () => {
  it('every scanned surface is present and non-empty (the scan itself is wired)', () => {
    const surfaces = scannedSurfaces();
    expect(surfaces.length).toBe(3);
    expect(surfaces[0]?.files.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(surfaces[1]?.files.length ?? 0).toBe(1);
    expect(surfaces[2]?.files.length ?? 0).toBe(29);
  });

  it('no deny-listed model/provider or credential word appears in any scanned file', () => {
    const violations: string[] = [];
    for (const surface of scannedSurfaces()) {
      for (const file of surface.files) {
        const text = readFileSync(file, 'utf-8');
        const match = DENY_PATTERN.exec(text);
        if (match) {
          violations.push(`${file}: /${match[0]}/i`);
        }
      }
    }
    expect(violations, `provider leakage detected:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects the deny-list words (self-test, negative control)', () => {
    expect(DENY_PATTERN.test('provider: "gpt-4o"')).toBe(true);
    expect(DENY_PATTERN.test('x-api-key: abc')).toBe(true);
    expect(DENY_PATTERN.test('the apiKey was leaked')).toBe(true);
    expect(DENY_PATTERN.test('bearer of good news')).toBe(true);
    // No false positives on protocol vocabulary:
    expect(DENY_PATTERN.test('correlationId and idempotencyKey and canonical JSON')).toBe(false);
    expect(DENY_PATTERN.test('capability case, supersession, triage, provenance')).toBe(false);
    expect(DENY_PATTERN.test('tenant scope, observed failure, evidence append-only')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 3: evidence-discipline surface assertion (gate 6, lock rule 6)
// ---------------------------------------------------------------------------

describe('evidence discipline: no removal/rewrite API exists (gate 6)', () => {
  it('the public surface exposes NO evidence-removal or history-rewrite export', () => {
    const exports = Object.keys(packageSurface);
    expect(exports.length).toBeGreaterThan(50);
    const forbidden = exports.filter((name) =>
      /^(remove|delete|detach|drop|rewrite|clear|truncate|erase)/i.test(name),
    );
    expect(
      forbidden,
      `evidence-removal-shaped exports found: ${forbidden.join(', ')}`,
    ).toEqual([]);
    // The positive half of the discipline: attachEvidence EXISTS.
    expect(exports).toContain('attachEvidence');
    expect(exports).toContain('assertAppendOnly');
    expect(exports).toContain('assertNoDuplicateEvidence');
  });

  it('evidence-attached is the only evidence-mutating lifecycle event kind', () => {
    expect(packageSurface.CASE_LIFECYCLE_EVENT_KINDS).toContain('evidence-attached');
    const evidenceKinds = packageSurface.CASE_LIFECYCLE_EVENT_KINDS.filter((kind) =>
      /evidence/i.test(kind),
    );
    expect(evidenceKinds).toEqual(['evidence-attached']);
  });
});

// ---------------------------------------------------------------------------
// Part 4: domain purity (gate 10)
// ---------------------------------------------------------------------------

describe('domain purity: imports ONLY @arena/protocol-core (gate 10)', () => {
  it('every runtime import in non-test sources is protocol-core or local', () => {
    const violations: string[] = [];
    const importPattern = /import\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
    for (const file of nonTestSources()) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[1] ?? '';
        if (specifier.startsWith('.')) continue; // local module
        if (specifier === '@arena/protocol-core') continue; // the one allowed package
        if (specifier.startsWith('node:')) continue; // never used, but not a domain import
        violations.push(`${file}: ${specifier}`);
      }
    }
    expect(
      violations,
      `forbidden imports found (domain packages must import ONLY @arena/protocol-core):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('package.json declares exactly one runtime dependency: @arena/protocol-core', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@arena/protocol-core']);
    expect(manifest.dependencies?.['@arena/protocol-core']).toBe('workspace:*');
    for (const spec of Object.values(manifest.devDependencies ?? {})) {
      expect(spec === 'catalog:' || spec === 'workspace:*').toBe(true);
    }
  });
});
