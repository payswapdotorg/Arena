/**
 * Hygiene suite (Work Order A035; architecture-lock rules 10, 23):
 * provider-leakage + no-`any` scans over the service's non-test
 * sources. The deny-list lives only in this test file (the checker
 * must not be part of the scanned surface).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

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
  it('contains no provider names or sensitive-material words', () => {
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
