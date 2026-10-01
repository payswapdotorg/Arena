/**
 * The sealed session token protocol (Work Order B004; issue #69).
 *
 * A session token is an OPAQUE server-side session id inside a SEALED
 * envelope:
 *
 *   arena.st1.<base64url(payload)>.<base64url(seal)>
 *
 *   - `arena.st1`  — the self-describing protocol prefix (`st` = session
 *                    token, `1` = protocol version 1). Unknown versions are
 *                    a typed AUTH_TOKEN_VERSION_UNSUPPORTED rejection.
 *   - `payload`    — canonical JSON (protocol-core canonicalJson) of
 *                    `{ recordVersion: 1, sessionId }` — NOTHING else. The
 *                    cookie contract forbids principal, tenant or role data
 *                    in the token, and the payload shape makes that
 *                    structural: there is no field to put them in.
 *   - `seal`       — HMAC-SHA256 (node:crypto — ZERO external dependencies)
 *                    over the domain-separated string
 *                    `arena:session-seal:v1:<payload-canonical-json>`, keyed
 *                    by the ARENA_SESSION_SECRET resolution.
 *
 * Sealing is deterministic (same session id + same key => same token) —
 * the unguessable 128-bit session id is the nonce; the seal exists to make
 * FORGERY and TAMPERING fail closed with typed errors before any storage
 * read happens.
 *
 * The seal comparison uses `timingSafeEqual`; the key material is held in
 * the closure and is never exposed by any method, error or log line
 * (canary-tested).
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '@arena/protocol-core';
import { AUTH_ERROR_CODES, AuthError } from './errors.js';
import { assertSessionSecretEnabled } from './secret.js';
import type { SessionSecretResolution } from './secret.js';
import { isSessionId } from './shared.js';
import type { SessionId } from './shared.js';

/** Wire version of the sealed envelope payload shape. */
export const SESSION_TOKEN_RECORD_VERSION = 1 as const;

/** Protocol version embedded in the token prefix (`arena.st<N>.`). */
export const SESSION_TOKEN_PROTOCOL_VERSION = 1 as const;

const TOKEN_PREFIX = `arena.st${String(SESSION_TOKEN_PROTOCOL_VERSION)}.`;

/** Domain-separation prefix for the HMAC input (never the bare payload). */
const SEAL_DOMAIN = `arena:session-seal:v${String(SESSION_TOKEN_PROTOCOL_VERSION)}:`;

/** Version-shaped prefixes an opener may recognize but reject (`arena.st<N>.`). */
const VERSION_PREFIX_PATTERN = /^arena\.st(\d+)\./;

/** Mint a fresh opaque session id (UUIDv4 via node:crypto — 122 random bits). */
export function newSessionId(): SessionId {
  return randomUUID() as SessionId;
}

// ---------------------------------------------------------------------------
// base64url (unpadded — cookie-safe)
// ---------------------------------------------------------------------------

function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function fromBase64Url(segment: string): string {
  return Buffer.from(segment, 'base64url').toString('utf8');
}

function isBase64UrlSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment);
}

// ---------------------------------------------------------------------------
// Sealed-envelope payload
// ---------------------------------------------------------------------------

/** The ONLY fields a sealed envelope may carry (the structural cookie contract). */
export interface SessionTokenPayload {
  readonly recordVersion: typeof SESSION_TOKEN_RECORD_VERSION;
  readonly sessionId: SessionId;
}

function canonicalPayload(sessionId: SessionId): string {
  return canonicalJson({
    recordVersion: SESSION_TOKEN_RECORD_VERSION,
    sessionId,
  });
}

/** Constant-time seal comparison over equal-length digests. */
function sealMatches(expected: Buffer, received: string): boolean {
  let candidate: Buffer;
  try {
    candidate = Buffer.from(received, 'base64url');
  } catch {
    return false;
  }
  if (candidate.length !== expected.length || candidate.length === 0) {
    return false;
  }
  return timingSafeEqual(expected, candidate);
}

// ---------------------------------------------------------------------------
// The sealer
// ---------------------------------------------------------------------------

/**
 * The sealed-session factory. REFUSES TO CONSTRUCT when the secret
 * resolution is DISABLED (typed AUTH_DISABLED — a factory that refuses
 * beats a weak default key). The held key never leaves the closure.
 */
