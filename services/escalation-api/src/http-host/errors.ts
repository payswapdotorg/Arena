/**
 * services/escalation-api/src/http-host/errors.ts — the shared transport
 * error taxonomy (Work Order P003; issue #155; ADR-P001-08 rule 5).
 *
 * "a shared error taxonomy — every transport error maps onto the existing
 * typed code sets (escalation and developer-platform codes with their
 * machine-readable classes) with documented HTTP renderings."
 *
 * This module is that mapping — and NOTHING else: it invents no new
 * failure vocabulary. Three existing code families render here:
 *
 *   1. the REAL escalation code set (@arena/escalation — a declared
 *      dependency of this service);
 *   2. the developer-platform code set — a STRUCTURAL MIRROR of
 *      `@arena/developer-platform`'s `DEVELOPER_PLATFORM_ERROR_CODES` +
 *      `DENIAL_ERROR_CODES` + `CODE_CATEGORY` (NOT a declared dependency
 *      of this package — the mirror is pinned value-for-value by
 *      tests/api-host against the real sets);
 *   3. the runtime-host boundary codes (RUNTIME_*) — a structural mirror
 *      of the codes the frozen host surface throws
 *      (services/runtime-host's RuntimeHostError + the lens vocabulary).
 *
 * Every rendering is a machine-readable typed body
 * `{ code, category, message, details }` — honest payloads only: no stack
 * traces, no internal reasoning, no private chain-of-thought capture.
 * Unknown/unmappable codes fail CLOSED as 500 — never a silent 2xx, never
 * a raw passthrough of foreign error shapes.
 */

import {
  ESCALATION_ERROR_CODES,
  categoryForEscalationCode,
} from '@arena/escalation';
import type { EscalationErrorCode } from '@arena/escalation';
import type { ApiKeyDenialReason } from './ports.js';

// ---------------------------------------------------------------------------
// The rendered transport error (the wire body shape)
// ---------------------------------------------------------------------------

/** The fail-closed wire rendering of one transport error. */
export interface TransportErrorRendering {
  readonly status: number;
  readonly body: {
    readonly code: string;
    readonly category: string;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
  };
}

// ---------------------------------------------------------------------------
// Developer-platform code mirrors (pinned by tests/api-host)
// ---------------------------------------------------------------------------

/**
 * The developer-platform typed code set — STRUCTURAL MIRROR of
 * `DEVELOPER_PLATFORM_ERROR_CODES` (values are the contract strings).
 */
export const DEVELOPER_CODE_MIRROR = Object.freeze({
  INVALID_REQUEST: 'DEVELOPER_INVALID_REQUEST',
  INVALID_KEY: 'DEVELOPER_INVALID_KEY',
  INVALID_SECRET: 'DEVELOPER_INVALID_SECRET',
  INVALID_SCOPE: 'DEVELOPER_INVALID_SCOPE',
  INVALID_ENVIRONMENT: 'DEVELOPER_INVALID_ENVIRONMENT',
  INVALID_WEBHOOK: 'DEVELOPER_INVALID_WEBHOOK',
  INVALID_CLIENT_APP: 'DEVELOPER_INVALID_CLIENT_APP',
  KEY_NOT_FOUND: 'DEVELOPER_KEY_NOT_FOUND',
  KEY_REVOKED: 'DEVELOPER_KEY_REVOKED',
  KEY_ROTATED: 'DEVELOPER_KEY_ROTATED',
  SECRET_INVALID: 'DEVELOPER_SECRET_INVALID',
  SCOPE_MISSING: 'DEVELOPER_SCOPE_MISSING',
  ENVIRONMENT_MISMATCH: 'DEVELOPER_ENVIRONMENT_MISMATCH',
  CROSS_TENANT_ACCESS: 'DEVELOPER_CROSS_TENANT_ACCESS',
  CLIENT_APP_NOT_FOUND: 'DEVELOPER_CLIENT_APP_NOT_FOUND',
  SANDBOX_CAPACITY_EXHAUSTED: 'DEVELOPER_SANDBOX_CAPACITY_EXHAUSTED',
  SANDBOX_CAPACITY_DISABLED: 'DEVELOPER_SANDBOX_CAPACITY_DISABLED',
  UNKNOWN_ERROR: 'DEVELOPER_UNKNOWN_ERROR',
} as const);
export type DeveloperCodeMirror =
  (typeof DEVELOPER_CODE_MIRROR)[keyof typeof DEVELOPER_CODE_MIRROR];

