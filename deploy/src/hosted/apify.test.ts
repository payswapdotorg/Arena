/**
 * B015 optional Apify wiring tests: absent token => disabled (a PASSING
 * posture — Apify is never required for the primary lifecycle), present
 * token => enabled; names only, never values.
 */

import { describe, expect, it } from 'vitest';
import { APIFY_ENV_VARS, readApifyConfigFromEnv, resolveApifyWiring } from './apify.js';
import { apifyDeclaredAllowances } from './quotas.js';

describe('B015 optional Apify wiring', () => {
  it('reads exactly one env var name', () => {
    expect(APIFY_ENV_VARS).toEqual(['APIFY_TOKEN']);
  });

  it('stays disabled (never a failure) when the token is absent or blank', () => {
    expect(readApifyConfigFromEnv({})).toBeNull();
    expect(readApifyConfigFromEnv({ APIFY_TOKEN: '   ' })).toBeNull();
    const wiring = resolveApifyWiring({});
    expect(wiring.enabled).toBe(false);
    expect(wiring.config).toBeNull();
    expect(wiring.missingEnvVarNames).toEqual([]);
  });

  it('enables when the token is present (trimmed)', () => {
    const wiring = resolveApifyWiring({ APIFY_TOKEN: ' token ' });
    expect(wiring.enabled).toBe(true);
    expect(wiring.config).toEqual({ token: 'token' });
  });

  it('declares the $5 monthly-spend ceiling (the provider fails closed itself)', () => {
    expect(apifyDeclaredAllowances()).toEqual([{ dimension: 'monthly-spend-usd', limit: 5, windowMs: 2_592_000_000 }]);
  });
});
