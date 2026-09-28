/**
 * Hygiene suite (Work Order A006 gates 11 and 12).
 *
 * Part 1 — no `any` in the public surface: every non-test TypeScript source
 * of the package is parsed with the TypeScript compiler API and walked for
 * TSAnyKeyword type nodes (the AST walk ignores comments, so prose cannot
 * false-positive the way a text scan would).
 *
 * Part 2 — provider/credential leakage (mirrors the A002/A004/A005
 * hygiene suites): the non-test sources, the contract generator and the
 * generated contracts are scanned for a deny-list of model/provider names
 * and secret-shaped words. The deny-list lives only in this test file so
 * the checker is never part of the scanned surface. NOTE: unlike the
 * sibling suites, this list deliberately EXCLUDES the bare words
 * 'credential' and 'authorization' — @arena/expert-registry's domain
 * vocabulary is PROFESSIONAL credentials (§8 qualifications) and the
 * lock-rule-9 screen's documentation legitimately names the
 * authorization boundary it rejects; neither is a provider/secret leak.
 * Secret-shaped compounds (api-key, password, bearer, private-key) and
 * every model/provider name remain denied.
 *
 * Part 3 — separation-of-concerns surface assertion (gate 3, lock rule 9):
 * the package's public export surface must contain NO authorization-shaped
 * API (grant/revoke/authorize/permit/…) and NO removal/rewrite API
 * (removeEvidence / deleteTaskHistory / rewriteHistory / …). Evidence,
 * task history and reliability are append-only; authorization is a
 * separate future protocol.
 *
 * Part 4 — domain purity (gate 11): the package's runtime imports come from
 * @arena/protocol-core and its own modules ONLY (no sibling domain
 * package, no external package).
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

describe('no `any` in the public surface (gate 12, AST-based)', () => {
  it('the scan is wired: there are non-test sources to scan', () => {
    const files = nonTestSources();
    expect(files.length).toBeGreaterThanOrEqual(20);
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
// Part 2: provider/secret leakage (lock rules 10, 23)
// ---------------------------------------------------------------------------

/**
 * Model/provider names and secret-shaped words (case-insensitive). See the
 * module doc for the two deliberate exclusions ('credential' in the
 * professional sense, 'authorization' in screen prose).
 */
const DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'gpt',
  'api[_-]?key',
  'apikey',
  'secret',
  'password',
  'passwd',
  'bearer',
  'private[_-]?key',
  'access[_-]?token',
  'session[_-]?token',
];

// Substring semantics (no \b): word boundaries would miss snake_case shapes
// like OPENAI_API_KEY.
const DENY_PATTERN = new RegExp(`(?:${DENY_LIST.join('|')})`, 'i');

function scannedSurfaces(): { label: string; files: string[] }[] {
  return [
    {
      label: 'packages/expert-registry/src (non-test sources + test-support)',
      files: collectFiles(
        join(PACKAGE_ROOT, 'src'),
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
      ),
    },
    {
      label: 'packages/expert-registry/scripts (contract generator)',
      files: collectFiles(join(PACKAGE_ROOT, 'scripts'), (name) => name.endsWith('.mjs')),
    },
    {
      label: 'contracts/expert (committed canonical objects)',
      files: statSync(join(REPO_ROOT, 'contracts', 'expert'), {
        throwIfNoEntry: false,
      })
        ? collectFiles(join(REPO_ROOT, 'contracts', 'expert'), (name) => name.endsWith('.json'))
        : [],
    },
  ];
}