/** Category mirror of CODE_CATEGORY (machine-readable classes). */
export const DEVELOPER_CODE_CATEGORY_MIRROR: Readonly<
  Record<DeveloperCodeMirror, string>
> = Object.freeze({
  DEVELOPER_INVALID_REQUEST: 'validation',
  DEVELOPER_INVALID_KEY: 'validation',
  DEVELOPER_INVALID_SECRET: 'validation',
  DEVELOPER_INVALID_SCOPE: 'validation',
  DEVELOPER_INVALID_ENVIRONMENT: 'validation',
  DEVELOPER_INVALID_WEBHOOK: 'validation',
  DEVELOPER_INVALID_CLIENT_APP: 'validation',
  DEVELOPER_KEY_NOT_FOUND: 'scope',
  DEVELOPER_KEY_REVOKED: 'scope',
  DEVELOPER_KEY_ROTATED: 'scope',
  DEVELOPER_SECRET_INVALID: 'scope',
  DEVELOPER_SCOPE_MISSING: 'scope',
  DEVELOPER_ENVIRONMENT_MISMATCH: 'scope',
  DEVELOPER_CROSS_TENANT_ACCESS: 'tenancy',
  DEVELOPER_CLIENT_APP_NOT_FOUND: 'scope',
  DEVELOPER_SANDBOX_CAPACITY_EXHAUSTED: 'capacity',
  DEVELOPER_SANDBOX_CAPACITY_DISABLED: 'capacity',
  DEVELOPER_UNKNOWN_ERROR: 'unknown',
});

/**
 * Authorization-denial reason → typed code — STRUCTURAL MIRROR of
 * `@arena/developer-platform`'s `DENIAL_ERROR_CODES`.
 */
export const DENIAL_CODE_MIRROR: Readonly<Record<ApiKeyDenialReason, DeveloperCodeMirror>> =
  Object.freeze({
    'key-not-found': DEVELOPER_CODE_MIRROR.KEY_NOT_FOUND,
    'secret-invalid': DEVELOPER_CODE_MIRROR.SECRET_INVALID,
    'key-revoked': DEVELOPER_CODE_MIRROR.KEY_REVOKED,
    'key-rotated': DEVELOPER_CODE_MIRROR.KEY_ROTATED,
    'tenant-mismatch': DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS,
    'environment-mismatch': DEVELOPER_CODE_MIRROR.ENVIRONMENT_MISMATCH,
    'scope-missing': DEVELOPER_CODE_MIRROR.SCOPE_MISSING,
  });

// ---------------------------------------------------------------------------
// Runtime-host boundary code mirror (pinned by tests/api-host)
// ---------------------------------------------------------------------------

/**
 * The runtime-host boundary codes — the closed set the frozen host
 * surface throws (services/runtime-host's RuntimeHostError + the frozen
 * package's lifecycle and lens error namespaces). Structural mirror,
 * pinned by tests/api-host (every mirrored value is proven to exist in
 * the frozen sources; the frozen lifecycle/lens vocabularies are proven
 * COVERED).
 */
