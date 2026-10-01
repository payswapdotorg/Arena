/**
 * Hygiene suite (Work Order B004; the B002 hygiene precedent adapted to
 * the auth surface):
 *
 *   1. Purity — packages/auth/src contains ZERO Next.js imports (the
 *      Next.js session boundary lives in apps/web/src/auth) and ZERO
 *      provider names / provider credential-shaped words (FT2.0 provider
 *      neutrality; the deny-list lives only in this test file so the
 *      checker is never part of the scanned surface).
 *   2. Public-surface hygiene — no `any` type leaks in non-test sources.
 *   3. Export discipline — every exported object is frozen; the auth
 *      vocabulary is exported; test fixtures stay private.
 *   4. Workspace discipline — the workspace dependencies are exactly
 *      @arena/protocol-core + @arena/security + @arena/role-context (the
 *      A034/B003 primitives this package integrates); no contracts/
 *      surface is shipped (B004 owns none).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as surface from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
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

/**
 * Provider names (the FT2.0 provider set plus infrastructure-vendor
 * vocabulary) and credential-transport-shaped words. Substring semantics
 * (no word boundaries). NOTE: this package legitimately speaks the auth
 * vocabulary ('secret' IS the domain here — the SESSION_SECRET contract),
 * so the deny-list covers PROVIDER names and TRANSPORT/SDK vocabulary, not
 * the auth-domain words themselves.
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
  'next/',
  'next/navigation',
  'react',
];

describe('purity (zero Next.js imports, zero provider names)', () => {
  it('non-test sources import neither Next.js/React nor any provider vocabulary', () => {
    const offenders: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const word of DENY_LIST) {
        if (text.includes(word)) offenders.push(`${file}: ${word}`);
      }
    }
    expect(NON_TEST_SOURCES.length).toBeGreaterThan(8);
    expect(offenders).toEqual([]);
  });

  it('ships no credential-shaped literals', () => {
    const literalPattern = new RegExp(
      `(?:${['gh' + 'p_', 'sk' + '-', 'AK' + 'IA'].join('|')})[A-Za-z0-9]{16,}`,
    );
    const violations: string[] = [];
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      if (literalPattern.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });

  it('the only node builtin import is node:crypto (the sanctioned HMAC primitive)', () => {
    const builtins = new Set<string>();
    for (const file of NON_TEST_SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from 'node:([a-z]+)'/g)) {
        builtins.add(match[1] ?? '');
      }
    }
    expect([...builtins].sort()).toEqual(['crypto']);
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
      const text = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        if (pattern.test(text)) violations.push(`${file}: ${String(pattern)}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('export discipline', () => {
  it('exports the B004 auth vocabulary', () => {
    const expected = [
      // errors
      'AuthError',
      'AUTH_ERROR_CODES',
      'AUTH_ERROR_CATEGORIES',
      'fromAuthErrorStruct',
      'toAuthErrorStruct',
      'normalizeToAuthError',
      'isAuthError',
      // shared
      'isSessionId',
      'toSessionId',
      'sameTenantScope',
      'isSessionTenantId',
      'deepFreeze',
      'isDeepFrozen',
      // secret
      'resolveSessionSecret',
      'assertSessionSecretEnabled',
      'SESSION_SECRET_ENV_VAR',
      'MIN_SESSION_SECRET_LENGTH',
      // token
      'createSessionTokenSealer',
      'newSessionId',
      'SESSION_TOKEN_RECORD_VERSION',
      'SESSION_TOKEN_PROTOCOL_VERSION',
      // session
      'createSessionRecord',
      'toSessionRecord',
      'isSessionRecord',
      'createAuthMethodDescriptor',
      'isAuthMethodDescriptor',
      'validateSessionPolicy',
      'DEFAULT_SESSION_POLICY',
      'isSessionExpired',
      'requiresSessionRotation',
      'SESSION_RECORD_VERSION',
      // cookie
      'SESSION_COOKIE_NAME',
      'sessionCookieSpec',
      'clearedSessionCookieSpec',
      'serializeSessionCookie',
      'parseSessionCookieHeader',
      // store
      'SESSION_VALIDATION_STATUSES',
      'toSessionStoreRecord',
      // fakes
      'FakeSessionStore',
      'ManualAuthClock',
      'SystemAuthClock',
      // testing kit
      'defineSessionContractSuite',
      // version
      'AUTH_VERSION',
    ];
    const names = Object.keys(surface);
    expect(names.length).toBeGreaterThan(40);
    for (const name of expected) {
      expect(names, `missing export ${name}`).toContain(name);
    }
  });

  it('every exported value is a function, frozen constant, primitive or class', () => {
    for (const [name, value] of Object.entries(surface)) {
      if (
        typeof value === 'function' ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        expect(Object.isFrozen(value), `export ${name} must be frozen`).toBe(true);
        continue;
      }
      expect.unreachable(`export ${name} has an unexpected type: ${typeof value}`);
    }
  });

  it('test fixtures stay private (test-support is not re-exported)', () => {
    const names = Object.keys(surface);
    expect(names).not.toContain('fixtureSessionRecord');
    expect(names).not.toContain('fixturePrincipal');
    expect(names).not.toContain('TENANT_A');
  });
});

describe('workspace discipline', () => {
  it('the workspace dependencies are exactly protocol-core + security + role-context', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@arena/protocol-core',
      '@arena/role-context',
      '@arena/security',
    ]);
  });

  it('ships no contracts generator and no contract output (no contracts/ surface is owned)', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'scripts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'contracts', 'auth'))).toBe(false);
  });
});
