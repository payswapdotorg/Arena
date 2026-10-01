/**
 * Hygiene suite (Work Order B004; the @arena/auth hygiene precedent
 * applied to the SERVICE surface):
 *
 *   1. Purity — services/auth/src contains ZERO Next.js imports (the
 *      Next.js session boundary lives in apps/web/src/auth) and ZERO
 *      provider names / provider SDK vocabulary (FT2.0 provider
 *      neutrality). NOTE: this surface legitimately speaks the auth
 *      vocabulary ('secret', 'credential', 'session' ARE the domain
 *      here), so the deny-list covers PROVIDER names and framework
 *      vocabulary, not the auth-domain words themselves.
 *   2. Effect discipline — non-test sources import ZERO node builtins:
 *      every effect (time, storage, coordination) flows through the
 *      injected ports (architecture-lock rule 17).
 *   3. Public-surface hygiene — no `any` type leaks in non-test sources.
 *   4. Workspace discipline — the workspace dependencies are exactly
 *      @arena/auth + @arena/persistence + @arena/protocol-core +
 *      @arena/role-context + @arena/security (domain/protocol layers
 *      only); NEVER a sibling service, NEVER an adapter (layer rules
 *      B2/B4). Test fixtures stay private (not re-exported).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as surface from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
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
 * vocabulary) and framework vocabulary. Substring semantics (no word
 * boundaries). The auth-domain vocabulary itself is legitimate here and
 * is therefore NOT deny-listed (the @arena/auth precedent).
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
  'oidc',
  'auth0',
  'cognito',
  'okta',
  // framework vocabulary — the Next.js boundary lives in apps/web/src/auth
  'next/',
  'next/navigation',
  'react',
];

describe('purity (zero Next.js imports, zero provider names)', () => {
  it('non-test sources import neither Next.js/React nor any provider vocabulary', () => {
    const offenders: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf-8').toLowerCase();
      for (const word of DENY_LIST) {
        if (text.includes(word)) offenders.push(`${file}: ${word}`);
      }
    }
    expect(NON_TEST_SOURCES.length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it('ships no credential-shaped literals', () => {
    const literalPattern = new RegExp(
      `(?:${['gh' + 'p_', 'sk' + '-', 'AK' + 'IA'].join('|')})[A-Za-z0-9]{16,}`,
    );
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf-8');
      if (literalPattern.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });

  it('imports zero node builtins in non-test sources (all effects through ports)', () => {
    const builtins = new Set<string>();
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(/from 'node:([a-z]+)'/g)) {
        builtins.add(match[1] ?? '');
      }
    }
    expect([...builtins].sort()).toEqual([]);
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
      const text = readFileSync(file, 'utf-8');
      for (const pattern of patterns) {
        if (pattern.test(text)) violations.push(`${file}: ${String(pattern)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('exports the B004 auth-service vocabulary', () => {
    // VALUE exports only — type-only exports never appear at runtime.
    const expected = [
      'AuthService',
      'AUTH_SERVICE_RECORD_VERSION',
      'AUTH_SERVICE_VERSION',
      'makeAuthenticatedSession',
      'toAuthenticatedSession',
      'StaticCredentialVerifier',
      'sessionSecretFromEnv',
      'ControlPlaneSessionStore',
      'SESSION_RECORD_KIND',
      'SESSION_EPOCH_RECORD_KIND',
      'createLocalAuthStack',
    ];
    const names = Object.keys(surface);
    expect(names.length).toBeGreaterThan(10);
    for (const name of expected) {
      expect(names, `missing export ${name}`).toContain(name);
    }
  });

  it('test fixtures stay private (test-support is not re-exported)', () => {
    const names = Object.keys(surface);
    expect(names).not.toContain('fixtureSessionRecord');
    expect(names).not.toContain('fixturePrincipal');
    expect(names).not.toContain('TENANT_A');
  });
});

describe('workspace discipline (layer rules B2/B4)', () => {
  it('the workspace dependencies are exactly the domain/protocol layers', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@arena/auth',
      '@arena/persistence',
      '@arena/protocol-core',
      '@arena/role-context',
      '@arena/security',
    ]);
  });

  it('no source imports a sibling service or an adapter workspace', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_DIR)) {
      const text = readFileSync(file, 'utf-8');
      for (const line of text.split('\n')) {
        if (!/(import|require)/.test(line)) continue;
        if (/@arena\/hosted/.test(line) || /@arena\/[a-z-]+-(service|adapter)/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ships no contracts generator and no contract output', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'scripts'))).toBe(false);
  });
});