describe('provider-leakage hygiene (lock rules 10, 23)', () => {
  it('every scanned surface is present and non-empty (the scan itself is wired)', () => {
    const surfaces = scannedSurfaces();
    expect(surfaces.length).toBe(3);
    expect(surfaces[0]?.files.length ?? 0).toBeGreaterThanOrEqual(21);
    expect(surfaces[1]?.files.length ?? 0).toBe(1);
    expect(surfaces[2]?.files.length ?? 0).toBe(41);
  });

  it('no deny-listed model/provider or secret word appears in any scanned file', () => {
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
    expect(violations, `provider/secret leakage detected:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects the deny-list words (self-test, negative control)', () => {
    expect(DENY_PATTERN.test('provider: "gpt-4o"')).toBe(true);
    expect(DENY_PATTERN.test('x-api-key: abc')).toBe(true);
    expect(DENY_PATTERN.test('the apiKey was leaked')).toBe(true);
    expect(DENY_PATTERN.test('password: hunter2')).toBe(true);
    expect(DENY_PATTERN.test('Bearer abc123')).toBe(true);
    // No false positives on this package's protocol vocabulary:
    expect(DENY_PATTERN.test('correlationId and idempotencyKey and canonical JSON')).toBe(false);
    expect(DENY_PATTERN.test('professional credential reference, qualification status')).toBe(false);
    expect(DENY_PATTERN.test('tenant scope, reliability ledger, supersession')).toBe(false);
    expect(
      DENY_PATTERN.test('authorization is a separate future protocol (lock rule 9)'),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 3: separation-of-concerns + append-only surface assertion (gates 3, 6, 7)
// ---------------------------------------------------------------------------

describe('separation of concerns: no authorization and no removal API (gate 3, lock rule 9)', () => {
  it('the public surface exposes NO authorization-shaped export', () => {
    const exports = Object.keys(packageSurface);
    expect(exports.length).toBeGreaterThan(80);
    const forbidden = exports.filter((name) =>
      /^(grant|revoke|authorize|authorise|assign|permit|allow|deny|elevate|impersonate|delegate)/i.test(
        name,
      ),
    );
    expect(
      forbidden,
      `authorization-shaped exports found (authorization is a separate future protocol — lock rule 9): ${forbidden.join(', ')}`,
    ).toEqual([]);
  });

  it('the public surface exposes NO removal or history-rewriting export', () => {
    const exports = Object.keys(packageSurface);
    const forbidden = exports.filter((name) =>
      /^(remove|delete|detach|drop|rewrite|clear|truncate|erase|retract|withdraw)/i.test(name),
    );
    expect(
      forbidden,
      `removal/rewrite-shaped exports found (evidence/task/reliability history is append-only — lock rule 6): ${forbidden.join(', ')}`,
    ).toEqual([]);
    // The positive half of the discipline: the append APIs EXIST.
    expect(exports).toContain('attachExpertEvidence');
    expect(exports).toContain('recordTaskHistory');
    expect(exports).toContain('recordReliabilityOutcome');
    expect(exports).toContain('appendReliabilityEntry');
    expect(exports).toContain('assertProfileHistoryAppendOnly');
    expect(exports).toContain('assertTaskHistoryAppendOnly');
    expect(exports).toContain('assertReliabilityAppendOnly');
  });

  it('the separation-of-concerns screens are exported and load-bearing', () => {
    expect(exports0f(packageSurface)).toContain('assertScreenedInput');
    expect(exports0f(packageSurface)).toContain('assertScreenedDeclaredName');
    expect(exports0f(packageSurface)).toContain('AUTHORITY_SCREEN_STEMS');
    expect(exports0f(packageSurface)).toContain('PII_SCREEN_EXACT');
    expect(packageSurface.EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED).toBe(
      'EXPERT_AUTHORITY_FIELD_REJECTED',
    );
    expect(packageSurface.EXPERT_ERROR_CODES.PII_FIELD_REJECTED).toBe(
      'EXPERT_PII_FIELD_REJECTED',
    );
  });

  it('reliability-recorded is the only reliability-mutating lifecycle event kind', () => {
    expect(packageSurface.EXPERT_LIFECYCLE_EVENT_KINDS).toContain('reliability-recorded');
    const reliabilityKinds = packageSurface.EXPERT_LIFECYCLE_EVENT_KINDS.filter((kind) =>
      /reliability/i.test(kind),
    );
    expect(reliabilityKinds).toEqual(['reliability-recorded']);
    // Counters are derived: the only metrics producer is the recompute fold.
    expect(exports0f(packageSurface)).toContain('recomputeReliabilityMetrics');
    expect(exports0f(packageSurface)).toContain('assertMetricsMatchLedger');
  });
});

function exports0f(surface: typeof packageSurface): string[] {
  return Object.keys(surface);
}

// ---------------------------------------------------------------------------
// Part 4: domain purity (gate 11)
// ---------------------------------------------------------------------------

describe('domain purity: imports ONLY @arena/protocol-core (gate 11)', () => {
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
