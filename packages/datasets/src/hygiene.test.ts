/**
 * Hygiene suite (Work Order A014, packages/datasets):
 *
 *   1. PURITY NEGATIVES — @arena/datasets is dataset PACKAGING, NOT object
 *      storage: no filesystem, network, database or process-state
 *      vocabulary may appear in the non-test sources (the deny-list lives
 *      only in this test file — the checker must not be part of the
 *      scanned surface, mirroring the house hygiene suites).
 *   2. Public-surface hygiene — no `any` in the non-test sources; the
 *      internal test-support module is not exported; every exported object
 *      is frozen; the surface is rich (the domain symbols are present).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as datasets from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Storage/persistence vocabulary (case-insensitive). The reference store
 * pattern (in-process Maps, deployment-tier persistence) means src/ must
 * never mention concrete storage backends or I/O APIs.
 */
const PURITY_DENY = [
  '\\bnode:fs\\b',
  "from 'fs'",
  '\\breadfilesync\\b',
  '\\bwritefilesync\\b',
  '\\bmkdirsync\\b',
  '\\breaddirsync\\b',
  '\\brmsync\\b',
  'fetch\\(',
  'http://request',
  'prismaclient',
  '\\bsqlite',
  '\\bpostgres',
  '\\bmysql',
  'redis\\.',
  'process\\.env',
  'math\\.random',
];

const PURITY_PATTERN = new RegExp(`(?:${PURITY_DENY.join('|')})`, 'i');

function containsStorageVocabulary(text: string): boolean {
  return PURITY_PATTERN.test(text);
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

describe('purity negatives (datasets = packaging, NOT object storage)', () => {
  it('the package non-test sources contain NO storage/IO vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(6);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsStorageVocabulary(text)) violations.push(file);
    }
    expect(violations, `storage vocabulary leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the committed generated contracts contain NO storage vocabulary', () => {
    const contractFiles = collectFiles(
      join(REPO_ROOT, 'contracts', 'dataset'),
      (name) => name.endsWith('.json'),
    );
    expect(contractFiles).toHaveLength(6);
    const violations: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(file, 'utf-8');
      if (containsStorageVocabulary(text)) violations.push(file);
    }
    expect(violations, `storage vocabulary leakage in contracts:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package README and manifest stay storage-neutral in backend mentions', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      const text = readFileSync(path, 'utf-8');
      // The README explicitly says what the package is NOT (not object
      // storage) — that disclaimer is allowed; concrete backend names are
      // not. Remove the explicit disclaimer sentence before scanning.
      const cleaned = text.replace(/not object storage[^.]*\./gi, '');
      const violations: string[] = [];
      for (const token of ['prisma', 'sqlite', 'postgres', 'mysql', 'redis', 'fetch(']) {
        if (cleaned.toLowerCase().includes(token)) violations.push(token);
      }
      expect(violations, `${rel} leaks concrete backend vocabulary`).toEqual([]);
    }
  });

  it('the scanner itself detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsStorageVocabulary("import { readFileSync } from 'node:fs'")).toBe(true);
    expect(containsStorageVocabulary('const db = new PrismaClient()')).toBe(true);
    expect(containsStorageVocabulary('await fetch(url)')).toBe(true);
    expect(containsStorageVocabulary('process.env.DATABASE_URL')).toBe(true);
    expect(containsStorageVocabulary('const client = redis.createClient()')).toBe(true);
    // No false positives on this package's (spec-mandated) vocabulary:
    expect(containsStorageVocabulary('in-process reference store')).toBe(false);
    expect(containsStorageVocabulary('content-addressed manifest digest')).toBe(false);
    expect(containsStorageVocabulary('resolver returns null for unknown refs')).toBe(false);
    expect(containsStorageVocabulary('redistribution policy: tenant-only')).toBe(false);
    expect(containsStorageVocabulary('$schema: https://json-schema.org')).toBe(false);
  });
});

