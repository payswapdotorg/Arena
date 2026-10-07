/**
 * Hygiene suite (Work Order C012, packages/human-data):
 *
 *   1. PURITY NEGATIVES — @arena/human-data is a domain core: no
 *      filesystem, network, database or process-state vocabulary may
 *      appear in the non-test sources (the deny-list lives only in this
 *      test file, mirroring the house hygiene suites).
 *   2. Public-surface hygiene — no `any` in the non-test sources; the
 *      internal test-support module is not exported; every exported object
 *      is frozen; the surface is rich (the domain symbols are present).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as humanData from './index.js';

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

describe('purity negatives (a domain core, never an I/O surface)', () => {
  it('the package non-test sources contain NO storage/IO vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    expect(sources.length).toBeGreaterThanOrEqual(5);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsStorageVocabulary(text)) violations.push(file);
    }
    expect(violations, `storage vocabulary leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsStorageVocabulary("import { readFileSync } from 'node:fs'")).toBe(true);
    expect(containsStorageVocabulary('const db = new PrismaClient()')).toBe(true);
    expect(containsStorageVocabulary('await fetch(url)')).toBe(true);
    expect(containsStorageVocabulary('process.env.DATABASE_URL')).toBe(true);
    // No false positives on this package's vocabulary:
    expect(containsStorageVocabulary('tenant-scoped deliverable records')).toBe(false);
    expect(containsStorageVocabulary('immutable dataset manifest')).toBe(false);
    expect(containsStorageVocabulary('content-addressed digest')).toBe(false);
  });
});

describe('public-surface hygiene (no any leaks, frozen exports, rich surface)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
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
    const exportNames = Object.keys(humanData);
    for (const internal of [
      'makeCommission',
      'makeCommissionInput',
      'makeAdjudicationOutcome',
      'makeReplayTrace',
      'makeResult',
      'TENANT_A',
      'TENANT_B',
      'CLIENT_APP_ID',
      'VALID_RIGHTS',
      'VALID_CONSENT',
    ]) {
      expect(exportNames, `test-support symbol ${internal} leaked`).not.toContain(internal);
    }
  });

  it('the public surface is rich (the domain symbols are exported)', () => {
    const exportNames = Object.keys(humanData);
    expect(exportNames.length).toBeGreaterThan(40);
    for (const expected of [
      'COMMISSION_VERSION',
      'COMMISSION_STATES',
      'COMMISSION_TRANSITIONS',
      'COMMISSION_DELIVERABLE_KINDS',
      'KIND_RESULT_KINDS',
      'BOUNDED_SESSION_KINDS',
      'createHumanDataCommission',
      'verifyHumanDataCommission',
      'compileCommissionEscalations',
      'checkCommissionTransition',
      'DELIVERABLE_VERSION',
      'DELIVERABLE_RECORD_KINDS',
      'deriveDeliverable',
      'assertDeliverableRightsGated',
      'isDeliverableRecord',
      'CONSENT_STATEMENT_MAX_LENGTH',
      'toConsentRightsStatement',
      'requireGrantedConsent',
      'toRightsPosture',
      'rightsDeclarationConsequences',
      'assembleHumanDataset',
      'describeHumanDatasetDelivery',
      'HUMAN_DATA_ERROR_CODES',
      'HumanDataError',
      'isHumanDataError',
      'fromHumanDataErrorStruct',
      'toHumanDataErrorStruct',
      'normalizeToHumanDataError',
      'HUMAN_DATA_PROTOCOL_VERSION',
      'SUPPORTED_HUMAN_DATA_ERROR_CODES',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(humanData)) {
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
});
