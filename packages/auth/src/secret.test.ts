/**
 * ARENA_SESSION_SECRET contract tests (Work Order B004) — the DISABLED
 * fail-closed posture. A deliberately recognizable CANARY secret value is
 * placed in the lookup; no observable surface (errors, resolutions,
 * stringified errors) may ever contain it.
 */

import { describe, expect, it } from 'vitest';
import { AuthError, AUTH_ERROR_CODES, isAuthError } from './errors.js';
import {
  assertSessionSecretEnabled,
  MIN_SESSION_SECRET_LENGTH,
  resolveSessionSecret,
  SESSION_SECRET_ENV_VAR,
} from './secret.js';

const CANARY = 'canary-secret-value-0123456789-abcdefghijklmnopqrstuvwxyz';

describe('session secret resolution', () => {
  it('resolves ENABLED for a sufficient secret', () => {
    const resolution = resolveSessionSecret(() => CANARY);
    expect(resolution.status).toBe('enabled');
    if (resolution.status === 'enabled') {
      expect(resolution.secret).toBe(CANARY);
    }
  });

  it('resolves DISABLED (missing) for absent, empty and whitespace-only values', () => {
    for (const [name, lookup] of [
      ['absent', (): undefined => undefined],
      ['empty', (): string => ''],
      ['whitespace', (): string => '   '],
    ] as const) {
      const resolution = resolveSessionSecret(lookup);
      expect(resolution.status, name).toBe('disabled');
      if (resolution.status === 'disabled') {
        expect(resolution.reason).toBe('missing');
        expect(resolution.envVar).toBe(SESSION_SECRET_ENV_VAR);
      }
    }
  });

  it('resolves DISABLED (too-short) below the enforced entropy floor', () => {
    for (const short of ['a', 'short-secret', 'x'.repeat(31)]) {
      const resolution = resolveSessionSecret(() => short);
      expect(resolution.status).toBe('disabled');
      if (resolution.status === 'disabled') {
        expect(resolution.reason).toBe('too-short');
      }
    }
    // Exactly at the floor is ENABLED (the floor is inclusive).
    expect(resolveSessionSecret(() => 'a'.repeat(MIN_SESSION_SECRET_LENGTH)).status).toBe(
      'enabled',
    );
  });

  it('the enabled-guard REFUSES to construct on DISABLED (typed, never a weak key)', () => {
    for (const resolution of [
      resolveSessionSecret(() => undefined),
      resolveSessionSecret(() => 'too-short'),
    ]) {
      let caught: unknown;
      try {
        assertSessionSecretEnabled(resolution);
      } catch (error) {
        caught = error;
      }
      expect(isAuthError(caught)).toBe(true);
      const authError = caught as AuthError;
      expect(authError.code).toBe(AUTH_ERROR_CODES.DISABLED);
      expect(authError.category).toBe('configuration');
      expect(authError.message).toContain(SESSION_SECRET_ENV_VAR);
      // The error carries the env-var NAME, never any secret material.
      expect(authError.message).not.toContain(CANARY);
    }
  });

  it('no error surface ever exposes secret material (canary)', () => {
    const canary = `canary-${'k'.repeat(40)}`;
    const disabled = resolveSessionSecret(() => canary.slice(0, 5));
    const surfaces = [
      JSON.stringify(disabled),
      String(disabled.status),
      (() => {
        try {
          assertSessionSecretEnabled(disabled);
        } catch (error) {
          return `${String(error)} ${JSON.stringify((error as AuthError).details ?? {})}`;
        }
        return '';
      })(),
    ];
    for (const surface of surfaces) {
      expect(surface.includes(canary.slice(0, 12))).toBe(false);
    }
  });
});