export const RUNTIME_CODE_MIRROR = Object.freeze([
  'RUNTIME_NOT_STARTED',
  'RUNTIME_ALREADY_STOPPED',
  'RUNTIME_PERSISTENCE_DISABLED',
  'RUNTIME_CROSS_TENANT_ACCESS',
  'RUNTIME_ESCALATION_NOT_FOUND',
  'RUNTIME_JOB_NOT_FOUND',
  'RUNTIME_UNKNOWN_JOB_KIND',
  'RUNTIME_INVALID_TRANSITION',
  'RUNTIME_LENS_CONFLICT',
  'RUNTIME_INVALID_LENS',
] as const);
export type RuntimeCodeMirror = (typeof RUNTIME_CODE_MIRROR)[number];

// ---------------------------------------------------------------------------
// Documented HTTP renderings (the closed mapping tables)
// ---------------------------------------------------------------------------

/**
 * Escalation-domain code → HTTP status (documented rendering; the REAL
 * code set, imported from @arena/escalation — every code mapped, none
 * improvised).
 */
export const ESCALATION_CODE_HTTP: Readonly<Record<EscalationErrorCode, number>> =
  Object.freeze({
    ESCALATION_INVALID_REQUEST: 400,
    ESCALATION_INVALID_TENANT: 400,
    ESCALATION_INVALID_MODE: 400,
    ESCALATION_INVALID_RESULT: 400,
    ESCALATION_INVALID_EVENT: 400,
    ESCALATION_INVALID_STATE: 400,
    ESCALATION_INVALID_TRANSITION: 409,
    ESCALATION_TERMINAL_STATE: 409,
    ESCALATION_IDENTITY_CONFLICT: 409,
    ESCALATION_CROSS_TENANT_ACCESS: 403,
    ESCALATION_UNPERMITTED_ACTION: 403,
    ESCALATION_DEADLINE_PASSED: 409,
    ESCALATION_TAMPERED: 400,
    ESCALATION_SCHEMA_MISMATCH: 400,
    ESCALATION_UNSUPPORTED_VERSION: 400,
    ESCALATION_UNKNOWN_ERROR: 500,
  });

/**
 * Developer-platform code → HTTP status (documented rendering of the
 * mirrored code set): authentication failures are 401, authorization
 * (scope/tenancy/environment/status) failures are 403, validation is 400,
 * capacity fail-closed is 503.
 */
export const DEVELOPER_CODE_HTTP: Readonly<Record<DeveloperCodeMirror, number>> =
  Object.freeze({
    DEVELOPER_INVALID_REQUEST: 400,
    DEVELOPER_INVALID_KEY: 400,
    DEVELOPER_INVALID_SECRET: 401,
    DEVELOPER_INVALID_SCOPE: 400,
    DEVELOPER_INVALID_ENVIRONMENT: 400,
    DEVELOPER_INVALID_WEBHOOK: 400,
    DEVELOPER_INVALID_CLIENT_APP: 400,
    DEVELOPER_KEY_NOT_FOUND: 401,
    DEVELOPER_KEY_REVOKED: 403,
    DEVELOPER_KEY_ROTATED: 403,
    DEVELOPER_SECRET_INVALID: 401,
    DEVELOPER_SCOPE_MISSING: 403,
    DEVELOPER_ENVIRONMENT_MISMATCH: 403,
    DEVELOPER_CROSS_TENANT_ACCESS: 403,
    DEVELOPER_CLIENT_APP_NOT_FOUND: 404,
    DEVELOPER_SANDBOX_CAPACITY_EXHAUSTED: 503,
    DEVELOPER_SANDBOX_CAPACITY_DISABLED: 503,
    DEVELOPER_UNKNOWN_ERROR: 500,
  });

/** Runtime-host boundary code → HTTP status (documented rendering). */
export const RUNTIME_CODE_HTTP: Readonly<Record<RuntimeCodeMirror, number>> =
  Object.freeze({
    RUNTIME_NOT_STARTED: 503,
    RUNTIME_ALREADY_STOPPED: 503,
    RUNTIME_PERSISTENCE_DISABLED: 503,
    RUNTIME_CROSS_TENANT_ACCESS: 403,
    RUNTIME_ESCALATION_NOT_FOUND: 404,
    RUNTIME_JOB_NOT_FOUND: 404,
    RUNTIME_UNKNOWN_JOB_KIND: 400,
    RUNTIME_INVALID_TRANSITION: 409,
    RUNTIME_LENS_CONFLICT: 403,
    RUNTIME_INVALID_LENS: 400,
  });

