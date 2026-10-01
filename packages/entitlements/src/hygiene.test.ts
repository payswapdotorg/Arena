import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
      'secret', 'credential', 'password', 'bearer', 'token',
    ];
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const word of denyList) {
        if (text.includes(word)) violations.push(`${file}: ${word}`);
      }
    }
    expect(NON_TEST_SOURCES.length).toBeGreaterThan(0);
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
  it('exports the A033 entitlement vocabulary', () => {
    const expected = [
      'EntitlementError',
      'ENTITLEMENT_ERROR_CODES',
      'createQuotaGrant',
      'createFeatureFlagGrant',
      'createRateLimitGrant',
      'amendEntitlementGrant',
      'revokeEntitlementGrant',
      'isGrantActive',
      'toEntitlementGrant',
      'resolveEntitlements',
      'evaluateFeatureFlag',
      'assertEntitlementTenant',
      'isUsageMeterEvent',
      'toUsageRecordedEvent',
      'toUsageRevisedEvent',
      'createUsageMeterLog',
      'appendUsageMeterEvent',
      'verifyUsageMeterLog',
      'meteredTotals',
      'makeRecordUsageCommand',
      'makeUsageMeterEventEnvelope',
      'parseEntitlementEnvelope',
      'entitlementSchemaRef',
      'ENTITLEMENT_SCHEMAS',
      'ENTITLEMENTS_VERSION',
    ];
    const names = Object.keys(surface);
    expect(names.length).toBeGreaterThan(60);
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

  it('does NOT re-export the shared test fixtures (test-support stays private)', () => {
    const names = Object.keys(surface);
    expect(names).not.toContain('makeQuotaGrantInput');
    expect(names).not.toContain('TENANT_A');
    expect(names).not.toContain('T0');
  });
});

describe('workspace discipline (A033 contracts disclosure)', () => {
  it('the only workspace runtime dependency is @arena/protocol-core', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@arena/protocol-core']);
  });

  it('ships no contracts generator and no contract output (A034/A019 precedent)', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'scripts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'contracts', 'entitlements'))).toBe(false);
  });
});
