/**
 * Hygiene suite (Work Order A035; architecture-lock rules 10, 23):
 *
 *   1. Public-surface hygiene — no `any` type leaks in the non-test
 *      sources (type-position scan).
 *   2. Provider-leakage hygiene — no provider-specific strings or
 *      credential-shaped words in the package's non-test sources
 *      (test-support.ts included — it is product-adjacent surface).
 *
 * The deny-list lives only in this test file (the checker must not be
 * part of the scanned surface), mirroring the A015/A034 hygiene suites.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
  'credential',
  'password',
  'bearer',
];

// Substring semantics (no \b): word boundaries would miss snake_case
// shapes like OPENAI_API_KEY. The observability vocabulary contains
// none of these substrings, so the scan is strictly stronger than a
// word-boundary scan.
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
  return collectFiles(join(PACKAGE_ROOT, 'src'), (name) =>
    name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
}

describe('provider-leakage hygiene (non-test sources)', () => {
  it('contains no provider names or credential-shaped words', () => {
    const files = nonTestSources();
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      const match = DENY_PATTERN.exec(text);
      if (match !== null) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('public-surface hygiene (no `any` type leaks)', () => {
  it('uses no `any` in type positions in non-test sources', () => {
    const ANY_PATTERN = /:\s*any\b|<any>|as\s+any\b/;
    const offenders: string[] = [];
    for (const file of nonTestSources()) {
      const text = readFileSync(file, 'utf-8');
      const lines = text.split('\n');
      for (const [index, line] of lines.entries()) {
        if (ANY_PATTERN.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
