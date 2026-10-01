/**
 * Typed read-query vocabulary (Work Order B005; issue #71).
 *
 * Closed query kinds over canonical control-plane reads:
 *   - `by-id` — one canonical read by record id;
 *   - `by-kind` — paginated scroll over one kind (deterministic
 *     (kind, recordId) ordering, stable across reloads);
 *   - `by-tenant` — paginated listing over the whole tenant.
 *
 * Page sizes are BOUNDED (`READ_MODEL_MAX_PAGE_SIZE`); pages after the
 * first are addressed by OPAQUE continuation tokens — base64url-encoded
 * JSON carrying the scope + offset, strictly validated at parse time
 * (`READ_MODEL_INVALID_CONTINUATION` when malformed or scope-mismatched).
 * Tokens are deterministic functions of their inputs (same scroll state →
 * same token) so pagination is reproducible; they are addresses into the
 * control plane's deterministic ordering, NOT cached state — every page
 * re-reads the authority.
 */

import { READ_MODEL_ERROR_CODES, ReadModelError } from './errors.js';
import { READ_MODEL_KINDS, isReadModelKind } from './models.js';
import type { ReadModelKind } from './models.js';

/** Bounded page sizes (the house "no unbounded read" discipline). */
export const READ_MODEL_MAX_PAGE_SIZE = 100 as const;
export const READ_MODEL_DEFAULT_PAGE_SIZE = 50 as const;

/** The query vocabulary version. */
export const READ_QUERY_VERSION = 1 as const;

export type ReadQueryKind = 'by-id' | 'by-kind' | 'by-tenant';

/** One canonical read by record id. */
export interface ReadByIdQuery {
  readonly kind: 'by-id';
  readonly recordId: string;
}

/** Paginated scroll over one disclosed kind. */
export interface ReadByKindQuery {
  readonly kind: 'by-kind';
  readonly recordKind: ReadModelKind;
  readonly limit?: number;
  readonly continuation?: string;
}

/** Paginated listing over every kind in the tenant. */
export interface ReadByTenantQuery {
  readonly kind: 'by-tenant';
  readonly limit?: number;
  readonly continuation?: string;
}

export type ReadQuery = ReadByIdQuery | ReadByKindQuery | ReadByTenantQuery;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireBoundedLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
      message: `limit must be a positive integer, got ${String(limit)}`,
      details: { limit },
    });
  }
  if (limit > READ_MODEL_MAX_PAGE_SIZE) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
      message: `limit ${String(limit)} exceeds the bounded page size ${String(READ_MODEL_MAX_PAGE_SIZE)}`,
      details: { limit, max: READ_MODEL_MAX_PAGE_SIZE },
    });
  }
  return limit;
}

/**
 * Strict validation of a read query (fail closed:
 * `READ_MODEL_INVALID_QUERY`). Accepts ONLY the closed vocabulary — no
 * tenant field exists in the query grammar at all (tenancy is
 * server-controlled, taken from the authenticated context, never from a
 * payload); unknown keys are rejected.
 */
export function validateReadQuery(query: unknown): ReadQuery {
  if (!isPlainRecord(query)) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
      message: 'a read query must be a plain object',
      details: { receivedType: typeof query },
    });
  }
  const kind = query['kind'];
  if (kind === 'by-id') {
    const allowed: ReadonlySet<string> = new Set(['kind', 'recordId']);
    for (const key of Object.keys(query)) {
      if (!allowed.has(key)) {
        throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
          message: `unknown by-id query field ${JSON.stringify(key)} (the read-query grammar is closed; there is NO tenant field — tenancy comes from the authenticated context)`,
          details: { field: key },
        });
      }
    }
    const recordId = query['recordId'];
    if (typeof recordId !== 'string' || recordId.length === 0) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
        message: 'by-id query requires a non-empty recordId string',
        details: { recordId },
      });
    }
    return deepQueryFrozen({ kind: 'by-id', recordId });
  }
  if (kind === 'by-kind') {
    const allowed: ReadonlySet<string> = new Set(['kind', 'recordKind', 'limit', 'continuation']);
    for (const key of Object.keys(query)) {
      if (!allowed.has(key)) {
        throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
          message: `unknown by-kind query field ${JSON.stringify(key)} (the read-query grammar is closed; there is NO tenant field — tenancy comes from the authenticated context)`,
          details: { field: key },
        });
      }
    }
    const recordKind = query['recordKind'];
    if (!isReadModelKind(recordKind)) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
        message: `by-kind query requires a disclosed recordKind, got ${JSON.stringify(String(recordKind))}`,
        details: { recordKind, known: READ_MODEL_KINDS },
      });
    }
    let limit: number | undefined;
    if (query['limit'] !== undefined) limit = requireBoundedLimit(query['limit']);
    let continuation: string | undefined;
    if (query['continuation'] !== undefined) {
      if (typeof query['continuation'] !== 'string') {
        throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
          message: 'continuation must be a string token when present',
        });
      }
      continuation = query['continuation'];
    }
    return deepQueryFrozen({
      kind: 'by-kind',
      recordKind,
      ...(limit !== undefined ? { limit } : {}),
      ...(continuation !== undefined ? { continuation } : {}),
    });
  }
  if (kind === 'by-tenant') {
    const allowed: ReadonlySet<string> = new Set(['kind', 'limit', 'continuation']);
    for (const key of Object.keys(query)) {
      if (!allowed.has(key)) {
        throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
          message: `unknown by-tenant query field ${JSON.stringify(key)} (the read-query grammar is closed; there is NO tenant field — tenancy comes from the authenticated context)`,
          details: { field: key },
        });
      }
    }
    let limit: number | undefined;
    if (query['limit'] !== undefined) limit = requireBoundedLimit(query['limit']);
    let continuation: string | undefined;
    if (query['continuation'] !== undefined) {
      if (typeof query['continuation'] !== 'string') {
        throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
          message: 'continuation must be a string token when present',
        });
      }
      continuation = query['continuation'];
    }
    return deepQueryFrozen({
      kind: 'by-tenant',
      ...(limit !== undefined ? { limit } : {}),
      ...(continuation !== undefined ? { continuation } : {}),
    });
  }
  throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
    message: `unknown read query kind ${JSON.stringify(String(kind))}`,
    details: { kind, known: ['by-id', 'by-kind', 'by-tenant'] },
  });
}

