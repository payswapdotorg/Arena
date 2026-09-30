/**
 * The typed Arena API client (Work Order A025) — the programmatic
 * consumer surface over the platform's read/query paths.
 *
 * Architecture (mirrors the house dependency-injection discipline —
 * the A024 `ReleaseEvidenceStores` pattern, defined in the domain
 * package and injected by hosts):
 *
 *   - `ArenaApiTransport` — the client-side port: takes a query
 *     envelope, returns a response envelope. A host wires this to a
 *     network bridge, a process boundary, or the in-process loopback.
 *   - `ArenaQueryHandler` — the server-side port: dispatches one
 *     validated query payload. services/api's reference fabric
 *     satisfies it structurally.
 *   - `createLoopbackTransport(handler)` — the in-process wiring that
 *     still round-trips through envelope construction and strict
 *     response validation (no shortcut around the wire discipline).
 *
 * Every client method:
 *   - validates its inputs through the closed query vocabulary
 *     (fail-closed typed errors);
 *   - sends exactly one `query` envelope and awaits one `response`
 *     envelope with the SAME correlation id and the echoed query kind;
 *   - validates the result against the per-kind closed result
 *     vocabulary (sibling structural guards — isReleaseRecord etc.);
 *   - returns a DEEP-FROZEN result (records, arrays, compound
 *     projections);
 *   - surfaces every failure as a typed ArenaApiError
 *     (normalizeToArenaApiError — nothing partial escapes).
 */

import { newCorrelationId, serializeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, Envelope } from '@arena/protocol-core';
import type {
  BodyVersion,
} from '@arena/agent-body';
import type {
  CertificationRecord,
  CertificationSubject,
  CertificationSuite,
} from '@arena/certification';
import type { CompatibilityRecord } from '@arena/compatibility';
import type {
  ReleaseChannel,
  ReleasePublicationRecord,
  ReleaseRecord,
} from '@arena/body-registry';
import { ARENA_API_ERROR_CODES, ArenaApiError, normalizeToArenaApiError } from './errors.js';
import {
  makeApiQueryRequest,
  makeApiQueryResponse,
  parseApiQueryResponse,
} from './envelopes.js';
import type { ApiQueryResponse } from './queries.js';
import {
  apiQueryRequest,
  isApiQueryResultFor,
  type ApiQueryKind,
  type ApiQueryParams,
  type ApiQueryRequest,
  type ApiQueryResultValue,
  type ApiReadScope,
  type ApiReleaseStatus,
} from './queries.js';
import { deepFreeze } from './shared.js';
import { toApiReadScope } from './queries.js';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** The client-side transport port: query envelope in, response envelope out. */
export interface ArenaApiTransport {
  sendQuery(request: Envelope<ApiQueryRequest>): Promise<Envelope<ApiQueryResponse>>;
}

/**
 * The server-side dispatch port: one validated query payload in, one
 * validated response payload out. services/api's reference fabric
 * satisfies this interface structurally (fail-closed typed errors,
 * tenant-scoped reads).
 */
export interface ArenaQueryHandler {
  handleQueryRequest(payload: ApiQueryRequest): Promise<ApiQueryResponse>;
}

/**
 * Wire an in-process handler into a transport. The loopback still
 * constructs and validates REAL response envelopes — the client's
 * strict response parsing runs on every hop, so the in-process path
 * exercises the same wire discipline as a remote bridge.
 */
