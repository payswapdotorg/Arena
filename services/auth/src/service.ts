/**
 * @arena/auth-service — the AuthService (Work Order B004; issue #69).
 *
 * Composes the sealed session token protocol (@arena/auth) with an
 * injected SessionStore, an injected credential-verifier port and the
 * injected B002 Clock. Authorization stays OUT: every operation returns
 * identity + the B003 workspace context; the opaque PermissionPolicy is
 * carried, never interpreted, never filtered.
 *
 * Fail-closed contract (the B004 acceptance block):
 *   - constructing the service with a DISABLED secret resolution THROWS
 *     typed AUTH_DISABLED (the factory refuses to construct — no weak
 *     default key exists anywhere);
 *   - `authenticate` NEVER returns an anonymous principal (typed
 *     AUTH_INVALID_CREDENTIALS on failure);
 *   - `validateSession` fails closed on malformed/tampered tokens,
 *     expired/revoked/rotated/unknown sessions, and cross-tenant
 *     expectations (typed AUTH_TENANT_SCOPE_VIOLATION) — it NEVER degrades
 *     to an anonymous session;
 *   - the issued cookie carries ONLY the opaque sealed session id.
 */

import {
  AUTH_ERROR_CODES,
  AuthError,
  createAuthMethodDescriptor,
  createSessionRecord,
  isAuthError,
  newSessionId,
  sessionCookieSpec,
  toSessionRecord,
} from '@arena/auth';
import type {
  AuthMethodDescriptor,
  SessionPolicy,
  SessionRecord,
  SessionSecretResolution,
  SessionTokenSealer,
} from '@arena/auth';
import { createSessionTokenSealer } from '@arena/auth';
import { DEFAULT_SESSION_POLICY } from '@arena/auth';
import { isSessionTenantId } from '@arena/auth';
import type { SecurityPrincipal, TenantScopedRef } from '@arena/security';
import type { WorkspaceContext } from '@arena/role-context';
import type { Clock } from '@arena/persistence';
import type { CredentialVerifier } from './ports.js';
import { makeAuthenticatedSession } from './shared.js';
import type { AuthenticatedSession, SessionIssuance } from './shared.js';

/** The input of issueSession: what the composition root resolved for a principal. */
export interface IssueSessionInput {
  readonly principal: SecurityPrincipal;
  readonly tenantId: string;
  readonly workspaceContext: WorkspaceContext;
  /** Provenance override; defaults to the customer-identity boundary ref. */
  readonly tenantRef?: TenantScopedRef;
  /** HOW the principal authenticated (the opaque provenance to record). */
  readonly authMethod: AuthMethodDescriptor;
}

/** Validation options: the tenant the caller expects the session to serve. */
export interface ValidateSessionOptions {
  readonly expectedTenantId?: string;
}

export interface AuthServiceDeps {
  readonly clock: Clock;
  readonly store: import('@arena/auth').SessionStore;
  /** The resolved ARENA_SESSION_SECRET contract — DISABLED refuses construction. */
  readonly secret: SessionSecretResolution;
  readonly verifier: CredentialVerifier;
  /** Session policy override (defaults to the 12h/1h house default). */
  readonly policy?: SessionPolicy;
  /** Whether the cookie carries the Secure flag (production: true). */
  readonly cookieSecure: boolean;
}

export class AuthService {
  private readonly clock: Clock;
  private readonly store: import('@arena/auth').SessionStore;
  private readonly sealer: SessionTokenSealer;
  private readonly verifier: CredentialVerifier;
  private readonly policy: SessionPolicy;
  private readonly cookieSecure: boolean;

