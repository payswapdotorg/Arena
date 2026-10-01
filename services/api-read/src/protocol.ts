/**
 * Read API protocol (Work Order B005; issue #71) — the v1 read-specific
 * request/response envelope, consistent with the A025
 * @arena/arena-sdk envelope/error protocol.
 *
 * DESIGN CHOICE (disclosed): the A025 api-query-request envelope carries a
 * CLOSED query-kind vocabulary registered in the arena-sdk schema
 * registry — a frozen surface this work order must not edit. B005
 * therefore adopts a v1 read-specific envelope that mirrors the A025
 * protocol shape exactly: a closed request-kind vocabulary (strictly
 * validated, unknown fields rejected), an echoed kind on every response,
 * reads correlated by the request itself (reads are NOT commands — no
 * idempotency keys anywhere on this boundary), typed error envelopes
 * using the house code vocabulary (READ_MODEL_* + AUTH_*), and a
 * recordVersion on every envelope (the versioned contract surface
 * B006/B007 consume).
 *
 * THE TENANT RULE: there is NO tenant field in the request grammar —
 * tenancy is server-controlled, taken from the B004-authenticated
 * session context, never from a payload.
 */

import {
  AUTH_ERROR_CODES,
  categoryForAuthCode,
  isAuthErrorCode,
} from '@arena/auth';
import type { AuthErrorCode, AuthErrorCategory } from '@arena/auth';
import {
  READ_MODEL_RECORD_VERSION,
  categoryForReadModelCode,
  isReadModelErrorCode,
} from '@arena/read-model';
import type { ReadModelErrorCode, ReadModelKind } from '@arena/read-model';
import type {
  CanonicalRead,
  KindInventory,
  ReadPage,
  TenantListingPage,
} from '@arena/read-model';

/** The read API contract version. */
export const READ_API_RECORD_VERSION = READ_MODEL_RECORD_VERSION;

// ---------------------------------------------------------------------------
// Requests (closed kind vocabulary, strictly validated)
// ---------------------------------------------------------------------------

export type ReadApiRequestKind = 'read-canonical' | 'scroll-by-kind' | 'list-kinds';

/** One canonical read by record id. */
export interface ReadCanonicalRequest {
  readonly kind: 'read-canonical';
  readonly recordId: string;
}

/** One bounded page of a kind scroll. */
export interface ScrollByKindRequest {
  readonly kind: 'scroll-by-kind';
  readonly recordKind: ReadModelKind;
  readonly limit?: number;
  readonly continuation?: string;
}

/** The tenant's disclosed kind inventory. */
export interface ListKindsRequest {
  readonly kind: 'list-kinds';
}

export type ReadApiRequest =
  | ReadCanonicalRequest
  | ScrollByKindRequest
  | ListKindsRequest;

const REQUEST_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  'read-canonical': new Set(['kind', 'recordId']),
  'scroll-by-kind': new Set(['kind', 'recordKind', 'limit', 'continuation']),
  'list-kinds': new Set(['kind']),
};

/**
 * Strict parser for a read API request (fail closed). The grammar is
 * CLOSED: unknown kinds and unknown fields are rejected — in particular
 * any `tenantId`/`tenant` field is rejected with a typed error (tenancy
 * comes from the authenticated session context, never from a payload).
 */
export function parseReadApiRequest(value: unknown): ReadApiRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReadApiRequestError('a read API request must be a plain object');
  }
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  if (typeof kind !== 'string' || !(kind in REQUEST_FIELDS)) {
    throw new ReadApiRequestError(
      `unknown read API request kind ${JSON.stringify(String(kind))}`,
      { kind, known: Object.keys(REQUEST_FIELDS) },
    );
  }
  const allowed = REQUEST_FIELDS[kind] as ReadonlySet<string>;
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ReadApiRequestError(
        `unknown ${JSON.stringify(kind)} request field ${JSON.stringify(key)} (the read-request grammar is closed; there is NO tenant field — tenancy comes from the authenticated session context)`,
        { field: key },
      );
    }
  }
  if (kind === 'read-canonical') {
    const recordId = record['recordId'];
    if (typeof recordId !== 'string' || recordId.length === 0) {
      throw new ReadApiRequestError('read-canonical requires a non-empty recordId string');
    }
    return { kind: 'read-canonical', recordId };
  }
  if (kind === 'scroll-by-kind') {
    const recordKind = record['recordKind'];
    if (
      typeof recordKind !== 'string' ||
      ![
        'arena-session',
        'arena-session-epoch',
        'capability-case',
        'agent-body',
        'expert-qualification',
        'certification',
      ].includes(recordKind)
    ) {
      throw new ReadApiRequestError(
        `scroll-by-kind requires a disclosed recordKind, got ${JSON.stringify(String(recordKind))}`,
      );
    }
    let limit: number | undefined;
    if (record['limit'] !== undefined) {
      if (
        typeof record['limit'] !== 'number' ||
        !Number.isInteger(record['limit']) ||
        (record['limit'] as number) < 1 ||
        (record['limit'] as number) > 100
      ) {
        throw new ReadApiRequestError(
          'scroll-by-kind limit must be an integer in [1, 100]',
          { limit: record['limit'] },
        );
      }
      limit = record['limit'] as number;
    }
    let continuation: string | undefined;
    if (record['continuation'] !== undefined) {
      if (typeof record['continuation'] !== 'string') {
        throw new ReadApiRequestError('continuation must be a string token when present');
      }
      continuation = record['continuation'] as string;
    }
    return {
      kind: 'scroll-by-kind',
      recordKind: recordKind as ReadModelKind,
      ...(limit !== undefined ? { limit } : {}),
      ...(continuation !== undefined ? { continuation } : {}),
    };
  }
  return { kind: 'list-kinds' };
}

