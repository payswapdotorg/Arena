/**
 * Hygiene suite (Work Order B002; architecture-lock rules 10, 23; the
 * provider-neutrality discipline of FT2.0 and AGENTS.md):
 *
 *   1. Provider purity — NO provider name, provider credential-shaped
 *      word, or fallback-shaped word appears in this package's non-test
 *      sources (mirroring the protocol-core G7 governance style; the
 *      deny-list lives only in this test file so the checker is never
 *      part of the scanned surface). Provider specifics live exclusively
 *      in adapters/hosted/*.
 *   2. Public-surface hygiene — no `any` type leaks in non-test sources.
 *   3. Export discipline — every exported object is frozen; the port /
 *      fake / contract-kit vocabulary is exported; test fixtures stay
 *      private.
 *   4. Workspace discipline — the only workspace runtime dependency is
 *      @arena/protocol-core; no contracts/ surface is shipped (B002 owns
 *      none).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as surface from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const SRC_DIR = join(PACKAGE_ROOT, 'src');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const NON_TEST_SOURCES = listSourceFiles(SRC_DIR);

/**
 * Provider names (the FT2.0 provider set plus infrastructure-vendor
 * vocabulary) and credential/fallback-shaped words. Substring semantics
 * (no word boundaries) — stronger than a word-boundary scan; the
 * persistence vocabulary contains none of these substrings.
 */
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

describe('provider purity (FT2.0 / G7 style)', () => {
  it('contains no provider names, credential-shaped words or fallback-shaped words', () => {
    const offenders: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const word of DENY_LIST) {
        if (text.includes(word)) offenders.push(`${file}: ${word}`);
      }
    }
    expect(NON_TEST_SOURCES.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it('ships no credential-shaped literals', () => {
    const literalPattern = new RegExp(
      `(?:${['gh' + 'p_', 'sk' + '-', 'AK' + 'IA'].join('|')})[A-Za-z0-9]{16,}`,
    );
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      if (literalPattern.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});

describe('public-surface hygiene', () => {
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
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        if (pattern.test(text)) violations.push(`${file}: ${String(pattern)}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('export discipline', () => {
  it('exports the B002 persistence vocabulary', () => {
    const expected = [
      // errors
      'PersistenceError',
      'PERSISTENCE_ERROR_CODES',
      'PERSISTENCE_ERROR_CATEGORIES',
      'fromPersistenceErrorStruct',
      'toPersistenceErrorStruct',
      'normalizeToPersistenceError',
      'isPersistenceError',
      // shared
      'isCoordinationKey',
      'toCoordinationKey',
      'isJsonSafeValue',
      'canonicalEqual',
      'deepFreeze',
      // capacity
      'PROVIDER_CAPACITY_STATUSES',
      'CAPACITY_EXHAUSTION_POLICY',
      'assertCapacityUsable',
      'deriveCapacityStatus',
      'aggregateProviderHealth',
      'PersistenceCapacityError',
      'toCapacitySnapshot',
      'toCapacityDimensionReading',
      'toProviderHealth',
      // ports
      'isBlobKey',
      'toBlobKey',
      'contentAddressedBlobKey',
      'computeBlobDigest',
      'validateBlobPutInput',
      'normalizeMigrationList',
      'windowStartFor',
      // fakes
      'FakeControlPlaneRepository',
      'FakeBlobStore',
      'FakeCoordinationStore',
      'FakeMigrationRunner',
      'FakeCapacityMeter',
      'ManualClock',
      'SystemClock',
      // testing kit
      'definePersistenceContractSuite',
      'defineControlPlaneRepositoryContractSuite',
      'defineBlobStoreContractSuite',
      'defineCoordinationStoreContractSuite',
      'defineMigrationRunnerContractSuite',
      'defineCapacityMeterContractSuite',
      // version
      'PERSISTENCE_VERSION',
    ];
    const names = Object.keys(surface);
    expect(names.length).toBeGreaterThan(50);
    for (const name of expected) {
      expect(names, `missing export ${name}`).toContain(name);
    }
  });

  it('every exported value is a function, frozen constant, string or number', () => {
    for (const [name, value] of Object.entries(surface)) {
      if (typeof value === 'function' || typeof value === 'string' || typeof value === 'number') {
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        expect(Object.isFrozen(value), `export ${name} must be frozen`).toBe(true);
        continue;
      }
      expect.unreachable(`export ${name} has an unexpected type: ${typeof value}`);
    }
  });
});

describe('workspace discipline', () => {
  it('the only workspace runtime dependency is @arena/protocol-core', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@arena/protocol-core']);
  });

  it('ships no contracts generator and no contract output (no contracts/ surface is owned)', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'scripts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'contracts', 'persistence'))).toBe(false);
  });
});