export interface SessionTokenSealer {
  /** Seal a session id into its opaque token (deterministic). */
  seal(sessionId: SessionId): string;
  /**
   * Open a sealed token and return the session id. Fail-closed typed
   * rejections: AUTH_MALFORMED_TOKEN (unparseable), AUTH_TOKEN_TAMPERED
   * (seal mismatch), AUTH_TOKEN_VERSION_UNSUPPORTED (future format).
   */
  open(token: string): SessionId;
}

export interface SessionTokenSealerOptions {
  /** The resolved ARENA_SESSION_SECRET contract (DISABLED refuses construction). */
  readonly secret: SessionSecretResolution;
}

export function createSessionTokenSealer(
  options: SessionTokenSealerOptions,
): SessionTokenSealer {
  // Fail closed BEFORE the key is ever used: disabled => no sealer exists.
  const key = assertSessionSecretEnabled(options.secret);
  const keyBuffer = Buffer.from(key, 'utf8');

  const sealFor = (sessionId: SessionId): string => {
    if (!isSessionId(sessionId)) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_ID, {
        message: 'cannot seal an invalid session id',
      });
    }
    const payload = canonicalPayload(sessionId);
    const seal = createHmac('sha256', keyBuffer)
      .update(`${SEAL_DOMAIN}${payload}`)
      .digest('base64url');
    return `${TOKEN_PREFIX}${toBase64Url(payload)}.${seal}`;
  };

  const openSealed = (token: string): SessionId => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token must be a non-empty string',
      });
    }
    if (!token.startsWith('arena.st')) {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token does not carry the arena session-token prefix',
      });
    }
    const versionMatch = VERSION_PREFIX_PATTERN.exec(token);
    if (versionMatch === null) {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token prefix is malformed',
      });
    }
    const version = Number(versionMatch[1]);
    if (!Number.isInteger(version) || version !== SESSION_TOKEN_PROTOCOL_VERSION) {
      throw new AuthError(AUTH_ERROR_CODES.TOKEN_VERSION_UNSUPPORTED, {
        message: `unsupported session token protocol version: ${versionMatch[1] ?? 'unknown'} (this build understands ${String(SESSION_TOKEN_PROTOCOL_VERSION)})`,
        details: { tokenProtocolVersion: version },
      });
    }
    if (!token.startsWith(TOKEN_PREFIX)) {
      // Unreachable after the version check; kept for defense in depth.
      throw new AuthError(AUTH_ERROR_CODES.TOKEN_VERSION_UNSUPPORTED, {
        message: 'session token prefix does not match the understood protocol version',
      });
    }
    const remainder = token.slice(TOKEN_PREFIX.length);
    const dot = remainder.lastIndexOf('.');
    if (dot <= 0 || dot === remainder.length - 1) {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token must carry exactly one payload segment and one seal segment',
      });
    }
    const payloadSegment = remainder.slice(0, dot);
    const sealSegment = remainder.slice(dot + 1);
    if (!isBase64UrlSegment(payloadSegment) || !isBase64UrlSegment(sealSegment)) {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token segments must be base64url',
      });
    }

    let payloadText: string;
    try {
      payloadText = fromBase64Url(payloadSegment);
    } catch {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token payload is not decodable',
      });
    }

    // Verify the seal BEFORE trusting the payload (fail closed on tamper).
    const expected = createHmac('sha256', keyBuffer)
      .update(`${SEAL_DOMAIN}${payloadText}`)
      .digest();
    if (!sealMatches(expected, sealSegment)) {
      throw new AuthError(AUTH_ERROR_CODES.TOKEN_TAMPERED, {
        message: 'session token seal verification failed (tampered or foreign token)',
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadText) as unknown;
    } catch {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token payload is not valid JSON',
      });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token payload must be a plain object',
      });
    }
    const record = parsed as Record<string, unknown>;
    if (record['recordVersion'] !== SESSION_TOKEN_RECORD_VERSION) {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: `session token payload recordVersion must be ${String(SESSION_TOKEN_RECORD_VERSION)}`,
      });
    }
    const sessionId = record['sessionId'];
    if (!isSessionId(sessionId)) {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token payload does not carry a valid session id',
      });
    }
    // Reject smuggled extra fields: the envelope carries ONLY the version + id.
    const fieldNames = Object.keys(record).sort();
    if (fieldNames.length !== 2 || fieldNames[0] !== 'recordVersion' || fieldNames[1] !== 'sessionId') {
      throw new AuthError(AUTH_ERROR_CODES.MALFORMED_TOKEN, {
        message: 'session token payload carries unexpected fields (the envelope holds only the record version and the opaque session id)',
      });
    }
    return sessionId;
  };

  return Object.freeze({ seal: sealFor, open: openSealed });
}