/** Typed request-parse failure (mapped to READ_MODEL_INVALID_QUERY). */
export class ReadApiRequestError extends Error {
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'ReadApiRequestError';
    if (details !== undefined) this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Error envelopes (house typed-error vocabulary)
// ---------------------------------------------------------------------------

/** The closed code vocabulary of the read boundary. */
export type ReadBoundaryErrorCode = ReadModelErrorCode | AuthErrorCode;

/** The closed category vocabulary of the read boundary. */
export type ReadBoundaryErrorCategory =
  | ReturnType<typeof categoryForReadModelCode>
  | AuthErrorCategory;

/** Structured (wire-safe) form of a read-boundary error. */
export interface ReadBoundaryErrorStruct {
  readonly code: ReadBoundaryErrorCode;
  readonly category: ReadBoundaryErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function isReadBoundaryErrorCode(value: unknown): value is ReadBoundaryErrorCode {
  return isReadModelErrorCode(value) || isAuthErrorCode(value);
}

export function categoryForReadBoundaryCode(
  code: ReadBoundaryErrorCode,
): ReadBoundaryErrorCategory {
  return isReadModelErrorCode(code)
    ? categoryForReadModelCode(code)
    : categoryForAuthCode(code);
}

// ---------------------------------------------------------------------------
// Response envelopes (versioned contract surface for B006/B007)
// ---------------------------------------------------------------------------

/** The per-kind result vocabulary. */
export type ReadApiResultValue = CanonicalRead | ReadPage | TenantListingPage | KindInventory;

/** A successful read API response (echoed kind + typed result). */
export interface ReadApiResponseEnvelope {
  readonly recordVersion: typeof READ_API_RECORD_VERSION;
  readonly ok: true;
  readonly kind: ReadApiRequestKind;
  readonly result: ReadApiResultValue;
}

/** A fail-closed read API error response. */
export interface ReadApiErrorEnvelope {
  readonly recordVersion: typeof READ_API_RECORD_VERSION;
  readonly ok: false;
  readonly error: ReadBoundaryErrorStruct;
}

export type ReadApiEnvelope = ReadApiResponseEnvelope | ReadApiErrorEnvelope;

/** Build a success envelope. */
export function makeReadApiResponse(
  kind: ReadApiRequestKind,
  result: ReadApiResultValue,
): ReadApiResponseEnvelope {
  return {
    recordVersion: READ_API_RECORD_VERSION,
    ok: true,
    kind,
    result,
  };
}

/** Build an error envelope from a typed code + message. */
export function makeReadApiError(
  code: ReadBoundaryErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ReadApiErrorEnvelope {
  return {
    recordVersion: READ_API_RECORD_VERSION,
    ok: false,
    error: {
      code,
      category: categoryForReadBoundaryCode(code),
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * Parse a transported read API envelope (fail closed): rejects
 * non-objects, unsupported recordVersions, ok-shape mismatches, unknown
 * codes and category/code mismatches.
 */
export function parseReadApiEnvelope(value: unknown): ReadApiEnvelope {
  const fail = (reason: string): never => {
    throw new ReadApiRequestError(`malformed read API envelope: ${reason}`);
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== READ_API_RECORD_VERSION) {
    return fail(`unsupported recordVersion ${String(record['recordVersion'])}`);
  }
  if (record['ok'] === true) {
    const kind = record['kind'];
    if (
      typeof kind !== 'string' ||
      !(kind in REQUEST_FIELDS)
    ) {
      return fail(`unknown response kind ${String(kind)}`);
    }
    const result = record['result'];
    if (typeof result !== 'object' || result === null) {
      return fail('a success envelope requires a result object');
    }
    return { recordVersion: READ_API_RECORD_VERSION, ok: true, kind, result } as ReadApiResponseEnvelope;
  }
  if (record['ok'] === false) {
    const error = record['error'];
    if (typeof error !== 'object' || error === null || Array.isArray(error)) {
      return fail('an error envelope requires an error object');
    }
    const code = (error as Record<string, unknown>)['code'];
    if (!isReadBoundaryErrorCode(code)) {
      return fail(`unknown read-boundary error code ${String(code)}`);
    }
    const category = (error as Record<string, unknown>)['category'];
    if (category !== categoryForReadBoundaryCode(code)) {
      return fail(`category ${String(category)} does not match code ${String(code)}`);
    }
    const message = (error as Record<string, unknown>)['message'];
    if (typeof message !== 'string' || message.length === 0) {
      return fail('error message must be a non-empty string');
    }
    const details = (error as Record<string, unknown>)['details'];
    if (
      details !== undefined &&
      (typeof details !== 'object' || details === null || Array.isArray(details))
    ) {
      return fail('error details must be a plain object when present');
    }
    return {
      recordVersion: READ_API_RECORD_VERSION,
      ok: false,
      error: {
        code,
        category: categoryForReadBoundaryCode(code),
        message,
        ...(details !== undefined
          ? { details: details as Readonly<Record<string, unknown>> }
          : {}),
      },
    };
  }
  return fail('ok must be true or false');
}

/** The auth-fail-closed code used for a missing session token. */
export const MISSING_SESSION_CODE = AUTH_ERROR_CODES.INVALID_COOKIE;