export function createLoopbackTransport(handler: ArenaQueryHandler): ArenaApiTransport {
  return {
    async sendQuery(request: Envelope<ApiQueryRequest>): Promise<Envelope<ApiQueryResponse>> {
      let responsePayload;
      try {
        responsePayload = await handler.handleQueryRequest(request.payload);
      } catch (error) {
        throw normalizeToArenaApiError(error);
      }
      try {
        return makeApiQueryResponse(responsePayload, request.correlationId);
      } catch (error) {
        throw normalizeToArenaApiError(error);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ArenaApiClientConfig {
  readonly transport: ArenaApiTransport;
  /** The tenant scope every query executes under (REQUIRED — no unscoped reads). */
  readonly scope: ApiReadScope;
}

/** The typed, fail-closed, deep-frozen client over the Arena read surface. */
export class ArenaApiClient {
  readonly transport: ArenaApiTransport;
  readonly scope: ApiReadScope;

  constructor(config: ArenaApiClientConfig) {
    this.transport = config.transport;
    this.scope = config.scope;
  }

  /** Construct a client bound to a tenant scope string. */
  static forTenant(transport: ArenaApiTransport, tenant: string): ArenaApiClient {
    return new ArenaApiClient({ transport, scope: toApiReadScope(tenant) });
  }

  // -------------------------------------------------------------------------
  // Release records + publications (A024)
  // -------------------------------------------------------------------------

  /** Get one release record by its content digest (null when unknown). */
  async getReleaseRecord(digest: string): Promise<ReleaseRecord | null> {
    return this.querySingle('get-release-record', { digest }, 'release record');
  }

  /** List every release record visible to the scope (append order). */
  async listReleaseRecords(): Promise<readonly ReleaseRecord[]> {
    return this.queryList('list-release-records', {}, 'release records');
  }

  /** List the release registrations of one body identity (append order). */
  async listBodyRegistrations(tenant: string, name: string): Promise<readonly ReleaseRecord[]> {
    return this.queryList('list-body-registrations', { tenant, name }, 'body registrations');
  }

  /** Resolve the latest ACTIVE release of a body on a channel (null when none). */
  async resolveActiveRelease(
    tenant: string,
    name: string,
    channel: ReleaseChannel,
  ): Promise<ReleaseRecord | null> {
    return this.querySingle('resolve-active-release', { tenant, name, channel }, 'active release');
  }

  /** Resolve the compound release status (lifecycle state + visibility). */
  async resolveReleaseStatus(
    namespace: string,
    name: string,
    version: string,
  ): Promise<ApiReleaseStatus> {
    const result = await this.send('resolve-release-status', { namespace, name, version });
    return this.expectStatus(result);
  }

  /** Get one release publication record by digest (null when unknown). */
  async getReleasePublication(digest: string): Promise<ReleasePublicationRecord | null> {
    return this.querySingle('get-release-publication', { digest }, 'release publication');
  }

  // -------------------------------------------------------------------------
  // Certification records / suites / statements (A023)
  // -------------------------------------------------------------------------

  /** Get one certification record (the derived statement travels inside). */
  async getCertificationRecord(digest: string): Promise<CertificationRecord | null> {
    return this.querySingle('get-certification-record', { digest }, 'certification record');
  }

  /** List every certification record visible to the scope (append order). */
  async listCertificationRecords(): Promise<readonly CertificationRecord[]> {
    return this.queryList('list-certification-records', {}, 'certification records');
  }

  /** List certification runs evaluated against one suite revision. */
  async listCertificationsBySuite(suiteRef: string): Promise<readonly CertificationRecord[]> {
    return this.queryList('list-certifications-by-suite', { suiteRef }, 'certifications');
  }

  /** The CURRENT (latest effective) certification of a composition under test. */
  async currentCertification(subject: CertificationSubject): Promise<CertificationRecord | null> {
    return this.querySingle('current-certification', { subject }, 'current certification');
  }

  /** Get one certification suite by its digest ("revision X"). */
  async getCertificationSuite(suiteRef: string): Promise<CertificationSuite | null> {
    return this.querySingle('get-certification-suite', { suiteRef }, 'certification suite');
  }

  /** List every certification suite (append order). */
  async listCertificationSuites(): Promise<readonly CertificationSuite[]> {
    return this.queryList('list-certification-suites', {}, 'certification suites');
  }

  // -------------------------------------------------------------------------
  // Compatibility verdicts (A022)
  // -------------------------------------------------------------------------

  /** Get one compatibility record by digest (null when unknown). */
  async getCompatibilityRecord(digest: string): Promise<CompatibilityRecord | null> {
    return this.querySingle('get-compatibility-record', { digest }, 'compatibility record');
  }

  /** List every compatibility record visible to the scope (append order). */
  async listCompatibilityRecords(): Promise<readonly CompatibilityRecord[]> {
    return this.queryList('list-compatibility-records', {}, 'compatibility records');
  }

  /** The LATEST compatibility verdict for one body-version × substrate pair. */
  async latestCompatibilityVerdict(
    bodyVersionRef: string,
    substrateRef: string,
  ): Promise<CompatibilityRecord | null> {
    return this.querySingle(
      'latest-compatibility-verdict',
      { bodyVersionRef, substrateRef },
      'compatibility verdict',
    );
  }

  // -------------------------------------------------------------------------
  // Body versions (A003)
  // -------------------------------------------------------------------------

  /** Get one body version by its content digest (null when unknown). */
  async getBodyVersion(digest: string): Promise<BodyVersion | null> {
    return this.querySingle('get-body-version', { digest }, 'body version');
  }

  // -------------------------------------------------------------------------
  // Internals — one strict send/validate path for every method
  // -------------------------------------------------------------------------

  private async send(kind: ApiQueryKind, params: ApiQueryParams): Promise<ApiQueryResultValue> {
    const correlationId: CorrelationId = newCorrelationId();
    let request: Envelope<ApiQueryRequest>;
    try {
      const payload = apiQueryRequest(kind, params, this.scope);
      request = makeApiQueryRequest(payload, correlationId);
    } catch (error) {
      throw normalizeToArenaApiError(error);
    }

    let responseEnvelope: Envelope<ApiQueryResponse>;
    try {
      const transportResponse = await this.transport.sendQuery(request);
      // Round-trip through the serialized canonical form so every
      // response is validated exactly as it would arrive off the wire.
      responseEnvelope = parseApiQueryResponse(serializeEnvelope(transportResponse));
    } catch (error) {
      throw normalizeToArenaApiError(error);
    }

    if (responseEnvelope.correlationId !== request.correlationId) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CORRELATION_MISMATCH, {
        message: `response correlation id ${JSON.stringify(String(responseEnvelope.correlationId))} does not match request ${JSON.stringify(String(request.correlationId))}`,
        details: {
          requestCorrelationId: String(request.correlationId),
          responseCorrelationId: String(responseEnvelope.correlationId),
        },
      });
    }
    if (responseEnvelope.payload.kind !== kind) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
        message: `response echoes query kind ${JSON.stringify(responseEnvelope.payload.kind)} but the request asked for ${JSON.stringify(kind)}`,
        details: { requested: kind, echoed: responseEnvelope.payload.kind },
      });
    }
    if (!isApiQueryResultFor(kind, responseEnvelope.payload.result)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
        message: `result does not match the closed result vocabulary of arena api query ${JSON.stringify(kind)}`,
        details: { kind },
      });
    }
    return responseEnvelope.payload.result;
  }

  private async querySingle<T extends object>(
    kind: ApiQueryKind,
    params: ApiQueryParams,
    what: string,
  ): Promise<T | null> {
    const result = await this.send(kind, params);
    if (result === null) return null;
    if (typeof result !== 'object' || Array.isArray(result)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
        message: `arena api query ${JSON.stringify(kind)} must answer with a single ${what} or null`,
      });
    }
    return deepFreeze(result) as T;
  }

  private async queryList<T extends object>(
    kind: ApiQueryKind,
    params: ApiQueryParams,
    what: string,
  ): Promise<readonly T[]> {
    const result = await this.send(kind, params);
    if (!Array.isArray(result)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
        message: `arena api query ${JSON.stringify(kind)} must answer with a list of ${what}`,
      });
    }
    return deepFreeze([...result]) as readonly T[];
  }

  private expectStatus(result: ApiQueryResultValue): ApiReleaseStatus {
    if (
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result) ||
      !('state' in result) ||
      !('visibility' in result)
    ) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
        message: 'arena api query "resolve-release-status" must answer with a compound release status',
      });
    }
    return deepFreeze(result) as ApiReleaseStatus;
  }
}

/** Construct a client bound to a tenant scope string. */
export function createArenaApiClient(
  transport: ArenaApiTransport,
  tenant: string,
): ArenaApiClient {
  return ArenaApiClient.forTenant(transport, tenant);
}
