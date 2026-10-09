/**
 * services/escalation-api/src/http-host/server.ts — the real HTTP listener
 * binding the frozen host interface to runnable transport (Work Order
 * P003; issue #155; ADR-P001-07 §4 + ADR-P001-08).
 *
 * Node's BUILT-IN node:http module — zero external runtime dependencies
 * (the apps/web/src/workbench + console transport precedent, the
 * established repo server pattern). The listener mounts the C001 REST
 * contracts VERBATIM over the injected `HostEscalationsTransport` mirror
 * of the frozen host surface:
 *
 *   POST /v1/escalations       — create (scoped `escalations:create`,
 *                                 live keys only; 201 created / 200 replay
 *                                 with the recorded outcome VERBATIM + the
 *                                 replay marker; idempotency key + body
 *                                 mismatch → typed 409
 *                                 ESCALATION_IDENTITY_CONFLICT);
 *   GET  /v1/escalations/{id}  — status (scoped `escalations:read`;
 *                                 tenant-scoped + lens-stamped reads);
 *   POST /mcp                  — the MCP tool layer over the SAME
 *                                 authority (../mcp-host — one authority,
 *                                 two transports);
 *   GET  /healthz, /readyz     — health + readiness at the listener
 *                                 (fail-closed aggregate; no tenant data).
 *
 * Error renderings are the shared taxonomy (./errors.ts — ADR-P001-08
 * rule 5). The handler is TOTAL: it never crashes the process; unknown
 * failures fail closed as the typed 500.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { authorizeBoundaryRequest, tenantBindingVerdict } from './auth.js';
import { renderApiKeyDenial, renderTransportError, renderTypedError } from './errors.js';
import { DEVELOPER_CODE_MIRROR, DEVELOPER_CODE_HTTP, DEVELOPER_CODE_CATEGORY_MIRROR } from './errors.js';
import type { TransportErrorRendering } from './errors.js';
import { handleMcpHttpRequest } from '../mcp-host/index.js';
import type { McpHostConfig } from '../mcp-host/index.js';
import type {
  ApiKeyAuthenticator,
  HostEscalationsTransport,
  HostHealthProvider,
  HttpHostClock,
} from './ports.js';
import { HTTP_HOST_HEADER_NAMES, HTTP_HOST_ROUTES } from './ports.js';

/** Default bind address (loopback — the API is an operational surface). */
export const DEFAULT_API_HTTP_HOST = '127.0.0.1';

/** Default port (the deployable shell overrides via env). */
export const DEFAULT_API_HTTP_PORT = 8787;

/** Default maximum request body the transport accepts (1 MiB). */
export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** The public environment this host serves (sandbox keys fail closed). */
const LIVE_ENVIRONMENT = 'live' as const;

/** The configured transport (all infrastructure injected). */
export interface EscalationHttpHostConfig {
  /** The tenant-gated escalation surface (frozen-host mirror). */
  readonly surface: HostEscalationsTransport;
  /** The health/readiness provider (fail-closed aggregate snapshot). */
  readonly health: HostHealthProvider;
  /** The scoped API-key authenticator (developer-platform key model). */
  readonly authenticator: ApiKeyAuthenticator;
  /** Injected clock (A015 law — never a wall clock). */
  readonly clock: HttpHostClock;
  /** Transport options (all defaulted). */
  readonly options?: {
    readonly maxBodyBytes?: number;
  };
}

/** A parsed request body outcome (bounded read, fail-closed). */
type BodyRead =
  | { readonly outcome: 'read'; readonly text: string }
  | { readonly outcome: 'rejected'; readonly rendering: TransportErrorRendering };

/** Normalize a raw request URL into routable segments (no query/fragment). */
export function requestSegments(rawUrl: string | undefined): readonly string[] {
  const withoutQuery = (rawUrl ?? '/').split('?')[0] ?? '/';
  const withoutFragment = withoutQuery.split('#')[0] ?? '/';
  const path = withoutFragment.startsWith('/') ? withoutFragment : `/${withoutFragment}`;
  return path.split('/').filter((segment) => segment.length > 0);
}