  constructor(deps: AuthServiceDeps) {
    if (typeof deps.clock?.now !== 'function') {
      throw new AuthError(AUTH_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'AuthService requires an injected Clock',
      });
    }
    if (typeof deps.verifier?.verify !== 'function') {
      throw new AuthError(AUTH_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'AuthService requires an injected CredentialVerifier',
      });
    }
    if (typeof deps.cookieSecure !== 'boolean') {
      throw new AuthError(AUTH_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'AuthService requires an explicit cookieSecure flag',
      });
    }
    // FAIL CLOSED: a DISABLED secret resolution refuses construction.
    // (createSessionTokenSealer throws the typed AUTH_DISABLED error.)
    this.sealer = createSessionTokenSealer({ secret: deps.secret });
    this.clock = deps.clock;
    this.store = deps.store;
    this.verifier = deps.verifier;
    this.policy = deps.policy ?? DEFAULT_SESSION_POLICY;
    this.cookieSecure = deps.cookieSecure;
  }

  /**
   * Verify a credential descriptor and return the authenticated principal.
   * Fail closed: typed AUTH_INVALID_CREDENTIALS / AUTH_INVALID_AUTH_METHOD;
   * NEVER an anonymous fallback.
   */
  async authenticate(credential: {
    readonly method: string;
    readonly claims?: Readonly<Record<string, unknown>>;
  }): Promise<SecurityPrincipal> {
    const descriptor = createAuthMethodDescriptor({
      method: credential.method,
      ...(credential.claims !== undefined ? { claims: credential.claims } : {}),
    });
    try {
      return await this.verifier.verify(descriptor);
    } catch (error) {
      if (isAuthError(error)) throw error;
      throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, {
        message: 'credential verification failed',
        cause: error,
      });
    }
  }

  /**
   * Issue a tenant-scoped session: validates the tenant consistency of the
   * principal, the workspace context and the provenance ref (fail closed),
   * stores the record (the store stamps the revocation epoch) and returns
   * the view + the cookie contract to set.
   */
  async issueSession(input: IssueSessionInput): Promise<SessionIssuance> {
    const now = this.clock.now();
    const record = createSessionRecord({
      sessionId: newSessionId(),
      principal: input.principal,
      tenantId: input.tenantId,
      ...(input.tenantRef !== undefined ? { tenantRef: input.tenantRef } : {}),
      workspaceContext: input.workspaceContext,
      authMethod: input.authMethod,
      issuedAt: now,
      policy: this.policy,
    });
    const stored = await this.store.issue(record);
    return this.toIssuance(stored, now);
  }

  /**
   * Validate a sealed session cookie value. Fail-closed typed outcomes for
   * every failure; when `expectedTenantId` is provided, a session issued
   * for another tenant is a typed AUTH_TENANT_SCOPE_VIOLATION.
   */
  async validateSession(
    cookieValue: string,
    options: ValidateSessionOptions = {},
  ): Promise<AuthenticatedSession> {
    const sessionId = this.sealer.open(cookieValue);
    const outcome = await this.store.validate(sessionId);
    if (outcome.status !== 'valid' || outcome.session === null) {
      const code =
        outcome.status === 'expired'
          ? AUTH_ERROR_CODES.SESSION_EXPIRED
          : outcome.status === 'revoked'
            ? AUTH_ERROR_CODES.SESSION_REVOKED
            : outcome.status === 'rotated'
              ? AUTH_ERROR_CODES.SESSION_ROTATED
              : AUTH_ERROR_CODES.SESSION_NOT_FOUND;
      throw new AuthError(code, {
        message: `session validation failed: ${outcome.status}`,
        details: { status: outcome.status },
      });
    }
    // Defense in depth: storage corruption can never yield a usable session.
    const record = this.revalidateRecord(outcome.session);
    if (options.expectedTenantId !== undefined) {
      if (!isSessionTenantId(options.expectedTenantId)) {
        throw new AuthError(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
          message: `invalid expected tenant id: ${JSON.stringify(options.expectedTenantId)}`,
        });
      }
      if (String(record.tenantId) !== String(options.expectedTenantId)) {
        throw new AuthError(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
          message: `session belongs to tenant ${String(record.tenantId)}, not the expected tenant ${String(options.expectedTenantId)}`,
          details: {
            sessionTenant: String(record.tenantId),
            expectedTenant: String(options.expectedTenantId),
          },
        });
      }
    }
    return makeAuthenticatedSession(record, this.clock.now());
  }

  /**
   * Rotate a live session ONE-TIME: a fresh session id + fresh windows over
   * the SAME claims (principal, tenant, workspace snapshot, provenance).
   * The old cookie becomes invalid (typed AUTH_SESSION_ROTATED on replay).
   */
  async rotateSession(cookieValue: string): Promise<SessionIssuance> {
    const sessionId = this.sealer.open(cookieValue);
    const current = await this.requireValidSession(sessionId);
    const now = this.clock.now();
    const next = createSessionRecord({
      sessionId: newSessionId(),
      principal: current.principal,
      tenantId: current.tenantId,
      tenantRef: current.tenantRef,
      workspaceContext: current.workspaceContext,
      authMethod: current.authMethod,
      issuedAt: now,
      policy: this.policy,
    });
    const stored = await this.store.rotate(sessionId, next);
    return this.toIssuance(stored, now);
  }

  /** Revoke the session addressed by a sealed cookie value. */
  async revokeSession(cookieValue: string): Promise<boolean> {
    const sessionId = this.sealer.open(cookieValue);
    return this.store.revoke(sessionId);
  }

  /** Revoke every live session for a principal (epoch bump). */
  async revokeAll(principalId: string): Promise<number> {
    return this.store.revokeAllForPrincipal(principalId);
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private async requireValidSession(sessionId: string): Promise<SessionRecord> {
    const outcome = await this.store.validate(sessionId);
    if (outcome.status !== 'valid' || outcome.session === null) {
      const code =
        outcome.status === 'expired'
          ? AUTH_ERROR_CODES.SESSION_EXPIRED
          : outcome.status === 'revoked'
            ? AUTH_ERROR_CODES.SESSION_REVOKED
            : outcome.status === 'rotated'
              ? AUTH_ERROR_CODES.SESSION_ROTATED
              : AUTH_ERROR_CODES.SESSION_NOT_FOUND;
      throw new AuthError(code, {
        message: `cannot rotate a session in state ${outcome.status}`,
        details: { status: outcome.status },
      });
    }
    return this.revalidateRecord(outcome.session);
  }

  private revalidateRecord(session: SessionRecord): SessionRecord {
    try {
      return toSessionRecord(session);
    } catch (cause) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
        message: 'stored session record failed revalidation (fail closed)',
        cause,
      });
    }
  }

  private toIssuance(stored: SessionRecord, now: number): SessionIssuance {
    const cookieValue = this.sealer.seal(stored.sessionId);
    const cookie = sessionCookieSpec(cookieValue, {
      secure: this.cookieSecure,
      maxAgeSeconds: Math.floor((stored.expiresAt - now) / 1000),
    });
    return {
      recordVersion: 1,
      session: makeAuthenticatedSession(stored, now),
      cookie,
    };
  }
}
