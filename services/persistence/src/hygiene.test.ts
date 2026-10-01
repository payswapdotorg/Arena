/**
 * Hygiene suite (Work Order B002; architecture-lock rules 10, 23; the
 * provider-neutrality discipline of FT2.0 and AGENTS.md — the
 * observability/billing service precedent):
 *
 *   1. Provider leakage — NO provider name, credential-shaped word or
 *      fallback-shaped word appears in this SERVICE's non-test sources.
 *      The service is provider-neutral by construction: it depends on
 *      @arena/persistence ports only; hosted adapters are injected at
 *      composition time (apps / deployment wiring), never imported here.
 *   2. Workspace discipline — the only workspace dependency is
 *      @arena/persistence (the domain layer); NEVER a sibling service and
 *      NEVER an adapter (layer rules B2/B4: services sit above adapters
 *      and must not reach them).
 *   3. Boundary discipline — no source imports an adapter workspace.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const DENY_LIST = [
  // FT2.0 providers and adjacent vendor vocabulary
  'neon',
  'upstash',
  'apify',
  'vercel',
  'cloudflare',
  'amazon',
  'aws',
  'r2',
  's3',
  'postgres',
  'redis',
  // credential-shaped words
  'api_key',
  'api-key',
  'apikey',
  'secret',
  'credential',
  'password',
  'bearer',
  'token',
  // fallback-shaped words (FT2.0: no silent paid fallback is representable)
  'fallback',
  'paid',
  'upgrade',
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
  it('contains no provider names, credential-shaped words or fallback-shaped words', () => {
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

  it('uses no `any` in type positions in non-test sources', () => {
    const patterns = [
      /:\s*any\b/,
      /\bas\s+any\b/,
      /<any>/,
      /\bany\[\]/,
      /readonly\s+any\b/,
      /\bPromise<any>\b/,
    ];
    const violations: string[] = [];
    for (const file of nonTestSources()) {
      const text = readFileSync(file, 'utf-8');
      for (const pattern of patterns) {
        if (pattern.test(text)) violations.push(`${file}: ${String(pattern)}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('workspace discipline (layer rules B2/B4)', () => {
  it('the only workspace dependency is @arena/persistence', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@arena/persistence']);
  });

  it('no source imports a sibling service or an adapter workspace', () => {
    const offenders: string[] = [];
    for (const file of collectFiles(join(PACKAGE_ROOT, 'src'), (name) => name.endsWith('.ts'))) {
      const text = readFileSync(file, 'utf-8');
      for (const line of text.split('\n')) {
        if (!/(import|require)/.test(line)) continue;
        if (/@arena\/hosted/.test(line) || /@arena\/[a-z-]+-(service|adapter)/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