/** URL-decode one path segment (request ids are opaque identifiers). */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Read the request body (bounded; typed 413 rendering on overflow). */
function readBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const rejectWith = (rendering: TransportErrorRendering) => {
      if (settled) return;
      settled = true;
      request.destroy();
      resolve({ outcome: 'rejected', rendering });
    };
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        rejectWith(
          renderTypedError({
            status: 413,
            code: DEVELOPER_CODE_MIRROR.INVALID_REQUEST,
            category: 'validation',
            message: `request body exceeds the transport limit of ${String(maxBodyBytes)} bytes (fail closed)`,
            details: { maxBodyBytes },
          }),
        );
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve({ outcome: 'read', text: Buffer.concat(chunks).toString('utf-8') });
    });
    request.on('error', () => {
      rejectWith(
        renderTypedError({
          status: 400,
          code: DEVELOPER_CODE_MIRROR.INVALID_REQUEST,
          category: 'validation',
          message: 'the request body stream failed before completion (fail closed)',
        }),
      );
    });
  });
}

/** Send a JSON response (status + body + content type; HEAD-safe). */
function sendJson(
  response: ServerResponse,
  status: number,
  body: string,
  headOnly: boolean,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  const payload = Buffer.from(body, 'utf-8');
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(payload.length));
  if (extraHeaders !== undefined) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      response.setHeader(name, value);
    }
  }
  response.end(headOnly ? undefined : payload);
}

/** Send one typed transport error rendering. */
function sendRendering(
  response: ServerResponse,
  rendering: TransportErrorRendering,
  headOnly: boolean,
): void {
  sendJson(response, rendering.status, JSON.stringify(rendering.body), headOnly);
}

/** The 405 (method not allowed) response — status + Allow, no typed body (transport-level). */
function sendMethodNotAllowed(
  response: ServerResponse,
  allow: readonly string[],
  headOnly: boolean,
): void {
  response.statusCode = 405;
  response.setHeader('Allow', allow.join(', '));
  response.setHeader('Content-Length', '0');
  response.end(headOnly ? undefined : undefined);
}

/** The 404 (unknown route) response — plain status (transport-level, no typed body). */
function sendNotFound(response: ServerResponse, headOnly: boolean): void {
  response.statusCode = 404;
  response.setHeader('Content-Length', '0');
  response.end(headOnly ? undefined : undefined);
}

/** A typed 415 rendering for unsupported content types. */
function unsupportedContentRendering(): TransportErrorRendering {
  return renderTypedError({
    status: 415,
    code: DEVELOPER_CODE_MIRROR.INVALID_REQUEST,
    category: 'validation',
    message: 'the escalation API accepts application/json request bodies only',
    details: { accepted: ['application/json'] },
  });
}

/** A typed 400 rendering for unparseable JSON bodies. */
function unparseableBodyRendering(): TransportErrorRendering {
  return renderTypedError({
    status: 400,
    code: DEVELOPER_CODE_MIRROR.INVALID_REQUEST,
    category: 'validation',
    message: 'the request body is not valid JSON (fail closed)',
  });
}

/**
 * The escalation API HTTP application: a TOTAL async request handler over
 * the injected transport ports. `createEscalationApiHttpApp` never opens a
 * socket — `startEscalationHttpHost` binds it to a real listener.
 */
