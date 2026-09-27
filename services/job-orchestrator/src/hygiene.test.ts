/**
 * Hygiene suite for services/job-orchestrator (Work Order A015 gate 12):
 *
 *   1. Public-surface hygiene — no `any` type leaks in the non-test sources.
 *   2. Provider-leakage hygiene — no provider-specific strings or
 *      credential-shaped words in the service's non-test sources.
 *   3. Import discipline — the service imports ONLY @arena/job-protocol,
 *      @arena/protocol-core, node: builtins and relative modules (the
 *      boundary checker enforces the same rule repo-wide; this is the
 *      in-package tripwire mirroring it).
 *
 * The deny-lists live only in this test file (the checker must not be part
 * of the scanned surface), mirroring the A002/A003 hygiene suites.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as jobOrchestrator from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Model/provider names and credential-shaped words (case-insensitive). */
const DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'gpt',
  'api[_-]?key',
  'secret',
  'token',
  'credential',
  'password',
  'bearer',
  'authorization',
];

const DENY_PATTERN = new RegExp(`(?:${DENY_LIST.join('|')})`, 'i');

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

describe('public-surface hygiene (gate 12 — no any leaks)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = nonTestSources();
    expect(sources.length).toBeGreaterThan(2);
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

  it('the public surface exports the orchestrator vocabulary', () => {
    const exportNames = Object.keys(jobOrchestrator);
    for (const expected of [
      'JobOrchestrator',
      'InMemoryJobStore',
      'InMemoryEventSink',
      'ManualClock',
      'SystemClock',
    ]) {
      expect(exportNames, `missing export ${expected}`).toContain(expected);
    }
  });
});

describe('provider-leakage hygiene (lock rules 10, 23)', () => {
  it('no deny-listed word appears in any non-test source', () => {
    const violations: string[] = [];
    for (const file of nonTestSources()) {
      const text = readFileSync(file, 'utf-8');
      const match = DENY_PATTERN.exec(text);
      if (match) violations.push(`${file}: /${match[0]}/i`);
    }
    expect(violations, `provider leakage detected:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects the deny-list words (self-test, negative control)', () => {
    expect(DENY_PATTERN.test('provider: "gpt-4o"')).toBe(true);
    expect(DENY_PATTERN.test('x-api-key: abc')).toBe(true);
    expect(DENY_PATTERN.test('Authorization: Bearer xyz')).toBe(true);
    // No false positives on this service's vocabulary:
    expect(DENY_PATTERN.test('orchestrator clock store sink retryDue timeoutDue')).toBe(false);
    expect(DENY_PATTERN.test('appendJobEvent appendAuditEvent lastAuditRecord')).toBe(false);
  });
});

describe('import discipline (service layer: domain + protocol only)', () => {
  it('imports are limited to job-protocol, protocol-core, node: and relative paths', () => {
    const sources = nonTestSources();
    expect(sources.length).toBeGreaterThan(2);
    const allowed = /^(@arena\/(job-protocol|protocol-core)|node:|\.{1,2}\/)/;
    const violations: string[] = [];
    const importPattern =
      /(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      for (const line of text.split('\n')) {
        if (!/(import|require)/.test(line)) continue;
        importPattern.lastIndex = 0;
        let match = importPattern.exec(line);
        while (match !== null) {
          const specifier = match[1] ?? match[2] ?? match[3];
          if (specifier !== undefined && !allowed.test(specifier)) {
            violations.push(`${file}: ${specifier}`);
          }
          match = importPattern.exec(line);
        }
      }
    }
    expect(violations, `forbidden imports:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package manifest declares exactly the two allowed workspace deps', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([
      '@arena/job-protocol',
      '@arena/protocol-core',
    ]);
    for (const spec of Object.values(manifest.devDependencies ?? {})) {
      expect(spec).toBe('catalog:');
    }
    expect(statSync(join(PACKAGE_ROOT, 'README.md'), { throwIfNoEntry: false })).toBeTruthy();
  });
});