// ---------------------------------------------------------------------------
// Rendering functions
// ---------------------------------------------------------------------------

/** Render a typed transport error body with an explicit status. */
export function renderTypedError(input: {
  readonly status: number;
  readonly code: string;
  readonly category: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}): TransportErrorRendering {
  return {
    status: input.status,
    body: Object.freeze({
      code: input.code,
      category: input.category,
      message: input.message,
      details: Object.freeze({ ...(input.details ?? {}) }),
    }),
  };
}

/** Render one authorization-denial verdict onto the typed code set. */
export function renderApiKeyDenial(
  reason: ApiKeyDenialReason,
  context: { readonly scope: string; readonly environment: string },
): TransportErrorRendering {
  const code = DENIAL_CODE_MIRROR[reason];
  return renderTypedError({
    status: DEVELOPER_CODE_HTTP[code],
    code,
    category: DEVELOPER_CODE_CATEGORY_MIRROR[code],
    message: `developer key authorization denied: ${reason} (scope ${JSON.stringify(context.scope)}, environment ${JSON.stringify(context.environment)})`,
    details: { reason, scope: context.scope, environment: context.environment },
  });
}

/**
 * Render ANY error thrown below the transport onto the shared taxonomy —
 * fail-closed: recognized escalation codes render through the escalation
 * table; recognized developer/runtime mirror codes render through theirs;
 * anything else (including missing `code` fields) renders as the typed
 * ESCALATION_UNKNOWN_ERROR 500 — never a raw passthrough.
 */
export function renderTransportError(error: unknown): TransportErrorRendering {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') {
      if (Object.prototype.hasOwnProperty.call(ESCALATION_CODE_HTTP, code)) {
        const escalationCode = code as EscalationErrorCode;
        return renderTypedError({
          status: ESCALATION_CODE_HTTP[escalationCode],
          code: escalationCode,
          category: categoryForEscalationCode(escalationCode),
          message: error instanceof Error ? error.message : String(code),
          details: readDetails(error),
        });
      }
      if (Object.prototype.hasOwnProperty.call(DEVELOPER_CODE_HTTP, code)) {
        const developerCode = code as DeveloperCodeMirror;
        return renderTypedError({
          status: DEVELOPER_CODE_HTTP[developerCode],
          code: developerCode,
          category: DEVELOPER_CODE_CATEGORY_MIRROR[developerCode],
          message: error instanceof Error ? error.message : String(code),
          details: readDetails(error),
        });
      }
      if (Object.prototype.hasOwnProperty.call(RUNTIME_CODE_HTTP, code)) {
        const runtimeCode = code as RuntimeCodeMirror;
        return renderTypedError({
          status: RUNTIME_CODE_HTTP[runtimeCode],
          code: runtimeCode,
          category: 'state',
          message: error instanceof Error ? error.message : String(code),
          details: readDetails(error),
        });
      }
    }
  }
  // Fail closed: unknown failure shapes NEVER leak raw internals — a
  // stable typed body with the error's (honest) message only.
  return renderTypedError({
    status: 500,
    code: ESCALATION_ERROR_CODES.UNKNOWN_ERROR,
    category: 'unknown',
    message:
      error instanceof Error && error.message.length > 0
        ? error.message
        : 'the transport failed to process the request (fail closed)',
    details: {},
  });
}

function readDetails(error: object): Readonly<Record<string, unknown>> {
  const candidate = (error as { details?: unknown }).details;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate)
  ) {
    return candidate as Readonly<Record<string, unknown>>;
  }
  return {};
}
