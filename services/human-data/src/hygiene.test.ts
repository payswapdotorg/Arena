/**
 * Hygiene suite (Work Order C012, services/human-data): the service sources
 * carry no storage/IO vocabulary beyond the in-process reference fabric's
 * Maps (deployment-tier persistence is host-wired), no `any` leaks, the
 * test-support module is not exported, and every exported constant is
 * frozen.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

describe('service hygiene', () => {
  it('the non-test sources contain NO storage/IO vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    expect(sources.length).toBeGreaterThanOrEqual(4);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (PURITY_PATTERN.test(text)) violations.push(file);
    }
    expect(violations, `storage vocabulary leakage:\n${violations.join('\n')}`).toEqual([]);
  });

  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    const anyPatterns = [/:\s*any\b/, /\bas\s+any\b/, /<any>/, /\bany\[\]/, /\bPromise<any>\b/];
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

  it('the public surface excludes the internal test-support module and is rich', () => {
    const exportNames = Object.keys(service);
    for (const internal of [
      'makeCommissionInput',
      'makeAdjudicationOutcome',
      'makeResult',
      'makeReplayTrace',
      'TENANT_A',
      'CONSENT',
    ]) {
      expect(exportNames, `test-support symbol ${internal} leaked`).not.toContain(internal);
    }
    for (const expected of [
      'HumanDataService',
      'FixedClock',
      'InMemoryCommissionStore',
      'ReferenceEscalationPort',
      'ScriptedDeliverableSource',
      'RecordingEventSink',
      'createHumanDataReferenceFabric',
      'HUMAN_DATA_EVENT_TYPES',
    ]) {
      expect(exportNames).toContain(expected);
    }
    expect(Object.isFrozen(service.HUMAN_DATA_EVENT_TYPES)).toBe(true);
  });
});
