/**
 * CorrelationId and IdempotencyKey — the addressability pair required by
 * architecture-lock rule 17 ("Long-running jobs are idempotent and
 * correlation-addressable").
 *
 * Both are branded strings: pure TypeScript with zero runtime dependencies.
 * The wire charset is shared and mirrored in the generated contracts
 * (packages/protocol-core/contracts/envelope.v1.json); parity is asserted by
 * contracts.parity.test.ts.
 */

import type { Brand } from './brand.js';
import { PROTOCOL_ERROR_CODES, ProtocolError } from './protocol-error.js';

export type CorrelationId = Brand<string, 'CorrelationId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const IDENTIFIER_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const IDENTIFIER_PATTERN = new RegExp(IDENTIFIER_PATTERN_SOURCE);

export function isCorrelationId(value: unknown): value is CorrelationId {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

export function isIdempotencyKey(value: unknown): value is IdempotencyKey {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

/** Validate and brand a correlation id; throws ProtocolError on invalid input. */
export function toCorrelationId(value: string): CorrelationId {
  if (!isCorrelationId(value)) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_CORRELATION_ID, {
      message: `invalid correlation id: ${JSON.stringify(value)}`,
      details: { pattern: IDENTIFIER_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate and brand an idempotency key; throws ProtocolError on invalid input. */
export function toIdempotencyKey(value: string): IdempotencyKey {
  if (!isIdempotencyKey(value)) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_IDEMPOTENCY_KEY, {
      message: `invalid idempotency key: ${JSON.stringify(value)}`,
      details: { pattern: IDENTIFIER_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Generate a fresh random correlation id (UUIDv4-based). */
export function newCorrelationId(): CorrelationId {
  return globalThis.crypto.randomUUID() as CorrelationId;
}

/** Generate a fresh random idempotency key (UUIDv4-based). */
export function newIdempotencyKey(): IdempotencyKey {
  return globalThis.crypto.randomUUID() as IdempotencyKey;
}
