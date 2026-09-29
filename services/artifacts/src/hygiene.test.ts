/**
 * Hygiene suite (Work Order A014, services/artifacts):
 *
 *   1. PURITY NEGATIVES — the artifact service is the IN-PROCESS REFERENCE
 *      implementation, NOT object storage: no filesystem, network, database
 *      or environment vocabulary may appear in the non-test sources (the
 *      deny-list lives only in this test file, mirroring the datasets
 *      hygiene suite; word-boundary regexes avoid false positives on
 *      spec-mandated words like `redistribution`).
 *   2. Public-surface hygiene — no `any` in the non-test sources; the
 *      internal test-support module is not exported; every exported object
 *      is frozen; the surface carries the three services + the facade.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as service from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

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

describe('purity negatives (in-process reference service, NOT object storage)', () => {
  it('the service non-test sources contain NO storage/IO vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(4);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsStorageVocabulary(text)) violations.push(file);
    }
    expect(violations, `storage vocabulary leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package README and manifest stay backend-neutral', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      const text = readFileSync(path, 'utf-8');
      // The explicit "not object storage" disclaimer is allowed; concrete
      // backend names are not.
      const cleaned = text.replace(/not object storage[^.]*\./gi, '');
      const violations: string[] = [];
      for (const token of ['prismaclient', 'sqlite3', 'postgresql', 'mysql', 'redis']) {
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
    // No false positives on this package's (spec-mandated) vocabulary:
    expect(containsStorageVocabulary('in-process reference store')).toBe(false);
    expect(containsStorageVocabulary('content-addressed by digest')).toBe(false);
    expect(containsStorageVocabulary('redistribution policy: tenant-only')).toBe(false);
    expect(containsStorageVocabulary('durable persistence is a deployment-tier concern')).toBe(false);
  });
});

describe('public-surface hygiene (no any leaks, frozen exports, rich surface)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(4);
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
    const exportNames = Object.keys(service);
    for (const internal of [
      'makeArtifact',
      'makeRecordInput',
      'refOf',
      'TestLcg',
      'RIGHTS',
      'CALLER_A',
      'CALLER_B',
      'TENANT_A',
      'TENANT_B',
      'T0',
    ]) {
      expect(exportNames, `test-support symbol ${internal} leaked`).not.toContain(internal);
    }
  });

  it('the public surface carries the three services + the facade', () => {
    const exportNames = Object.keys(service);
    for (const expected of [
      'ARTIFACTS_ERROR_CODES',
      'ArtifactsError',
      'isArtifactsError',
      'fromArtifactsErrorStruct',
      'toArtifactsErrorStruct',
      'normalizeToArtifactsError',
      'ArtifactStore',
      'LineageService',
      'PublicationService',
      'createArtifactService',
    ]) {
      expect(exportNames, `expected export ${expected}`).toContain(expected);
    }
    // Runtime symbols (classes/functions) are present as values.
    expect(typeof service.ArtifactStore).toBe('function');
    expect(typeof service.LineageService).toBe('function');
    expect(typeof service.PublicationService).toBe('function');
    expect(typeof service.createArtifactService).toBe('function');
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(service)) {
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

  it('the composed facade wires one shared store into all three services', async () => {
    const facade = service.createArtifactService();
    const artifact = await (
      await import('@arena/artifact-protocol')
    ).createMaterialArtifact({
      identity: { namespace: 'tenant-a', name: 'facade-artifact', version: '1.0.0' },
      content: { kind: 'smoke' },
    });
    await facade.store.put(artifact, { type: 'user', tenant: 'tenant-a', principalId: 'u' });
    // Publication reads through the SAME store: the facade is coherent.
    await facade.publication.publish(artifact, { type: 'user', tenant: 'tenant-a', principalId: 'u' }, {
      license: 'CC-BY-4.0',
      commercialUse: 'allowed',
      redistribution: 'allowed',
      customerData: 'none',
    });
    const status = await facade.publication.status(artifact.identity);
    expect(status.visibility).toBe('public');
    // Lineage sees the store too (root record with no parents).
    await facade.lineage.record({
      artifact: {
        namespace: artifact.identity.namespace,
        name: artifact.identity.name,
        version: artifact.identity.version,
        digest: artifact.digest,
      },
      creator: { type: 'service', tenant: 'tenant-a', principalId: 'svc-1' },
      createdAt: '2026-03-01T12:00:00.000Z',
      parents: [],
      transformation: {
        transform: {
          namespace: 'tenant-a',
          name: 'facade-transform',
          version: '1.0.0',
          digest: 'c'.repeat(64),
        },
        inputs: [],
      },
      rights: {
        license: 'CC-BY-4.0',
        commercialUse: 'allowed',
        redistribution: 'allowed',
        customerData: 'none',
      },
    });
    const records = await facade.lineage.listRecords();
    expect(records).toHaveLength(1);
  });
});
