/**
 * services/escalation-api/src/http-host/auth.ts — the scoped API-key auth
 * boundary (Work Order P003; issue #155; ADR-P001-08 rule 2).
 *
 * "Auth: developer-platform scoped API keys + tenant policy at the
 * boundary — the closed scope vocabulary, the `keys:manage` non-delegation
 * law, the append-only rotate/revoke lifecycle, and the sandbox/live
 * environment separation stand as delivered."
 *
 * This module owns ONLY the wire-level concerns of that law:
 *   - parsing the `Authorization: Bearer <secret>` header;
 *   - the secret WIRE SHAPE mirror (`dak_<environment>_<64 hex>` — the
 *     pattern source mirror of @arena/developer-platform's
 *     DEVELOPER_KEY_SECRET_PATTERN_SOURCE, pinned by tests/api-host);
 *   - routing a missing/malformed presentation to the typed
 *     `secret-invalid` denial (an absent or garbage header is an invalid
 *     secret — the existing closed vocabulary, never a new code);
 *   - tenant binding: the authenticated identity's tenant is THE tenant of
 *     every request; a client-claimed tenant that disagrees fails closed
 *     with the typed `tenant-mismatch` denial.
 *
 * The verdict itself comes from the injected `ApiKeyAuthenticator`
 * (./ports.ts) — satisfied at the composition site by the REAL
 * developer-platform key model (issueDeveloperKey / authorizeDeveloperKey).
 */

import type {
  ApiKeyAuthenticator,
  ApiKeyAuthorization,
  ApiKeyEnvironment,
  ApiKeyIdentity,
  ApiKeyScope,
} from './ports.js';

/** The auth scheme the public transport accepts (RFC 9110 case-insensitive). */
export const API_KEY_AUTH_SCHEME = 'bearer' as const;

/**
 * The API-key secret wire shape — MIRROR of
 * `@arena/developer-platform`'s DEVELOPER_KEY_SECRET_PATTERN_SOURCE
 * (`^dak_(sandbox|live)_[0-9a-f]{64}$`). The value is the CONTRACT PATTERN;
 * tests/api-host pins it against the real pattern source.
 */
export const API_KEY_SECRET_PATTERN_SOURCE =
  '^dak_(sandbox|live)_[0-9a-f]{64}$' as const;

const SECRET_PATTERN = new RegExp(API_KEY_SECRET_PATTERN_SOURCE);

/** Is this a well-formed developer key secret (wire shape only — no secret material stored)? */
export function isApiKeySecretShape(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** The parsed outcome of one Authorization header (machine-readable). */
export type AuthorizationHeaderParse =
  | { readonly outcome: 'presented'; readonly secret: string }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'header-missing'
        | 'scheme-missing'
        | 'scheme-unsupported'
        | 'secret-malformed';
    };

/** Parse the Authorization header (strict, fail-closed, never throws). */
export function parseAuthorizationHeader(value: string | undefined): AuthorizationHeaderParse {
  if (value === undefined || value.trim().length === 0) {
    return { outcome: 'rejected', reason: 'header-missing' };
  }
  const trimmed = value.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex <= 0) {
    return { outcome: 'rejected', reason: 'scheme-missing' };
  }
  const scheme = trimmed.slice(0, spaceIndex).toLowerCase();
  const secret = trimmed.slice(spaceIndex + 1).trim();
  if (scheme !== API_KEY_AUTH_SCHEME) {
    return { outcome: 'rejected', reason: 'scheme-unsupported' };
  }
  if (secret.length === 0 || !isApiKeySecretShape(secret)) {
    return { outcome: 'rejected', reason: 'secret-malformed' };
  }
  return { outcome: 'presented', secret };
}

/** The fail-closed result of one boundary authorization attempt. */
export type BoundaryAuthorization =
  | { readonly outcome: 'authorized'; readonly identity: ApiKeyIdentity }
  | {
      readonly outcome: 'denied';
      readonly reason: Exclude<
        import('./ports.js').ApiKeyDenialReason,
        'tenant-mismatch'
      >;
    };

/**
 * Authenticate one request at the boundary: parse the Authorization
 * header, then resolve the fail-closed verdict for the required scope +
 * environment. A missing or malformed presentation renders as the typed
 * `secret-invalid` denial (never a second code family) — the transport
 * short-circuits before consulting the authenticator, mirroring the real
 * key model's own shape check ordering.
 */
export async function authorizeBoundaryRequest(input: {
  readonly authenticator: ApiKeyAuthenticator;
  readonly authorizationHeader: string | undefined;
  readonly scope: ApiKeyScope;
  readonly environment: ApiKeyEnvironment;
}): Promise<BoundaryAuthorization> {
  const parsed = parseAuthorizationHeader(input.authorizationHeader);
  if (parsed.outcome === 'rejected') {
    return { outcome: 'denied', reason: 'secret-invalid' };
  }
  const verdict: ApiKeyAuthorization = await input.authenticator.authenticate({
    presentedSecret: parsed.secret,
    scope: input.scope,
    environment: input.environment,
  });
  if (verdict.outcome === 'authorized') {
    return { outcome: 'authorized', identity: verdict.identity };
  }
  // tenant-mismatch can never surface here (the tenant is DERIVED from the
  // key, not presented by the client); narrow it away for the caller.
  const reason = verdict.reason === 'tenant-mismatch' ? 'secret-invalid' : verdict.reason;
  return { outcome: 'denied', reason };
}

/**
 * The tenant-binding verdict: the client-claimed tenant must EQUAL the
 * authenticated identity's tenant (fail closed — a disagreement is the
 * typed tenant-mismatch denial, never a silent override).
 */
export function tenantBindingVerdict(
  identity: { readonly tenantId: string },
  claimedTenantId: string,
): { readonly outcome: 'bound'; readonly tenantId: string } | { readonly outcome: 'mismatch' } {
  if (identity.tenantId === claimedTenantId) {
    return { outcome: 'bound', tenantId: identity.tenantId };
  }
  return { outcome: 'mismatch' };
}
