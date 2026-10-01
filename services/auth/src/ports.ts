/**
 * Auth service ports (Work Order B004) — the ONLY things
 * services/auth depends on beyond its workspace packages (the
 * services/persistence precedent: inject everything; ALL effects go
 * through ports).
 *
 * The service is provider-neutral BY CONSTRUCTION:
 *   - credential verification is an injected `CredentialVerifier` port (a
 *     real verifier arrives with B015+; the local/demo seam is the
 *     `StaticCredentialVerifier` over CALLER-REGISTERED entries — no demo
 *     users are hardcoded here, B006 owns Demo mode);
 *   - the session secret resolves through an injected env-lookup (the
 *     production composition passes `process.env`; nothing here reads the
 *     environment directly);
 *   - time is injected (the B002 Clock seam).
 *
 * Authority boundary (spec/service-boundaries.md "Control/API"): this
 * service owns the session boundary and the issuance/validation lifecycle.
 * It NEVER decides permissions — the B003 PermissionPolicy descriptor
 * stays opaque and untouched — and never reaches into another service's
 * state.
 */

import { resolveSessionSecret } from '@arena/auth';
import type { AuthMethodDescriptor, SessionSecretResolution } from '@arena/auth';
import { AUTH_ERROR_CODES, AuthError } from '@arena/auth';
import { canonicalJson } from '@arena/protocol-core';
import type { SecurityPrincipal } from '@arena/security';
import { isSecurityPrincipal } from '@arena/security';
import type { Clock } from '@arena/persistence';

/** Injected time source (epoch milliseconds; the B002 Clock seam). */
export type { Clock };

// ---------------------------------------------------------------------------
// Credential verification (provider-neutral port)
// ---------------------------------------------------------------------------

/**
 * Verifies a credential descriptor and returns the authenticated A034
 * principal. Implementations MUST fail closed (typed error on failure);
 * they NEVER return an anonymous principal.
 */
export interface CredentialVerifier {
  verify(credential: AuthMethodDescriptor): Promise<SecurityPrincipal>;
}

/** One caller-registered credential → principal entry (the local/Demo seam). */
export interface StaticCredentialEntry {
  readonly credential: AuthMethodDescriptor;
  readonly principal: SecurityPrincipal;
}

/**
 * The local-parity credential verifier: verifies a descriptor against
 * CALLER-REGISTERED entries (exact canonical-JSON match). This is the SEAM
 * B006 uses to mount Demo mode credentials — no users are hardcoded here.
 * Fails closed with AUTH_INVALID_CREDENTIALS on any miss.
 */
export class StaticCredentialVerifier implements CredentialVerifier {
  private readonly entries = new Map<string, SecurityPrincipal>();

  constructor(input: readonly StaticCredentialEntry[]) {
    if (!Array.isArray(input)) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, {
        message: 'static credential entries must be an array',
      });
    }
    for (const entry of input) {
      if (!isSecurityPrincipal(entry.principal)) {
        throw new AuthError(AUTH_ERROR_CODES.INVALID_PRINCIPAL, {
          message: 'static credential entries must carry valid SecurityPrincipal records',
        });
      }
      const key = canonicalJson(entry.credential);
      if (this.entries.has(key)) {
        throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, {
          message: 'duplicate static credential entry',
        });
      }
      this.entries.set(key, entry.principal);
    }
  }

  async verify(credential: AuthMethodDescriptor): Promise<SecurityPrincipal> {
    const principal = this.entries.get(canonicalJson(credential));
    if (principal === undefined) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, {
        message: 'credential verification failed (no matching credential)',
      });
    }
    return principal;
  }
}

// ---------------------------------------------------------------------------
// Session secret resolution (env-lookup injection)
// ---------------------------------------------------------------------------

/**
 * Resolve ARENA_SESSION_SECRET from an injected env source (object or
 * getter). Missing/short secrets resolve to the DISABLED posture — the
 * AuthService factory then refuses to construct (fail closed).
 */
export function sessionSecretFromEnv(
  env: Record<string, string | undefined> | ((name: string) => string | undefined),
): SessionSecretResolution {
  const lookup =
    typeof env === 'function' ? env : (name: string): string | undefined => env[name];
  return resolveSessionSecret(lookup);
}
