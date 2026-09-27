/**
 * Hygiene suite (Work Order A004, gate 12).
 *
 * Part 1 — no `any` in the public surface: every non-test TypeScript source
 * of the package is parsed with the TypeScript compiler API and walked for
 * TSAnyKeyword type nodes (the AST walk ignores comments, so prose cannot
 * false-positive the way a text scan would).
 *
 * Part 2 — provider/credential leakage (mirrors the A002 hygiene suite):
 * the non-test sources, the contract generator and the generated contracts
 * are scanned for a deny-list of model/provider names and credential-shaped
 * words. The deny-list lives only in this test file so the checker is never
 * part of the scanned surface.
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

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
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
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

describe('no `any` in the public surface (gate 12, AST-based)', () => {
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
    const clean = join(PACKAGE_ROOT, 'src', 'identifiers.ts');
    expect(countAnyKeywordNodes(clean)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Part 2: provider/credential leakage (mirrors the A002 hygiene suite)
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
// like OPENAI_API_KEY. The A004 protocol vocabulary contains none of these
// substrings, so the scan is strictly stronger than a word-boundary scan.
const DENY_PATTERN = new RegExp(`(?:${DENY_LIST.join('|')})`, 'i');

function scannedSurfaces(): { label: string; files: string[] }[] {
  return [
    {
      label: 'packages/capability-graph/src (non-test sources)',
      files: nonTestSources(),
    },
    {
      label: 'packages/capability-graph/scripts (contract generator)',
      files: collectFiles(join(PACKAGE_ROOT, 'scripts'), (name) => name.endsWith('.mjs')),
    },
    {
      label: 'contracts/capability (committed canonical objects)',
      files: statSync(join(REPO_ROOT, 'contracts', 'capability'), {
        throwIfNoEntry: false,
      })
        ? collectFiles(join(REPO_ROOT, 'contracts', 'capability'), (name) =>
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
    expect(surfaces[2]?.files.length ?? 0).toBe(18);
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
    expect(
      DENY_PATTERN.test('capability graph, decomposes-into, provenance, taxonomy'),
    ).toBe(false);
    expect(DENY_PATTERN.test('domain-pack-applied-event schema registry')).toBe(false);
  });
});
