/**
 * Hygiene suite (Work Order A017):
 *
 *   1. Domain purity — @arena/workbench's workspace imports are EXACTLY
 *      the six allowed specifiers: @arena/protocol-core (the protocol
 *      layer; runtime use confined to branded id constructors in the
 *      INTERNAL test fixtures) and the five domain packages it renders
 *      (expert-qualification, expert-registry, job-protocol, task-spec,
 *      trajectory). For the PACKAGE SOURCE (everything except tests and
 *      the fixture builder test-support.ts — the control-ui convention),
 *      domain-package imports must be TYPE-ONLY **except** the closed
 *      allow-list of structural guard predicates in views.ts
 *      (isExpertProfile, isCompetencyClaim, isQualificationRecord,
 *      isMatchResult, isTaskSpec, isCompilationRecord,
 *      isTrajectoryRecord, isJobRecord) — the disclosed, deliberate
 *      deviation that makes malformed-domain-object detection reuse the
 *      domain packages' own validation instead of reimplementing it.
 *   2. Public-surface hygiene — no `any` type leaks in non-test sources;
 *      test-support.ts is NOT imported by any non-test source; the
 *      package.json dependency surface matches the purity rule and has
 *      ZERO external runtime dependencies.
 *   3. No provider/credential material in source (shape-aware patterns:
 *      the plain prefix `sk-` would false-positive on `task-spec`, the
 *      package's own domain specifier).
 *
 * The deny-lists live only in this test file (the checker must not be
 * part of the scanned surface), mirroring the A018/A003/A016
 * conventions.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_ROOT = join(PACKAGE_ROOT, 'src');

/** The complete allow-list of workspace imports for this package. */
const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '@arena/protocol-core',
  '@arena/expert-qualification',
  '@arena/expert-registry',
  '@arena/job-protocol',
  '@arena/task-spec',
  '@arena/trajectory',
]);

/** Domain packages must be imported TYPE-ONLY, EXCEPT the guards below. */
const TYPE_ONLY_WORKSPACE_IMPORTS = new Set([
  '@arena/expert-qualification',
  '@arena/expert-registry',
  '@arena/job-protocol',
  '@arena/task-spec',
  '@arena/trajectory',
]);

/**
 * The closed allow-list of RUNTIME (value) imports permitted from the
 * domain packages: structural guard predicates only, and only in
 * views.ts (the malformed-domain-object boundary).
 */
const RUNTIME_GUARD_ALLOW_LIST: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    'views.ts',
    new Set([
      'isCompetencyClaim',
      'isMatchResult',
      'isQualificationRecord',
      'isExpertProfile',
      'isJobRecord',
      'isCompilationRecord',
      'isTaskSpec',
      'isTrajectoryRecord',
    ]),
  ],
]);

/** Model/provider brand names (case-insensitive substring semantics). */
const PROVIDER_DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'mistral',
  'groq',
  'ollama',
  'deepseek',
  'bedrock',
  'copilot',
];

/**
 * Credential-VALUE shapes (shape-aware, mirroring the A018 app-side
 * suite): key material is long and charset-constrained, so neutral
 * identifiers (task-spec, task-fixture-review) never match.
 */
const CREDENTIAL_DENY_PATTERN =
  /(ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9]{20,}|xoxb-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN|bearer\s|apikey|api-key|api_key|password=|secret=|authorization:)/i;

const PROVIDER_DENY_PATTERN = new RegExp(`(?:${PROVIDER_DENY_LIST.join('|')})`, 'i');

/** Collect files under src/ by filter (recursive). */
function collectFiles(filter: (name: string) => boolean): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(SRC_ROOT, { withFileTypes: true })) {
    const abs = join(SRC_ROOT, entry.name);
    if (entry.isDirectory()) continue;
    if (filter(entry.name) && statSync(abs).isFile()) files.push(entry.name);
  }
  return files;
}

