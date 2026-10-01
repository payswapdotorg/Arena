/**
 * @arena/api-read — the auth-gated read API boundary service (Work Order
 * B005; issue #71).
 *
 * `handleReadRequest(sessionToken, rawRequest)`:
 *   1. B004 `validateSession` FIRST — fail closed: a missing, malformed,
 *      tampered, expired, revoked or rotated session yields a typed AUTH_*
 *      error envelope; anonymous reads are NOT representable on this
 *      boundary;
 *   2. the tenant is taken from the VALIDATED session context — never
 *      from the request payload (the request grammar has no tenant field
 *      at all);
 *   3. dispatch to the injected @arena/read-model-service and wrap the
 *      result in a versioned response envelope carrying source version,
 *      provenance and read-at.
 *
 * The handler NEVER throws for typed outcomes — every failure is a typed
 * error envelope (fail closed, nothing partial). Read-only: no write
 * path exists on this boundary.
 */

import { AUTH_ERROR_CODES, isAuthError, toAuthErrorStruct } from '@arena/auth';
import type { AuthError } from '@arena/auth';
import { READ_MODEL_ERROR_CODES, ReadModelError } from '@arena/read-model';
import type { CanonicalReadModel } from '@arena/read-model';
import {
  makeReadApiError,
  makeReadApiResponse,
  parseReadApiRequest,
} from './protocol.js';
import type { ReadApiEnvelope, ReadBoundaryErrorStruct } from './protocol.js';

/**
 * The authenticated-context view this boundary needs (the versioned
 * B004 contract surface): the validated session's TENANT scope. The
 * real `AuthenticatedSession` (services/auth) satisfies this
 * structurally; the boundary never interprets anything beyond tenancy.
 */
export interface AuthenticatedTenantContext {
  readonly tenantId: string;
}

/**
 * The B004 session-validation port this boundary composes. The real
 * `AuthService` satisfies it structurally (`validateSession`).
 */
export interface SessionValidator {
  validateSession(
    cookieValue: string,
    options?: { readonly expectedTenantId?: string },
  ): Promise<AuthenticatedTenantContext>;
}

/** Injected dependencies (both are versioned-contract ports). */
export interface ReadApiServiceDeps {
  readonly auth: SessionValidator;
  readonly readModel: CanonicalReadModel;
}

/** The outcome of one handled read request (always an envelope). */
export interface ReadApiOutcome {
  readonly envelope: ReadApiEnvelope;
  /** The authenticated context when validation succeeded, else undefined. */
  readonly session?: AuthenticatedTenantContext;
}

function authErrorEnvelope(error: AuthError): ReadApiEnvelope {
  const struct = toAuthErrorStruct(error);
  return {
    recordVersion: 1,
    ok: false,
    error: {
      code: struct.code,
      category: struct.category,
      message: struct.message,
      ...(struct.details !== undefined ? { details: struct.details } : {}),
    } satisfies ReadBoundaryErrorStruct,
  };
}

function readModelErrorEnvelope(error: ReadModelError): ReadApiEnvelope {
  return makeReadApiError(error.code, error.message, error.details);
}

export class ReadApiService {
  private readonly auth: SessionValidator;
  private readonly readModel: CanonicalReadModel;

  constructor(deps: ReadApiServiceDeps) {
    if (typeof deps.auth?.validateSession !== 'function') {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'ReadApiService requires an injected SessionValidator (the B004 AuthService)',
      });
    }
    if (typeof deps.readModel?.readCanonical !== 'function') {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'ReadApiService requires an injected CanonicalReadModel (the @arena/read-model-service implementation)',
      });
    }
    this.auth = deps.auth;
    this.readModel = deps.readModel;
  }

  /**
   * Handle one read request: authenticate FIRST (fail closed), scope to
   * the session's tenant, dispatch, and return the response envelope.
   */
  async handleReadRequest(sessionToken: unknown, rawRequest: unknown): Promise<ReadApiOutcome> {
    // 1. AUTH FIRST — anonymous reads are not representable.
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return {
        envelope: makeReadApiError(
          AUTH_ERROR_CODES.INVALID_COOKIE,
          'a read request requires an authenticated session (the sealed session cookie value); anonymous reads are not representable',
        ),
      };
    }
    let session: AuthenticatedTenantContext;
    try {
      session = await this.auth.validateSession(sessionToken);
    } catch (error) {
      if (isAuthError(error)) {
        return { envelope: authErrorEnvelope(error) };
      }
      return {
        envelope: makeReadApiError(
          AUTH_ERROR_CODES.UNKNOWN_ERROR,
          `session validation failed in an unexpected way: ${String(
            error instanceof Error ? error.message : error,
          )}`,
        ),
      };
    }

    // 2. Strict request parse (the grammar has NO tenant field).
    let request: ReturnType<typeof parseReadApiRequest>;
    try {
      request = parseReadApiRequest(rawRequest);
    } catch (error) {
      const details =
        error instanceof Error && error.name === 'ReadApiRequestError'
          ? (error as { details?: Readonly<Record<string, unknown>> }).details
          : undefined;
      return {
        session,
        envelope: makeReadApiError(
          READ_MODEL_ERROR_CODES.INVALID_QUERY,
          error instanceof Error ? error.message : String(error),
          details,
        ),
      };
    }

    // 3. Tenant from the VALIDATED context; dispatch read-only.
    try {
      if (request.kind === 'read-canonical') {
        const result = await this.readModel.readCanonical(
          String(session.tenantId),
          request.recordId,
        );
        return { session, envelope: makeReadApiResponse('read-canonical', result) };
      }
      if (request.kind === 'scroll-by-kind') {
        const result = await this.readModel.scrollByKind(
          String(session.tenantId),
          request.recordKind,
          request.continuation,
          request.limit,
        );
        return { session, envelope: makeReadApiResponse('scroll-by-kind', result) };
      }
      const result = await this.readModel.listKinds(String(session.tenantId));
      return { session, envelope: makeReadApiResponse('list-kinds', result) };
    } catch (error) {
      if (error instanceof ReadModelError) {
        return { session, envelope: readModelErrorEnvelope(error) };
      }
      return {
        session,
        envelope: makeReadApiError(
          READ_MODEL_ERROR_CODES.UNKNOWN_ERROR,
          `the read failed in an unexpected way: ${String(
            error instanceof Error ? error.message : error,
          )}`,
        ),
      };
    }
  }
}

/** Construct a fresh auth-gated read API boundary. */
export function createReadApiService(deps: ReadApiServiceDeps): ReadApiService {
  return new ReadApiService(deps);
}
