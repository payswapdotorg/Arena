/**
 * Hygiene suite for @arena/trajectory-store (Work Order A011 gates 6, 7,
 * 11):
 *
 *   1. Storage-neutrality — no persistence-brand strings in the service's
 *      non-test sources or README (the reference store is in-process,
 *      zero external runtime dependencies; durable persistence is a
 *      deployment-tier concern).
 *   2. Dependency hygiene — only workspace dependencies, no external
 *      runtime dependencies.
 *   3. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; every exported
 *      object is frozen.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as store from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const STORAGE_SUBSTRING_DENY = [
  'postgres',
  'postgresql',
  'mongodb',
  'mysql',
  'mariadb',
  'cassandra',
  'scylladb',
  'dynamodb',
  'elasticsearch',
  'opensearch',
  'neo4j',
  'leveldb',
  'rocksdb',
  'duckdb',
  'clickhouse',
  'cockroach',
];
const STORAGE_WORD_DENY = ['redis', 'sqlite', 's3', 'gcs', 'dynamodb', 'bigtable', 'spanner'];

const SUBSTRING_PATTERN = new RegExp(`(?:${STORAGE_SUBSTRING_DENY.join('|')})`, 'i');
const WORD_PATTERN = new RegExp(`(?<![a-z0-9])(?:${STORAGE_WORD_DENY.join('|')})(?![a-z0-9])`, 'i');

function containsStorageBrand(text: string): boolean {
  return SUBSTRING_PATTERN.test(text) || WORD_PATTERN.test(text);
}

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

describe('storage-neutrality hygiene (gate 7 — the reference store is in-process)', () => {
  it('service non-test sources contain NO storage-brand strings', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsStorageBrand(text)) violations.push(file);
    }
    expect(violations, `storage-brand leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the service README, manifest and demo contain NO storage-brand strings', () => {
    for (const rel of ['README.md', 'package.json', 'main.mjs', 'ts-source-hooks.mjs']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!existsSync(path)) continue;
      const text = readFileSync(path, 'utf-8');
      expect(containsStorageBrand(text), `${rel} leaks a storage brand`).toBe(false);
    }
  });

  it('the scanner detects the deny-list tokens (negative control)', () => {
    expect(containsStorageBrand('postgres://localhost/db')).toBe(true);
    expect(containsStorageBrand('backed by redis')).toBe(true);
    expect(containsStorageBrand('an s3 bucket')).toBe(true);
    expect(containsStorageBrand('in-process reference store with Maps')).toBe(false);
    expect(containsStorageBrand('content-addressed append-only versions')).toBe(false);
  });
});

describe('dependency hygiene (gate 6 — zero external runtime deps)', () => {
  it('the manifest declares ONLY workspace dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    const dependencies = manifest.dependencies ?? {};
    expect(Object.keys(dependencies).length).toBe(2);
    for (const [name, spec] of Object.entries(dependencies)) {
      expect(name.startsWith('@arena/')).toBe(true);
      expect(spec).toBe('workspace:*');
    }
  });
});

describe('public-surface hygiene (gate 11 — no any leaks)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(2);
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

  it('the public surface exposes the store API and nothing internal', () => {
    const exportNames = Object.keys(store);
    for (const internal of [
      'makeStoreHeaderInput',
      'storeActionInput',
      'StoreTestLcg',
      'DIGEST_A',
      'T0',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
    for (const expected of [
      'TrajectoryStore',
      'createTrajectoryStore',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function or a frozen object constant', () => {
    for (const [name, value] of Object.entries(store)) {
      if (typeof value === 'function') continue;
      if (typeof value === 'object' && value !== null) {
        expect(Object.isFrozen(value), `exported object ${name} must be frozen`).toBe(true);
        continue;
      }
      expect(typeof value, `unexpected export ${name} of type ${typeof value}`).toMatch(
        /^(string|number|object|function)$/,
      );
    }
  });
});
