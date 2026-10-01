/**
 * Sealed session token protocol tests (Work Order B004) — seal/open
 * round-trip, tamper => typed fail-closed rejection, version handling,
 * cross-key rejection, and the STRUCTURAL cookie contract (the token
 * carries ONLY the opaque session id — never principal/tenant/role data).
 */

import { describe, expect, it } from 'vitest';
import { AuthError, AUTH_ERROR_CODES, isAuthError } from './errors.js';
import { resolveSessionSecret } from './secret.js';
import {
  createSessionTokenSealer,
  newSessionId,
  SESSION_TOKEN_PROTOCOL_VERSION,
  SESSION_TOKEN_RECORD_VERSION,
} from './token.js';
import { TENANT_A, PRINCIPAL_DANA } from './test-support.js';

const SECRET_A = 'token-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET_B = 'token-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function sealerFor(secret: string) {
  return createSessionTokenSealer({ secret: resolveSessionSecret(() => secret) });
}

function expectAuthError(operation: () => unknown): AuthError {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(isAuthError(caught), `expected AuthError, got ${String(caught)}`).toBe(true);
  return caught as AuthError;
}

describe('sealed session token protocol', () => {
  it('round-trips: seal then open returns the session id', () => {
    const sealer = sealerFor(SECRET_A);
    const sessionId = newSessionId();
    const token = sealer.seal(sessionId);
    expect(typeof token).toBe('string');
    expect(token.startsWith('arena.st1.')).toBe(true);
    expect(sealer.open(token)).toBe(sessionId);
  });

  it('sealing is deterministic for the same id + key (the id is the nonce)', () => {
    const sealer = sealerFor(SECRET_A);
    const sessionId = newSessionId();
    expect(sealer.seal(sessionId)).toBe(sealer.seal(sessionId));
  });

  it('different keys produce different seals; a foreign key fails closed', () => {
    const sessionId = newSessionId();
    const token = sealerFor(SECRET_A).seal(sessionId);
    expect(sealerFor(SECRET_B).seal(sessionId)).not.toBe(token);
    const error = expectAuthError(() => sealerFor(SECRET_B).open(token));
    expect(error.code).toBe(AUTH_ERROR_CODES.TOKEN_TAMPERED);
    expect(error.category).toBe('integrity');
  });

  it('payload tampering fails closed (typed tamper), including single-byte flips', () => {
    const sealer = sealerFor(SECRET_A);
    const token = sealer.seal(newSessionId());
    const parts = token.split('.');
    expect(parts).toHaveLength(4);
    // Flip one character inside the payload segment.
    const payloadSegment = parts[2] as string;
    const flipped =
      payloadSegment.substring(0, 1) === 'A'
        ? `B${payloadSegment.substring(1)}`
        : `A${payloadSegment.substring(1)}`;
    const tampered = [...parts.slice(0, 2), flipped, parts[3]].join('.');
    const error = expectAuthError(() => sealer.open(tampered));
    expect(error.code).toBe(AUTH_ERROR_CODES.TOKEN_TAMPERED);
  });

  it('seal tampering fails closed (typed tamper)', () => {
    const sealer = sealerFor(SECRET_A);
    const token = sealer.seal(newSessionId());
    const parts = token.split('.');
    const sealSegment = (parts[3] as string).split('').reverse().join('');
    const tampered = [...parts.slice(0, 3), sealSegment].join('.');
    const error = expectAuthError(() => sealer.open(tampered));
    expect(error.code).toBe(AUTH_ERROR_CODES.TOKEN_TAMPERED);
  });

  it('malformed tokens fail closed with the typed MALFORMED code', () => {
    const sealer = sealerFor(SECRET_A);
    for (const malformed of [
      '',
      'arena.st1',
      'arena.st1.',
      'arena.st1.onlypayload',
      'arena.st1.payload.',
      'arena.st1.payload.seal.extra',
      'not.a.token',
      `arena.st1.${'!'.repeat(10)}.${'A'.repeat(43)}`,
      `arena.st1.${Buffer.from('not json').toString('base64url')}.${'A'.repeat(43)}`,
      `arena.st1.${Buffer.from('"just a string"').toString('base64url')}.${'A'.repeat(43)}`,
    ]) {
      const error = expectAuthError(() => sealer.open(malformed));
      expect(
        error.code === AUTH_ERROR_CODES.MALFORMED_TOKEN ||
          error.code === AUTH_ERROR_CODES.TOKEN_TAMPERED,
        `${JSON.stringify(malformed)} => ${error.code}`,
      ).toBe(true);
    }
  });

  it('unknown protocol versions fail closed with the typed VERSION code', () => {
    const sealer = sealerFor(SECRET_A);
    const token = sealer.seal(newSessionId());
    const future = token.replace('arena.st1.', 'arena.st2.');
    const error = expectAuthError(() => sealer.open(future));
    expect(error.code).toBe(AUTH_ERROR_CODES.TOKEN_VERSION_UNSUPPORTED);
    expect(error.category).toBe('versioning');
    expect(SESSION_TOKEN_PROTOCOL_VERSION).toBe(1);
    expect(SESSION_TOKEN_RECORD_VERSION).toBe(1);
  });

  it('STRUCTURAL cookie contract: the token carries ONLY the opaque session id', () => {
    const sealer = sealerFor(SECRET_A);
    const sessionId = newSessionId();
    const token = sealer.seal(sessionId);

    // The token never contains principal, tenant or role vocabulary.
    expect(token).not.toContain(TENANT_A);
    expect(token).not.toContain(PRINCIPAL_DANA);
    expect(token.toLowerCase()).not.toContain('tenant');
    expect(token.toLowerCase()).not.toContain('principal');
    expect(token.toLowerCase()).not.toContain('role');
    expect(token.toLowerCase()).not.toContain('policy');
    expect(token.toLowerCase()).not.toContain('workspace');

    // The decoded payload is exactly { recordVersion, sessionId }.
    const payloadSegment = token.split('.')[2] as string;
    const payload = JSON.parse(
      Buffer.from(payloadSegment, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['recordVersion', 'sessionId']);
    expect(payload['recordVersion']).toBe(1);
    expect(payload['sessionId']).toBe(sessionId);
  });

  it('the sealer factory REFUSES to construct on a DISABLED secret (no weak default key)', () => {
    let caught: unknown;
    try {
      createSessionTokenSealer({ secret: resolveSessionSecret(() => undefined) });
    } catch (error) {
      caught = error;
    }
    expect(isAuthError(caught)).toBe(true);
    expect((caught as AuthError).code).toBe(AUTH_ERROR_CODES.DISABLED);
  });

  it('sealing an invalid session id fails closed (typed)', () => {
    const sealer = sealerFor(SECRET_A);
    const error = expectAuthError(() => sealer.seal('not a session id!' as never));
    expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_SESSION_ID);
  });

  it('no error surface ever carries secret material (canary)', () => {
    const canary = `canary-${'k'.repeat(40)}`;
    let caught: unknown;
    try {
      createSessionTokenSealer({ secret: resolveSessionSecret(() => canary.slice(0, 10)) });
    } catch (error) {
      caught = error;
    }
    const text = `${String(caught)} ${JSON.stringify((caught as AuthError | undefined)?.details ?? {})}`;
    expect(text).not.toContain(canary.slice(0, 12));
    // Enabled path: tokens and errors never echo the key either.
    const sealer = createSessionTokenSealer({
      secret: resolveSessionSecret(() => canary),
    });
    const token = sealer.seal(newSessionId());
    expect(token).not.toContain(canary.slice(0, 12));
    const error = expectAuthError(() => sealer.open('arena.st1.junk.junk'));
    expect(`${error.message} ${JSON.stringify(error.details ?? {})}`).not.toContain(
      canary.slice(0, 12),
    );
  });
});