// ---------------------------------------------------------------------------
// Opaque continuation tokens
// ---------------------------------------------------------------------------

/** The internal (still JSON) form of a continuation token. */
export interface ContinuationPayload {
  readonly v: typeof READ_QUERY_VERSION;
  readonly scope: 'by-kind' | 'by-tenant';
  readonly recordKind?: string;
  readonly offset: number;
}

function toBase64Url(utf8: string): string {
  return Buffer.from(utf8, 'utf8').toString('base64url');
}

function fromBase64Url(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

function deepFrozenToken<T extends object>(value: T): T {
  const freezeDeep = (input: unknown): void => {
    if (typeof input !== 'object' || input === null) return;
    for (const key of Object.keys(input as Record<string, unknown>)) {
      freezeDeep((input as Record<string, unknown>)[key]);
    }
    Object.freeze(input);
  };
  freezeDeep(value);
  return value;
}

function deepQueryFrozen<T extends object>(value: T): T {
  return deepFrozenToken(value);
}

/**
 * Encode a continuation token for a `by-kind` scroll (deterministic: the
 * same scope + offset always encodes to the same opaque token).
 */
export function encodeByKindContinuation(recordKind: ReadModelKind, offset: number): string {
  return encodeContinuation({ v: READ_QUERY_VERSION, scope: 'by-kind', recordKind, offset });
}

/** Encode a continuation token for a `by-tenant` listing. */
export function encodeByTenantContinuation(offset: number): string {
  return encodeContinuation({ v: READ_QUERY_VERSION, scope: 'by-tenant', offset });
}

/** Encode a continuation payload into its opaque base64url wire form. */
export function encodeContinuation(payload: ContinuationPayload): string {
  if (!Number.isInteger(payload.offset) || payload.offset < 0) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
      message: `continuation offset must be a non-negative integer, got ${String(payload.offset)}`,
      details: { offset: payload.offset },
    });
  }
  if (payload.scope === 'by-kind' && !isReadModelKind(payload.recordKind)) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
      message: `by-kind continuation requires a disclosed recordKind, got ${JSON.stringify(String(payload.recordKind))}`,
      details: { recordKind: payload.recordKind, known: READ_MODEL_KINDS },
    });
  }
  return toBase64Url(
    JSON.stringify({
      v: payload.v,
      scope: payload.scope,
      ...(payload.recordKind !== undefined ? { recordKind: payload.recordKind } : {}),
      offset: payload.offset,
    }),
  );
}

/**
 * Strictly decode + validate an opaque continuation token (fail closed:
 * `READ_MODEL_INVALID_CONTINUATION` for malformed encodings, unsupported
 * versions, scope mismatches and record-kind mismatches). Frozen output.
 */
export function decodeContinuation(
  token: unknown,
  expectedScope: 'by-kind' | 'by-tenant',
  expectedRecordKind?: ReadModelKind,
): ContinuationPayload {
  if (typeof token !== 'string' || token.length === 0) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
      message: 'a continuation token must be a non-empty string',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(token));
  } catch {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
      message: 'the continuation token is not a valid encoded payload',
    });
  }
  if (!isPlainRecord(parsed)) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
      message: 'the continuation payload must be a plain object',
    });
  }
  if (parsed['v'] !== READ_QUERY_VERSION) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
      message: `unsupported continuation token version ${String(parsed['v'])}`,
      details: { version: parsed['v'], supported: READ_QUERY_VERSION },
    });
  }
  const scope0 = parsed['scope'];
  if (scope0 !== expectedScope) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
      message: `continuation token scope ${JSON.stringify(String(scope0))} does not match the query scope ${JSON.stringify(expectedScope)}`,
      details: { scope: scope0, expectedScope },
    });
  }
  if (expectedScope === 'by-kind') {
    const recordKind = parsed['recordKind'];
    if (expectedRecordKind !== undefined && recordKind !== expectedRecordKind) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
        message: `continuation token recordKind ${JSON.stringify(String(recordKind))} does not match the query recordKind ${JSON.stringify(expectedRecordKind)}`,
        details: { recordKind, expectedRecordKind },
      });
    }
    if (recordKind === undefined) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
        message: 'a by-kind continuation token must carry its recordKind',
      });
    }
  }
  const offset = parsed['offset'];
  if (!Number.isInteger(offset) || (offset as number) < 0) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION, {
      message: `continuation offset must be a non-negative integer, got ${String(offset)}`,
      details: { offset },
    });
  }
  const recordKind = parsed['recordKind'];
  const scope = scope0 as 'by-kind' | 'by-tenant';
  return deepFrozenToken({
    v: READ_QUERY_VERSION,
    scope,
    ...(recordKind !== undefined ? { recordKind: recordKind as string } : {}),
    offset: offset as number,
  });
}

/**
 * The effective page size of a paginated query (bounded; default
 * `READ_MODEL_DEFAULT_PAGE_SIZE`).
 */
export function effectiveLimit(query: { readonly limit?: number }): number {
  return query.limit !== undefined ? query.limit : READ_MODEL_DEFAULT_PAGE_SIZE;
}
