/**
 * Hygiene suite (Work Order A011 gates 7, 10, 11):
 *
 *   1. Storage-neutrality negatives — no postgres/mongo/redis/sqlite/s3
 *      (or any other persistence-brand) strings ANYWHERE in the domain
 *      package: not in the non-test sources, not in the committed
 *      generated contracts, not in the README. The trajectory protocol
 *      is storage-neutral; the reference store is in-process and durable
 *      persistence is a deployment-tier concern.
 *   2. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; every exported
 *      object is frozen.
 *
 * The deny-lists live only in this test file (the checker must not be
 * part of the scanned surface), mirroring the A009/A010 hygiene suites.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import * as trajectory from './index.js';
import { openTrajectory, appendTrajectoryEntry } from './record.js';
import { makeHeaderInput, makeMixedSequence } from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Storage-brand tokens (case-insensitive). Long unambiguous tokens use
 * substring semantics; short tokens use alphanumeric delimiters so that
 * ordinary protocol vocabulary is never matched.
 */
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

describe('storage-neutrality hygiene (gate 7 — the protocol is storage-neutral)', () => {
  it('the domain package non-test sources contain NO storage-brand strings', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(7);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsStorageBrand(text)) violations.push(file);
    }
    expect(violations, `storage-brand leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the committed generated contracts contain NO storage-brand strings', () => {
    const contractFiles = collectFiles(
      join(REPO_ROOT, 'contracts', 'trajectory'),
      (name) => name.endsWith('.json'),
    );
    expect(contractFiles).toHaveLength(10);
    const violations: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(file, 'utf-8');
      if (containsStorageBrand(text)) violations.push(file);
    }
    expect(violations, `storage-brand leakage in contracts:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package README and manifest contain NO storage-brand strings', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      const text = readFileSync(path, 'utf-8');
      expect(containsStorageBrand(text), `${rel} leaks a storage brand`).toBe(false);
    }
  });

  it('canonical domain objects stay storage-neutral (runtime control)', async () => {
    let record = await openTrajectory(makeHeaderInput());
    for (const input of makeMixedSequence()) {
      record = await appendTrajectoryEntry(record, input);
    }
    const canonical = canonicalJson(record);
    expect(containsStorageBrand(canonical)).toBe(false);
  });

  it('the scanner itself detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsStorageBrand('postgres://localhost/db')).toBe(true);
    expect(containsStorageBrand('runs on redis')).toBe(true);
    expect(containsStorageBrand('sqlite file')).toBe(true);
    expect(containsStorageBrand('upload to s3')).toBe(true);
    expect(containsStorageBrand('mongodb connection string')).toBe(true);
    expect(containsStorageBrand('dynamodb table')).toBe(true);
    // No false positives on this package's vocabulary:
    expect(containsStorageBrand('append-only content-addressed trajectory')).toBe(false);
    expect(containsStorageBrand('the in-process reference store')).toBe(false);
    expect(containsStorageBrand('chain head digest')).toBe(false);
    expect(containsStorageBrand('observation checkpoint completion')).toBe(false);
    expect(containsStorageBrand('workspace evidence addressability')).toBe(false);
  });
});

describe('public-surface hygiene (gates 10, 11 — no any leaks, frozen exports)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(7);
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

  it('the public surface is rich but excludes the internal test-support module', () => {
    const exportNames = Object.keys(trajectory);
    expect(exportNames.length).toBeGreaterThan(80);
    for (const internal of [
      'makeHeaderInput',
      'makeMixedSequence',
      'makeActionInput',
      'TestLcg',
      'DIGEST_A',
      'T0',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
    for (const expected of [
      'TRAJECTORY_ERROR_CODES',
      'TrajectoryError',
      'toTrajectoryRunRef',
      'isTrajectoryRunRef',
      'trajectoryRunRefKey',
      'createTrajectoryHeader',
      'verifyTrajectoryHeader',
      'isTrajectoryHeader',
      'TRAJECTORY_HEADER_FIELDS',
      'TRAJECTORY_ENTRY_KINDS',
      'OBSERVATION_CHANNELS',
      'TRAJECTORY_OUTCOMES',
      'toTrajectoryEntryPayload',
      'createTrajectoryEntry',
      'verifyTrajectoryEntry',
      'computeTrajectoryStepDigest',
      'TRAJECTORY_ENTRY_FIELDS',
      'createTrajectoryRecord',
      'openTrajectory',
      'appendTrajectoryEntry',
      'replayTrajectory',
      'verifyTrajectoryRecord',
      'isTrajectoryRecord',
      'isTrajectoryCompleted',
      'trajectoryEntryCount',
      'trajectoryExportView',
      'TRAJECTORY_SCHEMAS',
      'trajectorySchemaRef',
      'makeOpenTrajectoryCommand',
      'makeTrajectoryOpenedEvent',
      'makeAppendTrajectoryEntryCommand',
      'makeTrajectoryEntryAppendedEvent',
      'parseTrajectoryEnvelope',
      'trajectoryEnvelopeDigest',
      'verifyTrajectoryEnvelope',
      'TRAJECTORY_PROTOCOL_VERSION',
      'TRAJECTORY_SCHEMA_REGISTRY',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(trajectory)) {
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
