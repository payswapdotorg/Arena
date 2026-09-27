/**
 * Hygiene suite (Work Order A015 gate 12; architecture-lock rules 10, 23):
 *
 *   1. Public-surface hygiene — no `any` type leaks in the non-test
 *      sources (type-position scan).
 *   2. Provider-leakage hygiene — no provider-specific strings or
 *      credential-shaped words in the package's non-test sources, the
 *      contract generator, or the committed generated contracts.
 *
 * The deny-list lives only in this test file (the checker must not be part
 * of the scanned surface), mirroring the A002/A003 hygiene suites.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as jobProtocol from './index.js';

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
// like OPENAI_API_KEY, where '_' is a word character on both sides. The
// job-protocol vocabulary contains none of these substrings, so the scan is
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
      label: 'packages/job-protocol/src (non-test sources)',
      files: collectFiles(
        join(PACKAGE_ROOT, 'src'),
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
      ),
    },
    {
      label: 'packages/job-protocol/scripts (contract generator)',
      files: collectFiles(join(PACKAGE_ROOT, 'scripts'), (name) => name.endsWith('.mjs')),
    },
    {
      label: 'contracts/events (committed canonical objects)',
      files: statSync(join(REPO_ROOT, 'contracts', 'events'), { throwIfNoEntry: false })
        ? collectFiles(join(REPO_ROOT, 'contracts', 'events'), (name) => name.endsWith('.json'))
        : [],
    },
  ];
}

describe('public-surface hygiene (gate 12 — no any leaks)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(5);
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

  it('the public surface exports the full A015 vocabulary', () => {
    const exportNames = Object.keys(jobProtocol);
    expect(exportNames.length).toBeGreaterThan(90);
    for (const expected of [
      'JOB_PROTOCOL_VERSION',
      'JobError',
      'JOB_ERROR_CODES',
      'createJobDefinition',
      'verifyJobDefinition',
      'isJobDefinition',
      'createJobRecord',
      'claimJob',
      'completeJob',
      'failJob',
      'timeoutJob',
      'cancelJob',
      'progressJob',
      'parseJobRecord',
      'isJobRecord',
      'JOB_EVENT_KINDS',
      'isJobEvent',
      'makeMutationAuditedEvent',
      'appendJobEvent',
      'nextJobEventKinds',
      'appendAuditRecord',
      'verifyAuditChain',
      'AUDIT_GENESIS_DIGEST',
      'toJobSubmissionIdentity',
      'jobSubmissionKey',
      'resolveIdempotentSubmission',
      'assertIdempotentResubmission',
      'makeSubmitJobCommand',
      'makeJobEventEnvelope',
      'parseJobEnvelope',
      'verifyJobEnvelope',
      'JOB_SCHEMAS',
      'createJobEventLog',
      'appendJobEventEnvelope',
      'verifyJobEventLog',
    ]) {
      expect(exportNames, `missing export ${expected}`).toContain(expected);
    }
  });

  it('every exported value is a function, frozen constant, string, number or class', () => {
    for (const [name, value] of Object.entries(jobProtocol)) {
      if (typeof value === 'function') continue; // functions and classes
      if (typeof value === 'string' || typeof value === 'number') continue; // primitives
      if (typeof value === 'boolean') continue;
      if (typeof value === 'object' && value !== null && Object.isFrozen(value)) continue;
      expect(typeof value, `unexpected mutable export ${name}`).toBe('function');
    }
  });
});

describe('provider-leakage hygiene (lock rules 10, 23)', () => {
  it('every scanned surface is present and non-empty (the scan itself is wired)', () => {
    const surfaces = scannedSurfaces();
    expect(surfaces.length).toBe(3);
    expect(surfaces[0]?.files.length ?? 0).toBeGreaterThan(5);
    expect(surfaces[1]?.files.length ?? 0).toBeGreaterThan(0);
    expect(surfaces[2]?.files.length ?? 0).toBe(14);
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
    expect(DENY_PATTERN.test('attemptHistory backoffScheduleMs nextRetryAt')).toBe(false);
    expect(DENY_PATTERN.test('mutation-audited audit chain sha256')).toBe(false);
  });
});