describe('public-surface hygiene (no any leaks, frozen exports, rich surface)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(6);
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

  it('the public surface excludes the internal test-support module', () => {
    const exportNames = Object.keys(datasets);
    for (const internal of [
      'makeArtifact',
      'makeManifestInput',
      'refOf',
      'TestLcg',
      'RIGHTS',
      'CREATOR_A',
      'TENANT_A',
      'TENANT_B',
      'T0',
    ]) {
      expect(exportNames, `test-support symbol ${internal} leaked`).not.toContain(internal);
    }
  });

  it('the public surface is rich (the domain symbols are exported)', () => {
    const exportNames = Object.keys(datasets);
    expect(exportNames.length).toBeGreaterThan(45);
    for (const expected of [
      'DATASET_ENTRY_ROLES',
      'toDatasetEntryRole',
      'toDatasetEntry',
      'toDatasetEntries',
      'datasetEntryKey',
      'DATASET_MANIFEST_VERSION',
      'createDatasetManifest',
      'isDatasetManifest',
      'verifyDatasetManifest',
      'computeDatasetEntriesChecksum',
      'computeDatasetManifestDigest',
      'datasetManifestView',
      'DATASET_BUNDLE_VERSION',
      'resolveDatasetBundle',
      'verifyDatasetBundle',
      'isDatasetBundle',
      'computeDatasetBundleDigest',
      'datasetBundleView',
      'DATASET_VERSION_FIELDS',
      'toDatasetVersion',
      'isDatasetVersion',
      'DatasetVersionRegistry',
      'deriveDatasetManifest',
      'datasetManifestRef',
      'DATASET_DERIVATION_RELATIONS',
      'DATASET_ERROR_CODES',
      'DatasetError',
      'isDatasetError',
      'fromDatasetErrorStruct',
      'toDatasetErrorStruct',
      'normalizeToDatasetError',
      'DATASET_SCHEMAS',
      'datasetSchemaRef',
      'isKnownDatasetSchema',
      'DATASET_PROTOCOL_VERSION',
      'DATASET_SCHEMA_REGISTRY',
      'SUPPORTED_DATASET_ERROR_CODES',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(datasets)) {
      if (typeof value === 'function') continue; // functions and classes
      if (typeof value === 'object' && value !== null) {
        expect(Object.isFrozen(value), `exported object ${name} must be frozen`).toBe(true);
        continue;
      }
      expect(typeof value, `unexpected export ${name} of type ${typeof value}`).toMatch(
        /^(string|number|object|function)$/,
      );
    }
  });

  it('a manifest and bundle are constructible end-to-end from the public surface (smoke)', async () => {
    const { createMaterialArtifact } = await import('@arena/artifact-protocol');
    const artifact = await createMaterialArtifact({
      identity: { namespace: 'tenant-a', name: 'hygiene-artifact', version: '1.0.0' },
      content: { kind: 'smoke', index: 0 },
    });
    const manifest = await datasets.createDatasetManifest({
      identity: { namespace: 'tenant-a', name: 'hygiene-dataset', version: '1.0.0' },
      entries: [
        {
          role: 'input',
          artifact: {
            namespace: artifact.identity.namespace,
            name: artifact.identity.name,
            version: artifact.identity.version,
            digest: artifact.digest,
          },
        },
      ],
      provenance: {
        creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-1' },
        createdAt: '2026-02-01T08:00:00.000Z',
        parents: [],
        rights: {
          license: 'CC-BY-4.0',
          commercialUse: 'allowed',
          redistribution: 'allowed',
          customerData: 'none',
        },
      },
    });
    await expect(datasets.verifyDatasetManifest(manifest)).resolves.toBe(manifest.digest);
    const bundle = await datasets.resolveDatasetBundle(manifest, async (ref) =>
      ref.digest === artifact.digest ? artifact : null,
    );
    expect(bundle.bundleDigest).toMatch(/^[0-9a-f]{64}$/);
    const registry = new datasets.DatasetVersionRegistry();
    await registry.pin(
      datasets.toDatasetVersion({
        identity: manifest.identity,
        manifestDigest: manifest.digest,
      }),
    );
    const resolved = await registry.resolve(manifest.identity);
    expect(resolved?.manifestDigest).toBe(manifest.digest);
  });
});
