/**
 * arena_session cookie contract tests (Work Order B004) — the name, the
 * FIXED flags, spec builders, serialization and header parsing.
 */

import { describe, expect, it } from 'vitest';
import { AuthError, AUTH_ERROR_CODES, isAuthError } from './errors.js';
import {
  clearedSessionCookieSpec,
  MAX_SESSION_COOKIE_MAX_AGE_SECONDS,
  parseSessionCookieHeader,
  serializeSessionCookie,
  SESSION_COOKIE_HTTP_ONLY,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  SESSION_COOKIE_SAME_SITE,
  sessionCookieSpec,
} from './cookie.js';

describe('arena_session cookie contract', () => {
  it('pins the cookie NAME and the FIXED flags', () => {
    expect(SESSION_COOKIE_NAME).toBe('arena_session');
    expect(SESSION_COOKIE_HTTP_ONLY).toBe(true);
    expect(SESSION_COOKIE_SAME_SITE).toBe('Lax');
    expect(SESSION_COOKIE_PATH).toBe('/');
  });

  it('builds the live-session spec with the full flag set', () => {
    const spec = sessionCookieSpec('arena.st1.abc.def', {
      secure: true,
      maxAgeSeconds: 3600,
    });
    expect(spec.name).toBe('arena_session');
    expect(spec.value).toBe('arena.st1.abc.def');
    expect(spec.httpOnly).toBe(true);
    expect(spec.sameSite).toBe('Lax');
    expect(spec.secure).toBe(true);
    expect(spec.path).toBe('/');
    expect(spec.maxAgeSeconds).toBe(3600);
    expect(Object.isFrozen(spec)).toBe(true);
  });

  it('builds the clearing spec (logout) with max-age 0', () => {
    const spec = clearedSessionCookieSpec({ secure: true });
    expect(spec.name).toBe('arena_session');
    expect(spec.value).toBe('');
    expect(spec.maxAgeSeconds).toBe(0);
    expect(spec.httpOnly).toBe(true);
  });

  it('rejects empty values and out-of-bounds max-age (typed)', () => {
    for (const operation of [
      () => sessionCookieSpec('', { secure: true, maxAgeSeconds: 60 }),
      () => sessionCookieSpec('v', { secure: true, maxAgeSeconds: 0 }),
      () => sessionCookieSpec('v', { secure: true, maxAgeSeconds: -1 }),
      () =>
        sessionCookieSpec('v', {
          secure: true,
          maxAgeSeconds: MAX_SESSION_COOKIE_MAX_AGE_SECONDS + 1,
        }),
    ]) {
      let caught: unknown;
      try {
        operation();
      } catch (error) {
        caught = error;
      }
      expect(isAuthError(caught)).toBe(true);
      expect((caught as AuthError).code).toBe(AUTH_ERROR_CODES.INVALID_COOKIE);
    }
  });

  it('serializes to a single canonical Set-Cookie header value', () => {
    const secure = serializeSessionCookie(
      sessionCookieSpec('arena.st1.payload.seal', { secure: true, maxAgeSeconds: 43_200 }),
    );
    expect(secure).toBe(
      'arena_session=arena.st1.payload.seal; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=43200',
    );
    const local = serializeSessionCookie(
      sessionCookieSpec('arena.st1.payload.seal', { secure: false, maxAgeSeconds: 60 }),
    );
    expect(local).toBe(
      'arena_session=arena.st1.payload.seal; Path=/; HttpOnly; SameSite=Lax; Max-Age=60',
    );
    const clear = serializeSessionCookie(clearedSessionCookieSpec({ secure: true }));
    expect(clear).toBe('arena_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
  });

  it('parses the session cookie out of raw Cookie headers', () => {
    expect(parseSessionCookieHeader('arena_session=arena.st1.a.b')).toBe('arena.st1.a.b');
    expect(
      parseSessionCookieHeader('other=x; arena_session=arena.st1.a.b; more=y'),
    ).toBe('arena.st1.a.b');
    expect(parseSessionCookieHeader('arena_session=')).toBeNull();
    expect(parseSessionCookieHeader('other=x')).toBeNull();
    expect(parseSessionCookieHeader(null)).toBeNull();
    expect(parseSessionCookieHeader(undefined)).toBeNull();
    expect(parseSessionCookieHeader('')).toBeNull();
  });
});
