/**
 * Hygiene suite (mirrors the A015 job-protocol hygiene suite; lock rules
 * 10, 23):
 *
 *   1. Public-surface hygiene — no `any` type leaks in the non-test
 *      sources (type-position scan).
 *   2. Provider-leakage hygiene — no provider-specific strings or
 *      value-shaped words in the package's non-test sources. The host
 *      interface package is provider-neutral by law (providers live
 *      exclusively behind adapters/hosted/*).
 *
 * The deny-list lives only in this test file (the checker must not be
 * part of the scanned surface), mirroring the A002/A003/A015 suites.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as runtimeHost from './index.js';
import type {
  EscalationLifecycleSurface,
  EscalationStorePort,
  EventSinkPort,
  HostEscalationsSurface,
  IdempotencyOutcomeStorePort,
  JobRunnerSurface,
  JobStorePort,
  ProjectionStateStorePort,
  RuntimeClock,
  RuntimeHostApi,
  WebhookOutboxPort,
} from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Model/provider names and value-shaped words (case-insensitive). */
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

// Substring semantics (no \b): word boundaries would miss snake_case
// shapes like OPENAI_API_KEY, where '_' is a word character on both
// sides (the A015 precedent).
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
  return collectFiles(
    join(PACKAGE_ROOT, 'src'),
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
}

describe('public-surface hygiene (no any leaks)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = nonTestSources();
    expect(sources.length).toBeGreaterThanOrEqual(8);
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

  it('exports the full host-interface vocabulary', () => {
    const exportNames = Object.keys(runtimeHost);
    expect(exportNames.length).toBeGreaterThan(25);
    for (const expected of [
      'RUNTIME_HOST_INTERFACE_VERSION',
      'TRUTH_LENSES',
      'DEMO_TENANT_ID',
      'LensError',
      'lensForTenant',
      'assertLensMatches',
      'RUNTIME_HOST_STATES',
      'transitionRuntimeHost',
      'assertStarted',
      'RuntimeHostLifecycleError',
      'RUNTIME_HOST_COMPONENTS',
      'aggregateReadiness',
      'capacityStatusToComponentState',
      'RUNTIME_JOB_KIND_NAMES',
      'createRuntimeJobKindRegistrations',
      'LEARNING_CANDIDATE_PROJECTION_STUB_EXECUTOR',
      'RUNTIME_HOST_ENV_VARS',
      'RUNTIME_HOST_CONFIG_SUMMARY',
    ]) {
      expect(exportNames, `missing export ${expected}`).toContain(expected);
    }
  });

  it('type-level contracts are exported (compile-time parity, tsc-enforced)', () => {
    // The port/surface contracts are TYPE-ONLY exports — they do not
    // appear in Object.keys. Their presence is enforced by the package
    // typecheck plus the compile-time identity assertions below.
    type Expect<T extends true> = T;
    type IsPortExported = Expect<
      RuntimeClock extends { now(): number } ? true : false
    >;
    const _ports: IsPortExported = true;
    const _store: JobStorePort | null = null;
    const _sink: EventSinkPort | null = null;
    const _escalationStore: EscalationStorePort | null = null;
    const _outbox: WebhookOutboxPort | null = null;
    const _idempotency: IdempotencyOutcomeStorePort | null = null;
    const _projection: ProjectionStateStorePort | null = null;
    const _lifecycleSurface: EscalationLifecycleSurface | null = null;
    const _runnerSurface: JobRunnerSurface | null = null;
    const _hostEscalations: HostEscalationsSurface | null = null;
    const _api: RuntimeHostApi | null = null;
    void [_store, _sink, _escalationStore, _outbox, _idempotency, _projection, _lifecycleSurface, _runnerSurface, _hostEscalations, _api, _ports];
  });

  it('every exported value is a function, frozen constant, string, number or class', () => {
    for (const [name, value] of Object.entries(runtimeHost)) {
      if (typeof value === 'function') continue; // functions and classes
      if (typeof value === 'string' || typeof value === 'number') continue; // primitives
      if (typeof value === 'boolean') continue;
      if (typeof value === 'object' && value !== null && Object.isFrozen(value)) continue;
      expect(typeof value, `unexpected mutable export ${name}`).toBe('function');
    }
  });
});

describe('provider-leakage hygiene (lock rules 10, 23)', () => {
  it('the scanned surface is present and non-empty (the scan itself is wired)', () => {
    const files = nonTestSources();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(statSync(join(PACKAGE_ROOT, 'package.json')).isFile()).toBe(true);
  });

  it('no deny-listed model/provider or value-shaped word appears in any scanned file', () => {
    const violations: string[] = [];
    for (const file of nonTestSources()) {
      const text = readFileSync(file, 'utf-8');
      const match = DENY_PATTERN.exec(text);
      if (match) {
        violations.push(`${file}: /${match[0]}/i`);
      }
    }
    expect(violations, `provider leakage detected:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects the deny-list words (self-test, negative control)', () => {
    expect(DENY_PATTERN.test('provider: "gpt-4o"')).toBe(true);
    expect(DENY_PATTERN.test('x-api-key: abc')).toBe(true);
    expect(DENY_PATTERN.test('the apiKey was leaked')).toBe(true);
    expect(DENY_PATTERN.test('bearer of good news')).toBe(true);
    // No false positives on host-interface vocabulary:
    expect(DENY_PATTERN.test('idempotencyScope correlationId lens truth')).toBe(false);
    expect(DENY_PATTERN.test('arena_migration_ledger arena_job_record')).toBe(false);
    expect(DENY_PATTERN.test('DEMO_TENANT_ID RuntimeHostApi')).toBe(false);
  });
});