/** Package source: everything except tests and the fixture builder. */
const PACKAGE_SOURCES = collectFiles(
  (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
);

/** Test layer: tests + the fixture builder. */
const TEST_LAYER = collectFiles(
  (name) => name.endsWith('.test.ts') || name === 'test-support.ts',
);

/** The workspace-import extractor (clause + specifier per import). */
const WORKSPACE_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+([^'"\n]*?)\s*(?:from\s*)?['"](@arena\/[a-z0-9-]+)['"]/g;

describe('hygiene — workspace import discipline', () => {
  it('package source imports ONLY the six allowed workspace specifiers (positive)', () => {
    expect(PACKAGE_SOURCES.length).toBeGreaterThan(5);
    const violations: string[] = [];
    for (const file of PACKAGE_SOURCES) {
      const text = readFileSync(join(SRC_ROOT, file), 'utf-8');
      WORKSPACE_IMPORT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WORKSPACE_IMPORT.exec(text)) !== null) {
        const specifier = match[2] ?? '';
        if (!ALLOWED_WORKSPACE_IMPORTS.has(specifier)) {
          violations.push(`${file}: forbidden workspace import (${specifier})`);
        }
      }
    }
    expect(violations, `purity violations:\n${violations.join('\n')}`).toEqual([]);
  });

  it('domain-package imports are TYPE-ONLY except the guard allow-list in views.ts (positive)', () => {
    const violations: string[] = [];
    for (const file of PACKAGE_SOURCES) {
      const text = readFileSync(join(SRC_ROOT, file), 'utf-8');
      const allowed = RUNTIME_GUARD_ALLOW_LIST.get(file) ?? new Set<string>();
      WORKSPACE_IMPORT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WORKSPACE_IMPORT.exec(text)) !== null) {
        const clause = match[1] ?? '';
        const specifier = match[2] ?? '';
        if (!TYPE_ONLY_WORKSPACE_IMPORTS.has(specifier)) continue;
        if (/^\s*type\b/.test(clause)) continue; // type-only: fine
        // A VALUE import: every named binding must be an allowed guard.
        const names = [...clause.matchAll(/\{([^}]*)\}/g)]
          .flatMap((braces) => (braces[1] ?? '').split(','))
          .map((name) => name.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
          .filter((name) => name.length > 0);
        for (const name of names) {
          if (!allowed.has(name)) {
            violations.push(
              `${file}: value import ${name} from ${specifier} (domain runtime imports are restricted to the structural-guard allow-list)`,
            );
          }
        }
      }
    }
    expect(violations, `purity violations:\n${violations.join('\n')}`).toEqual([]);
  });

  it('protocol-core runtime imports appear only in test-support (fixtures), never in the public surface', () => {
    const violations: string[] = [];
    for (const file of PACKAGE_SOURCES) {
      const text = readFileSync(join(SRC_ROOT, file), 'utf-8');
      WORKSPACE_IMPORT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WORKSPACE_IMPORT.exec(text)) !== null) {
        const clause = match[1] ?? '';
        const specifier = match[2] ?? '';
        if (specifier !== '@arena/protocol-core') continue;
        if (/^\s*type\b/.test(clause)) continue;
        violations.push(`${file}: runtime import from @arena/protocol-core`);
      }
    }
    expect(violations, `protocol-core runtime imports:\n${violations.join('\n')}`).toEqual([]);
  });

  it('test-layer files import only allow-listed workspace packages (any clause form)', () => {
    expect(TEST_LAYER.length).toBeGreaterThan(5);
    const violations: string[] = [];
    for (const file of TEST_LAYER) {
      const text = readFileSync(join(SRC_ROOT, file), 'utf-8');
      WORKSPACE_IMPORT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WORKSPACE_IMPORT.exec(text)) !== null) {
        const specifier = match[2] ?? '';
        if (!ALLOWED_WORKSPACE_IMPORTS.has(specifier)) {
          violations.push(`${file}: forbidden workspace import (${specifier})`);
        }
      }
    }
    expect(violations, `purity violations:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package.json dependency surface matches the purity rule', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([
      '@arena/expert-qualification',
      '@arena/expert-registry',
      '@arena/job-protocol',
      '@arena/protocol-core',
      '@arena/task-spec',
      '@arena/trajectory',
    ]);
    // ZERO external runtime dependencies.
    const external = Object.keys(pkg.dependencies ?? {}).filter(
      (name) => !name.startsWith('@arena/'),
    );
    expect(external).toEqual([]);
  });
});

describe('hygiene — public-surface discipline', () => {
  it('non-test sources never import the internal test fixtures', () => {
    for (const file of PACKAGE_SOURCES) {
      const text = readFileSync(join(SRC_ROOT, file), 'utf-8');
      expect(text.includes('test-support.js'), `${file} imports the internal test fixtures`).toBe(
        false,
      );
    }
    const index = readFileSync(join(SRC_ROOT, 'index.ts'), 'utf-8');
    expect(index).not.toContain('test-support');
  });

  it('no `any` type leaks in non-test sources (negative)', () => {
    const anyPatterns = [
      /:\s*any\b/,
      /\bas\s+any\b/,
      /<any>/,
      /\bany\[\]/,
      /readonly\s+any\b/,
      /\bPromise<any>\b/,
    ];
    const violations: string[] = [];
    for (const file of PACKAGE_SOURCES) {
      const text = readFileSync(join(SRC_ROOT, file), 'utf-8');
      for (const pattern of anyPatterns) {
        const match = pattern.exec(text);
        if (match) violations.push(`${file}: /${match[0]}/`);
      }
    }
    expect(violations, `any leaks found:\n${violations.join('\n')}`).toEqual([]);
  });

  it('non-test sources contain no provider or credential material (negative)', () => {
    const violations: string[] = [];
    for (const file of PACKAGE_SOURCES) {
      const text = readFileSync(join(SRC_ROOT, file), 'utf-8');
      const providerMatch = PROVIDER_DENY_PATTERN.exec(text);
      if (providerMatch) violations.push(`${file}: provider /${providerMatch[0]}/i`);
      const credentialMatch = CREDENTIAL_DENY_PATTERN.exec(text);
      if (credentialMatch) violations.push(`${file}: credential /${credentialMatch[0]}/i`);
    }
    expect(violations, `leaks found:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package publishes one entry through src/index.ts', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
      exports?: Record<string, { types?: string; default?: string }>;
    };
    expect(Object.keys(pkg.exports ?? {})).toEqual(['.']);
    expect(pkg.exports?.['.']?.default).toBe('./src/index.ts');
    expect(
      statSync(join(SRC_ROOT, 'index.ts'), { throwIfNoEntry: false })?.isFile(),
    ).toBe(true);
  });

  it('the scanner itself detects deny-list material (self-test, negative control)', () => {
    expect(PROVIDER_DENY_PATTERN.test('model: "claude-3"')).toBe(true);
    expect(PROVIDER_DENY_PATTERN.test('openai/gpt-4o')).toBe(true);
    expect(CREDENTIAL_DENY_PATTERN.test('token: ghp_abc123def456ghi789')).toBe(true);
    expect(CREDENTIAL_DENY_PATTERN.test('key: sk-abcdefghijklmnopqrstuvwx')).toBe(true);
    // No false positives on this package's own vocabulary:
    expect(CREDENTIAL_DENY_PATTERN.test('@arena/task-spec TaskSpec task-fixture-review')).toBe(
      false,
    );
    expect(PROVIDER_DENY_PATTERN.test('substrate adapter digest trajectory')).toBe(false);
  });
});
