/**
 * Provider-leakage hygiene suite (architecture-lock rules 10, 23;
 * docs/architecture.md §17; Work Order A002 acceptance criterion 8).
 *
 * Scans the A002 exported surfaces — both packages' non-test sources, the
 * A002 contract generator, and the committed generated contracts — for a
 * deny-list of model/provider names and credential-shaped words. Any contact
 * fails the suite. The deny-list itself lives only in this test file (the
 * checker must not be part of the scanned surface), mirroring how
 * scripts/governance-check.py keeps its provider regex outside
 * packages/protocol-core.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

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

// Substring semantics (no \b): word boundaries would miss snake_case shapes
// like OPENAI_API_KEY, where '_' is a word character on both sides. The A002
// protocol vocabulary contains none of these substrings, so the scan is
// strictly stronger than a word-boundary scan.
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

function scannedSurfaces(): { label: string; files: string[] }[] {
  return [
    {
      label: 'packages/artifact-protocol/src (non-test sources)',
      files: collectFiles(
        join(REPO_ROOT, 'packages', 'artifact-protocol', 'src'),
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
      ),
    },
    {
      label: 'packages/provenance/src (non-test sources)',
      files: collectFiles(
        join(REPO_ROOT, 'packages', 'provenance', 'src'),
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
      ),
    },
    {
      label: 'packages/artifact-protocol/scripts (contract generator)',
      files: collectFiles(join(PACKAGE_ROOT, 'scripts'), (name) => name.endsWith('.mjs')),
    },
    {
      label: 'contracts/artifacts (committed canonical objects)',
      files: statSync(join(REPO_ROOT, 'contracts', 'artifacts'), { throwIfNoEntry: false })
        ? collectFiles(join(REPO_ROOT, 'contracts', 'artifacts'), (name) => name.endsWith('.json'))
        : [],
    },
  ];
}

describe('provider-leakage hygiene (lock rules 10, 23)', () => {
  it('every scanned surface is present and non-empty (the scan itself is wired)', () => {
    const surfaces = scannedSurfaces();
    expect(surfaces.length).toBe(4);
    expect(surfaces[0]?.files.length ?? 0).toBeGreaterThan(0);
    expect(surfaces[1]?.files.length ?? 0).toBeGreaterThan(0);
    expect(surfaces[2]?.files.length ?? 0).toBeGreaterThan(0);
    expect(surfaces[3]?.files.length ?? 0).toBe(22);
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
    expect(DENY_PATTERN.test('tenant-scoped principal, content digest, provenance')).toBe(false);
    expect(DENY_PATTERN.test('provenance-recorded-event schema registry')).toBe(false);
  });
});