export function createEscalationApiHttpApp(
  config: EscalationHttpHostConfig,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const maxBodyBytes = config.options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const mcpConfig: McpHostConfig = {
    surface: config.surface,
    authenticator: config.authenticator,
    clock: config.clock,
  };

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headOnly = request.method === 'HEAD';
    const method = request.method ?? 'GET';
    const segments = requestSegments(request.url);
    try {
      // -- health + readiness (unauthenticated; no tenant data) -----------
      if (segments.length === 1 && segments[0] === HTTP_HOST_ROUTES.health.slice(1)) {
        if (method !== 'GET' && method !== 'HEAD') {
          sendMethodNotAllowed(response, ['GET', 'HEAD'], headOnly);
          return;
        }
        const snapshot = await config.health();
        const status = snapshot.ready ? 200 : 503;
        sendJson(
          response,
          status,
          JSON.stringify({
            state: snapshot.state,
            ready: snapshot.ready,
            capacity: snapshot.capacityStatus,
            components: snapshot.components,
            checkedAt: snapshot.checkedAt,
          }),
          headOnly,
        );
        return;
      }
      if (segments.length === 1 && segments[0] === HTTP_HOST_ROUTES.readiness.slice(1)) {
        if (method !== 'GET' && method !== 'HEAD') {
          sendMethodNotAllowed(response, ['GET', 'HEAD'], headOnly);
          return;
        }
        const snapshot = await config.health();
        sendJson(
          response,
          snapshot.ready ? 200 : 503,
          JSON.stringify({ ready: snapshot.ready, state: snapshot.state }),
          headOnly,
        );
        return;
      }

      // -- POST /v1/escalations (the C001 create contract) ----------------
      if (segments.length === 2 && segments[0] === 'v1' && segments[1] === 'escalations') {
        if (method !== 'POST') {
          sendMethodNotAllowed(response, ['POST'], headOnly);
          return;
        }
        const contentType = request.headers[HTTP_HOST_HEADER_NAMES.contentType];
        if (contentType !== undefined && !contentType.toLowerCase().startsWith('application/json')) {
          sendRendering(response, unsupportedContentRendering(), headOnly);
          return;
        }
        const auth = await authorizeBoundaryRequest({
          authenticator: config.authenticator,
          authorizationHeader: request.headers[HTTP_HOST_HEADER_NAMES.authorization],
          scope: 'escalations:create',
          environment: LIVE_ENVIRONMENT,
        });
        if (auth.outcome === 'denied') {
          sendRendering(
            response,
            renderApiKeyDenial(auth.reason, {
              scope: 'escalations:create',
              environment: LIVE_ENVIRONMENT,
            }),
            headOnly,
          );
          return;
        }
        const body = await readBody(request, maxBodyBytes);
        if (body.outcome === 'rejected') {
          sendRendering(response, body.rendering, headOnly);
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.text);
        } catch {
          sendRendering(response, unparseableBodyRendering(), headOnly);
          return;
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          sendRendering(response, unparseableBodyRendering(), headOnly);
          return;
        }
        const submittedTenantId = (parsed as Record<string, unknown>)['tenantId'];
        if (typeof submittedTenantId !== 'string' || submittedTenantId.length === 0) {
          sendRendering(
            response,
            renderTypedError({
              status: 400,
              code: DEVELOPER_CODE_MIRROR.INVALID_REQUEST,
              category: 'validation',
              message: 'the escalation submission must carry a non-empty tenantId',
            }),
            headOnly,
          );
          return;
        }
        // Tenant policy at the boundary: the authenticated key's tenant IS
        // the request tenant; a disagreeing client-claimed tenant fails
        // closed with the typed cross-tenant code (the host underneath
        // would fail closed too — RUNTIME_CROSS_TENANT_ACCESS).
        const binding = tenantBindingVerdict(auth.identity, submittedTenantId);
        if (binding.outcome === 'mismatch') {
          sendRendering(
            response,
            renderTypedError({
              status: DEVELOPER_CODE_HTTP[DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS],
              code: DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS,
              category: DEVELOPER_CODE_CATEGORY_MIRROR[DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS],
              message: `the authenticated key belongs to tenant ${JSON.stringify(auth.identity.tenantId)} and may not submit for tenant ${JSON.stringify(submittedTenantId)} (fail closed)`,
              details: {
                keyTenant: auth.identity.tenantId,
                submittedTenant: submittedTenantId,
              },
            }),
            headOnly,
          );
          return;
        }
        const input = parsed as Parameters<HostEscalationsTransport['create']>[1];
        const outcome = await config.surface.create(binding.tenantId, input);
        // The C001 law: created → 201 with the serialized response; replay
        // → 200 with the RECORDED outcome VERBATIM (the replay marker —
        // kind escalation-replayed + duplicate:true — is inside the
        // serialized payload).
        sendJson(
          response,
          outcome.outcome === 'created' ? 201 : 200,
          outcome.serializedResponse,
          headOnly,
          { [HTTP_HOST_HEADER_NAMES.requestId]: outcome.requestId },
        );
        return;
      }

      // -- GET /v1/escalations/{request_id} (the C001 status contract) ----
      if (segments.length === 3 && segments[0] === 'v1' && segments[1] === 'escalations') {
        if (method !== 'GET' && method !== 'HEAD') {
          sendMethodNotAllowed(response, ['GET', 'HEAD'], headOnly);
          return;
        }
        const requestId = decodeSegment(segments[2] ?? '');
        const auth = await authorizeBoundaryRequest({
          authenticator: config.authenticator,
          authorizationHeader: request.headers[HTTP_HOST_HEADER_NAMES.authorization],
          scope: 'escalations:read',
          environment: LIVE_ENVIRONMENT,
        });
        if (auth.outcome === 'denied') {
          sendRendering(
            response,
            renderApiKeyDenial(auth.reason, {
              scope: 'escalations:read',
              environment: LIVE_ENVIRONMENT,
            }),
            headOnly,
          );
          return;
        }
        // The authenticated key's tenant scopes the read; cross-tenant
        // reads fail closed underneath (typed RUNTIME_ESCALATION_NOT_FOUND).
        const status = await config.surface.status(auth.identity.tenantId, requestId);
        sendJson(
          response,
          200,
          JSON.stringify(status.response.payload),
          headOnly,
          { [HTTP_HOST_HEADER_NAMES.requestId]: requestId },
        );
        return;
      }

      // -- POST /mcp (the MCP tool layer over the SAME authority) ---------
      if (segments.length === 1 && segments[0] === HTTP_HOST_ROUTES.mcp.slice(1)) {
        if (method !== 'POST') {
          sendMethodNotAllowed(response, ['POST'], headOnly);
          return;
        }
        const contentType = request.headers[HTTP_HOST_HEADER_NAMES.contentType];
        if (contentType !== undefined && !contentType.toLowerCase().startsWith('application/json')) {
          sendRendering(response, unsupportedContentRendering(), headOnly);
          return;
        }
        const body = await readBody(request, maxBodyBytes);
        if (body.outcome === 'rejected') {
          sendRendering(response, body.rendering, headOnly);
          return;
        }
        const mcpResult = await handleMcpHttpRequest(mcpConfig, {
          authorization: request.headers[HTTP_HOST_HEADER_NAMES.authorization],
          rawBody: body.text,
        });
        sendJson(response, mcpResult.status, mcpResult.body, headOnly);
        return;
      }

      // -- unknown route (transport-level 404) ---------------------------
      sendNotFound(response, headOnly);
    } catch (error: unknown) {
      // TOTAL handler: any thrown failure renders through the shared
      // taxonomy (typed 500 fallback for unknown shapes — fail closed,
      // never a crash, never a raw passthrough).
      sendRendering(response, renderTransportError(error), headOnly);
    }
  };
}

/** A running escalation API HTTP host (real listener on a real port). */
export interface RunningEscalationHttpHost {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
  readonly url: string;
  /** Stop the server (resolves once no connections remain). */
  close(): Promise<void>;
}

/**
 * Start the escalation API HTTP host on a real listener. Port 0 asks the
 * kernel for an ephemeral port — the acceptance battery's pattern (the
 * test owns the ACTUAL local URL).
 */
export function startEscalationHttpHost(
  config: EscalationHttpHostConfig,
  options: { port?: number; host?: string } = {},
): Promise<RunningEscalationHttpHost> {
  const port = options.port ?? DEFAULT_API_HTTP_PORT;
  const host = options.host ?? DEFAULT_API_HTTP_HOST;
  const handler = createEscalationApiHttpApp(config);
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort =
        typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        server,
        port: actualPort,
        host,
        url: `http://${host}:${actualPort}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error !== undefined) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}
