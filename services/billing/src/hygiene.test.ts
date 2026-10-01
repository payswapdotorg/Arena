/**
 * Hygiene suite for @arena/billing-service (Work Order A033):
 *
 *   1. Source hygiene — no `any`, no provider names, no credential-shaped
 *      literals in non-test sources.
 *   2. Public surface hygiene — the A033 billing vocabulary is exported,
 *      every exported value is a function / frozen constant / primitive,
 *      and the shared test fixtures stay private.
 *   3. Workspace discipline — the only workspace dependencies are the
 *      protocol layer and the domain contract packages it consumes
 *      read-only; the service never imports a sibling service; no
 *      contracts generator, no contract output (A033 owns no contracts/
 *      surface — the A034/A019/A022 disclosure precedent).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as surface from './index.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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

describe('source hygiene', () => {
  it('has no `any` in non-test sources', () => {
    const patterns = [/:\s*any\b/, /\bas\s+any\b/, /<any>/, /\bany\[\]/, /readonly\s+any\b/, /\bPromise<any>\b/];
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        if (pattern.test(text)) violations.push(`${file}: ${String(pattern)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('carries no provider names or credential-shaped words in non-test sources', () => {
    const denyList = [
      'openai', 'anthropic', 'claude', 'gemini', 'gpt',
      'api_key', 'api-key', 'apikey',
      'secret', 'credential', 'password', 'bearer',
    ];
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const word of denyList) {
        if (text.includes(word)) violations.push(`${file}: ${word}`);
      }
    }
    expect(NON_TEST_SOURCES.length).toBeGreaterThan(5);
    expect(violations).toEqual([]);
  });

  it('ships no credential-shaped literals (prefix fragments keep this scanner honest)', () => {
    const literalPattern = new RegExp(`(?:${['gh' + 'p_', 'sk' + '-', 'AK' + 'IA'].join('|')})[A-Za-z0-9]{16,}`);
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      if (literalPattern.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});

describe('public surface hygiene', () => {
  it('exports the A033 billing vocabulary', () => {
    const expected = [
      'BillingError',
      'BILLING_ERROR_CODES',
      'BillingService',
      'JOB_EVENT_UNIT_COSTS',
      'STATEMENT_STATUSES',
      'STATEMENT_LINEAGE_KINDS',
      'USAGE_SOURCES',
      'ManualClock',
      'SystemClock',
      'InMemoryGrantStore',
      'InMemoryUsageLedger',
      'InMemoryStatementStore',
      'InMemoryJobUsageIndex',
      'StaticPriceBook',
      'summarizeWindow',
      'windowStartFor',
      'windowEndFor',
      'isWithinWindow',
      'isUsageRecord',
      'isUsageStatement',
      'assertSafeAmountMicros',
      'draftStatement',
      'issueStatement',
      'verifyStatement',
      'BILLING_SERVICE_VERSION',
    ];
    const names = Object.keys(surface);
    expect(names.length).toBeGreaterThan(25);
    for (const name of expected) {
      // summarizeWindow / draftStatement / issueStatement / verifyStatement
      // are BillingService methods, verified structurally below.
      if (['summarizeWindow', 'draftStatement', 'issueStatement', 'verifyStatement'].includes(name)) {
        expect(names, `unexpected standalone export ${name}`).not.toContain(name);
        continue;
      }
      expect(names, `missing export ${name}`).toContain(name);
    }
    const proto = surface.BillingService.prototype as unknown as Record<string, unknown>;
    for (const method of ['ingestJobEventEnvelope', 'ingestRecordUsageCommand', 'summarizeWindow', 'draftStatement', 'issueStatement', 'verifyStatement']) {
      expect(typeof proto[method], `BillingService.${method} must exist`).toBe('function');
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

  it('does NOT re-export the shared test fixtures (test-support stays private)', () => {
    const names = Object.keys(surface);
    expect(names).not.toContain('makeJobEventEnvelopeRaw');
    expect(names).not.toContain('createBillingHarness');
    expect(names).not.toContain('TENANT_ACME');
    expect(names).not.toContain('T0');
  });
});

describe('workspace discipline (A033 boundaries)', () => {
  it('the workspace dependencies are exactly the protocol layer and consumed domain contracts', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@arena/entitlements',
      '@arena/job-protocol',
      '@arena/protocol-core',
    ]);
  });

  it('never imports a sibling service (B2: services communicate via versioned contracts)', () => {
    const serviceImportPattern = /from\s+['"]@arena\/[a-z-]*(fabric|service|orchestrator)[a-z-]*['"]/;
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      if (serviceImportPattern.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });

  it('ships no contracts generator and no contract output (A034/A019 precedent)', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'scripts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'contracts', 'billing'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'contracts', 'entitlements'))).toBe(false);
  });

  it('ships a README describing the reference fabric (service hygiene)', () => {
    const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf8');
    expect(readme.length).toBeGreaterThan(200);
    expect(readme.includes('fabric')).toBe(true);
  });
});
