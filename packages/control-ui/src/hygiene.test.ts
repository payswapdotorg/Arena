/**
 * Hygiene suite (Work Order A018, gates 8 and 10):
 *
 *   1. Domain purity — @arena/control-ui's workspace imports are EXACTLY
 *      the six allowed specifiers: @arena/protocol-core (the protocol
 *      layer) and the five domain packages it consumes (agent-body,
 *      capability-case, environment-protocol, job-protocol,
 *      model-substrate). Domain-package imports must be TYPE-ONLY (this
 *      package projects and renders; it never executes domain logic).
 *   2. Public-surface hygiene — no `any` type leaks in non-test sources.
 *   3. No provider/credential strings in source (gate 9, source side).
 *
 * The deny-lists live only in this test file (the checker must not be
 * part of the scanned surface), mirroring the A003/A016 conventions.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The complete allow-list of workspace imports for this package. */
const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '@arena/protocol-core',
  '@arena/agent-body',
  '@arena/capability-case',
  '@arena/environment-protocol',
  '@arena/job-protocol',
  '@arena/model-substrate',
]);

/** Domain packages must be imported TYPE-ONLY (projection, not execution). */
const TYPE_ONLY_WORKSPACE_IMPORTS = new Set([
  '@arena/agent-body',
  '@arena/capability-case',
  '@arena/environment-protocol',
  '@arena/job-protocol',
  '@arena/model-substrate',
]);

/** Model/provider brand names (case-insensitive substring semantics). */
const PROVIDER_DENY_LIST = [
  'openai',
  'anthropic',
  'gpt-',
  'claude',
  'gemini',
  'mistral',
  'groq',
  'ollama',
  'deepseek',
  'bedrock',
  'copilot',
];

const CREDENTIAL_DENY_LIST = [
  'ghp_',
  'github_pat_',
  'sk-',
  'xoxb-',
  'AKIA',
  '-----BEGIN',
  'apikey',
  'api-key',
  'api_key',
  'password=',
  'secret=',
];

const PROVIDER_DENY_PATTERN = new RegExp(`(?:${PROVIDER_DENY_LIST.join('|')})`, 'i');
const CREDENTIAL_DENY_PATTERN = new RegExp(`(?:${CREDENTIAL_DENY_LIST.join('|')})`, 'i');

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

describe('domain purity (gate 8 — workspace imports)', () => {
  it('package source imports ONLY the protocol package and the five consumed domain packages, domain type-only', () => {
    // The strict rule covers the PACKAGE SOURCE: everything except tests
    // and the test fixture builder (test-support.ts) — the test layer
    // legitimately constructs domain fixtures through the domain packages'
    // public constructors and re-verifies their digests.
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    expect(sources.length).toBeGreaterThan(5);
    const violations: string[] = [];
    const workspaceImport =
      /(?:^|\n)\s*(import|export)\s+([^'"\n]*?)\s*(?:from\s*)?['"](@arena\/[a-z0-9-]+)['"]/g;
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      workspaceImport.lastIndex = 0;
      while ((match = workspaceImport.exec(text)) !== null) {
        const clause = match[2] ?? '';
        const specifier = match[3] ?? '';
        if (!ALLOWED_WORKSPACE_IMPORTS.has(specifier)) {
          violations.push(`${file}: forbidden workspace import (${specifier})`);
          continue;
        }
        if (TYPE_ONLY_WORKSPACE_IMPORTS.has(specifier) && !/^\s*type\b/.test(clause)) {
          violations.push(`${file}: non-type domain-package import (${specifier})`);
        }
      }
    }
    expect(violations, `purity violations:\n${violations.join('\n')}`).toEqual([]);
  });

  it('test-layer files import only allow-listed workspace packages (any clause form)', () => {
    const testLayer = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.test.ts') || name === 'test-support.ts',
    );
    expect(testLayer.length).toBeGreaterThan(5);
    const violations: string[] = [];
    const workspaceImport =
      /(?:^|\n)\s*(?:import|export)\s+[^'"\n]*?\s*(?:from\s*)?['"](@arena\/[a-z0-9-]+)['"]/g;
    for (const file of testLayer) {
      const text = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      workspaceImport.lastIndex = 0;
      while ((match = workspaceImport.exec(text)) !== null) {
        const specifier = match[1] ?? '';
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
      '@arena/agent-body',
      '@arena/capability-case',
      '@arena/environment-protocol',
      '@arena/job-protocol',
      '@arena/model-substrate',
      '@arena/protocol-core',
    ]);
    // ZERO external runtime dependencies.
    const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@arena/'));
    expect(external).toEqual([]);
  });

  it('the scanner itself detects deny-list words (self-test, negative control)', () => {
    expect(PROVIDER_DENY_PATTERN.test('model: "claude-3"')).toBe(true);
    expect(PROVIDER_DENY_PATTERN.test('openai/gpt-4o')).toBe(true);
    expect(CREDENTIAL_DENY_PATTERN.test('token: ghp_abc123')).toBe(true);
    // No false positives on this package's vocabulary:
    expect(PROVIDER_DENY_PATTERN.test('substrate adapter digest trajectory')).toBe(false);
    expect(CREDENTIAL_DENY_PATTERN.test('idempotencyKey correlationId')).toBe(false);
  });
});

describe('public-surface hygiene (gate 10 — no any leaks)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(5);
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

  it('non-test sources contain no provider or credential strings (gate 9)', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
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
    expect(statSync(join(PACKAGE_ROOT, 'src', 'index.ts'), { throwIfNoEntry: false })?.isFile()).toBe(
      true,
    );
  });
});
