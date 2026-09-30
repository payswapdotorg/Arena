/**
 * ApiService — the envelope-wired reference service facade for the
 * Arena public/private API (Work Order A025; architecture-lock rules
 * 17, 18, 22; mirrors the sibling reference services' envelope wiring
 * — services/certification's CertificationService, services/body-registry's
 * BodyRegistryEnvelopeService).
 *
 * Pure reference fabric: injected dependencies (the fabric is
 * constructor-injected), fail-closed error normalization, NO
 * network/HTTP layer (the A025 reference slice, like the A013/A023/
 * A024 services). The payload-level dispatch port lives on the FABRIC
 * (ApiFabric.handleQueryRequest) so hosts can wire
 * `createLoopbackTransport(fabric)` from @arena/arena-sdk.
 *
 * Wire round trip:
 *   api-query-request (envelope kind `query`, NULL idempotency key —
 *     reads are not commands)
 *     → fabric.handleQueryRequest (scope-checked dispatch over the
 *       guard-validated read model)
 *     → api-query-response (envelope kind `response`, SAME correlation
 *       id, per-kind closed result vocabulary).
 */

import {
  makeApiQueryRequest,
  makeApiQueryResponse,
  normalizeToArenaApiError,
  parseApiQueryRequest,
  parseApiQueryResponse,
  parseApiQueryResponseFor,
} from '@arena/arena-sdk';
import type {
  ApiQueryRequest,
  ApiQueryResponse,
  ApiQueryResultValue,
} from '@arena/arena-sdk';
import { serializeEnvelope, toCorrelationId } from '@arena/protocol-core';
import type { CorrelationId, Envelope } from '@arena/protocol-core';
import { ApiFabric } from './fabric.js';

/** Service configuration (all injected; defaults are fresh instances). */
export interface ApiServiceConfig {
  readonly fabric?: ApiFabric;
}

/** The result of one handled api-query-request. */
export interface ApiQueryOutcome {
  /** The deserialized query envelope that was handled. */
  readonly request: Envelope<ApiQueryRequest>;
  /** The emitted response envelope. */
  readonly response: Envelope<ApiQueryResponse>;
  /** The serialized response (canonical JSON — the wire form). */
  readonly serializedResponse: string;
  /** The per-kind result the response carries. */
  readonly result: ApiQueryResultValue;
}

/**
 * The envelope-wired Arena API service. Construct with
 * `new ApiService()` or inject a pre-populated fabric.
 */
export class ApiService {
  readonly fabric: ApiFabric;

  constructor(config: ApiServiceConfig = {}) {
    this.fabric = config.fabric ?? new ApiFabric();
  }

  /**
   * Handle one api-query-request wire message: strict-parse the
   * envelope (kind `query`, api-namespace schema, NULL idempotency
   * key), dispatch through the fabric, and return the
   * api-query-response envelope (same correlation id).
   *
   * Any failure — malformed envelope, unknown query kind, invalid
   * params, cross-tenant scope violation — is normalized into a typed
   * ArenaApiError (fail-closed; nothing partial is returned).
   */
  async handleQueryRequest(raw: string): Promise<ApiQueryOutcome> {
    let request: Envelope<ApiQueryRequest>;
    try {
      request = parseApiQueryRequest(raw);
    } catch (error) {
      throw normalizeToArenaApiError(error);
    }
    let responsePayload: ApiQueryResponse;
    try {
      responsePayload = await this.fabric.handleQueryRequest(request.payload);
    } catch (error) {
      throw normalizeToArenaApiError(error);
    }
    let response: Envelope<ApiQueryResponse>;
    try {
      response = makeApiQueryResponse(responsePayload, request.correlationId);
    } catch (error) {
      throw normalizeToArenaApiError(error);
    }
    return {
      request,
      response,
      serializedResponse: serializeEnvelope(response),
      result: responsePayload.result,
    };
  }

  /**
   * Build (but do not handle) an api-query-request envelope — the
   * client-side counterpart of handleQueryRequest.
   */
  makeQuery(
    payload: ApiQueryRequest,
    correlationId: string,
  ): Envelope<ApiQueryRequest> {
    return makeApiQueryRequest(payload, toCorrelationId(correlationId));
  }

  /**
   * Strict-parse an api-query-response (consumer side) and return the
   * per-kind result. The envelope kind MUST be `response`.
   */
  readQueryResponse(raw: string): ApiQueryResultValue {
    try {
      const response = parseApiQueryResponse(raw);
      return response.payload.result;
    } catch (error) {
      throw normalizeToArenaApiError(error);
    }
  }

  /**
   * FAIL-CLOSED guard (consumer side): parse a response envelope and
   * assert it answers the given request — same correlation id, echoed
   * query kind. A mismatched pair can never be treated as an answer.
   */
  readQueryResponseFor(
    raw: string,
    request: Envelope<ApiQueryRequest>,
  ): ApiQueryResultValue {
    try {
      const response = parseApiQueryResponseFor(raw, request);
      return response.payload.result;
    } catch (error) {
      throw normalizeToArenaApiError(error);
    }
  }
}

/** Construct a fresh Arena API service. */
export function createApiService(config: ApiServiceConfig = {}): ApiService {
  return new ApiService(config);
}

/** Re-exported correlation helper for hosts building wire queries. */
export { toCorrelationId };
export type { CorrelationId };
