/**
 * Provider-leakage hygiene suite — provenance side (architecture-lock rules
 * 10, 23; docs/architecture.md §17). Scans BOTH A002 packages' non-test
 * sources, the A002 contract generator and the committed contracts for the
 * deny-list; any contact fails. The deny-list words live only in test files
 * (never in the scanned surface). Duplicated from
 * packages/artifact-protocol/src/hygiene.test.ts by design: each package
 * owns its hygiene tripwire, so running either package's tests alone still
 * guards both surfaces.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

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
      label: 'packages/provenance/src (non-test sources)',
      files: collectFiles(
        join(REPO_ROOT, 'packages', 'provenance', 'src'),
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
      ),
    },
    {
      label: 'packages/artifact-protocol/src (non-test sources)',
      files: collectFiles(
        join(REPO_ROOT, 'packages', 'artifact-protocol', 'src'),
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
      ),
    },
    {
      label: 'contracts/artifacts (committed canonical objects)',
      files: statSync(join(REPO_ROOT, 'contracts', 'artifacts'), { throwIfNoEntry: false })
        ? collectFiles(join(REPO_ROOT, 'contracts', 'artifacts'), (name) =>
            name.endsWith('.json'),
          )
        : [],
    },
  ];
}

describe('provider-leakage hygiene — provenance (lock rules 10, 23)', () => {
  it('every scanned surface is present and non-empty (the scan itself is wired)', () => {
    const surfaces = scannedSurfaces();
    expect(surfaces.length).toBe(3);
    expect(surfaces[0]?.files.length ?? 0).toBeGreaterThan(0);
    expect(surfaces[1]?.files.length ?? 0).toBeGreaterThan(0);
    expect(surfaces[2]?.files.length ?? 0).toBe(22);
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
    expect(DENY_PATTERN.test('model: claude-3')).toBe(true);
    expect(DENY_PATTERN.test('OPENAI_API_KEY=...')).toBe(true);
    expect(DENY_PATTERN.test('secret value')).toBe(true);
    expect(DENY_PATTERN.test('credential leak')).toBe(true);
    // No false positives on provenance vocabulary:
    expect(DENY_PATTERN.test('provenance record with lineage edges')).toBe(false);
    expect(DENY_PATTERN.test('ancestors, descendants, topological order')).toBe(false);
    expect(DENY_PATTERN.test('transformation lineage and verification refs')).toBe(false);
  });
});
