/**
 * The Next.js server-side session boundary (Work Order B004; issue #69;
 * BRIEF.md §4.3 — apps/web/src/auth/session.ts).
 *
 * SERVER-ONLY surface: every helper here validates BEFORE returning —
 * a missing cookie is a typed AUTH_SESSION_NOT_FOUND, never a silent
 * anonymous session (fail closed, the B004 acceptance contract).
 *
 * Composition: the boundary is configured ONCE at server startup with an
 * `AuthService` (`configureSessionBoundary`) — `createEnvSessionBoundary`
 * is the env-driven default composition (ARENA_SESSION_SECRET via the
 * injected env lookup; a missing/short secret makes the factory throw the
 * typed AUTH_DISABLED error — there is no weak default key). The default
 * store is the in-memory fake and the default credential seam accepts no
 * registered entries (B006 owns Demo mode; B005/B007 mount the durable
 * control-plane store) — the SEAM is the point, not the default.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched
 * (the boundary-check layer rules stay satisfied: app -> service ->
 * domain). The .js suffix matches the house import style (bundler
 * resolution with TS extension substitution).
 */

import { cookies } from 'next/headers';
import {
  AUTH_ERROR_CODES,
  AuthError,
  FakeSessionStore,
  SystemAuthClock,
  clearedSessionCookieSpec,
  SESSION_COOKIE_NAME,
} from '../../../../packages/auth/src/index.js';
import type {
  SessionCookieSpec,
  SessionPolicy,
  SessionStore,
} from '../../../../packages/auth/src/index.js';
import {
  AuthService,
  StaticCredentialVerifier,
  sessionSecretFromEnv,
} from '../../../../services/auth/src/index.js';
import type {
  AuthenticatedSession,
  CredentialVerifier,
  IssueSessionInput,
  ValidateSessionOptions,
} from '../../../../services/auth/src/index.js';

/** The composed session boundary (frozen on configuration). */
export interface SessionBoundaryComposition {
  /** The auth service (identity + workspace context; never permissions). */
  readonly service: AuthService;
  /** Whether the session cookie carries the Secure flag (production). */
  readonly cookieSecure: boolean;
}

let composition: SessionBoundaryComposition | null = null;

/** Configure the boundary ONCE at server startup (idempotent overwrite). */
export function configureSessionBoundary(
  next: SessionBoundaryComposition,
): SessionBoundaryComposition {
  composition = Object.freeze({ service: next.service, cookieSecure: next.cookieSecure });
  return composition;
}

/** The active composition (typed failure when unconfigured — fail closed). */
export function sessionBoundary(): SessionBoundaryComposition {
  if (composition === null) {
    throw new AuthError(AUTH_ERROR_CODES.UNKNOWN_ERROR, {
      message:
        'the web session boundary is not configured — call configureSessionBoundary(...) once at server startup',
    });
  }
  return composition;
}

export interface EnvSessionBoundaryOptions {
  /** Session store override; defaults to the in-memory fake (local parity). */
  readonly store?: SessionStore;
  /** Credential seam override; defaults to an EMPTY static verifier. */
  readonly verifier?: CredentialVerifier;
  /** Session policy override (defaults to the 12h/1h house default). */
  readonly policy?: SessionPolicy;
  /** Cookie Secure flag; defaults to production detection. */
  readonly cookieSecure?: boolean;
  /** Env source override; defaults to process.env (test seam). */
  readonly env?: Record<string, string | undefined>;
}

/**
 * The env-driven default composition. FAIL CLOSED: a missing/short
 * ARENA_SESSION_SECRET resolves DISABLED and the AuthService factory
 * refuses to construct (typed AUTH_DISABLED — no weak default key).
 */
export function createEnvSessionBoundary(
  options: EnvSessionBoundaryOptions = {},
): SessionBoundaryComposition {
  const service = new AuthService({
    clock: new SystemAuthClock(),
    store: options.store ?? new FakeSessionStore(),
    secret: sessionSecretFromEnv(options.env ?? process.env),
    verifier: options.verifier ?? new StaticCredentialVerifier([]),
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
    cookieSecure:
      options.cookieSecure ?? process.env['NODE_ENV'] === 'production',
  });
  return {
    service,
    cookieSecure:
      options.cookieSecure ?? process.env['NODE_ENV'] === 'production',
  };
}

// ---------------------------------------------------------------------------
// Cookie materialization (the exact @arena/auth cookie contract)
// ---------------------------------------------------------------------------

async function applySessionCookie(spec: SessionCookieSpec): Promise<void> {
  const jar = await cookies();
  jar.set(spec.name, spec.value, {
    httpOnly: spec.httpOnly,
    sameSite: spec.sameSite.toLowerCase() as 'lax' | 'strict' | 'none',
    secure: spec.secure,
    path: spec.path,
    maxAge: spec.maxAgeSeconds,
  });
}

/** The raw session cookie value from the request (null when absent). */
export async function readSessionCookieValue(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE_NAME)?.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

function requireCookieValue(): never {
  // Synchronous typed failure for helpers that already hold the jar read.
  throw new AuthError(AUTH_ERROR_CODES.SESSION_NOT_FOUND, {
    message:
      'no session cookie is present (fail closed — never an anonymous session)',
  });
}

// ---------------------------------------------------------------------------
// The session helpers (read / issue / rotate / revoke — all validate first)
// ---------------------------------------------------------------------------

/** Read + validate the current session (typed fail-closed outcomes). */
export async function readSession(
  options: ValidateSessionOptions = {},
): Promise<AuthenticatedSession> {
  const value = await readSessionCookieValue();
  if (value === null) requireCookieValue();
  return sessionBoundary().service.validateSession(value, options);
}

/** Issue a session and set the arena_session cookie. */
export async function issueSession(
  input: IssueSessionInput,
): Promise<AuthenticatedSession> {
  const boundary = sessionBoundary();
  const issuance = await boundary.service.issueSession(input);
  await applySessionCookie(issuance.cookie);
  return issuance.session;
}

/** Rotate the current session one-time and refresh the cookie. */
export async function rotateCurrentSession(): Promise<AuthenticatedSession> {
  const value = await readSessionCookieValue();
  if (value === null) requireCookieValue();
  const issuance = await sessionBoundary().service.rotateSession(value);
  await applySessionCookie(issuance.cookie);
  return issuance.session;
}

/** Revoke the current session (if any) and clear the cookie. */
export async function revokeCurrentSession(): Promise<boolean> {
  const boundary = sessionBoundary();
  const value = await readSessionCookieValue();
  const revoked = value === null ? false : await boundary.service.revokeSession(value);
  await applySessionCookie(
    clearedSessionCookieSpec({ secure: boundary.cookieSecure }),
  );
  return revoked;
}
