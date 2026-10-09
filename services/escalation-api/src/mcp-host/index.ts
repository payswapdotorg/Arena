/**
 * services/escalation-api/src/mcp-host/index.ts — the MCP tool layer over
 * the SAME authority (Work Order P003; issue #155; ADR-P001-08 rule 1:
 * "one authority, two transports").
 *
 * A THIN tool layer mirroring the C001 MCP tool semantics
 * (services/escalation-api/src/mcp.ts — McpToolServer) over the P003
 * transport surface (../http-host/ports.ts — the frozen-host mirror):
 * MCP is a SURFACE, not a new semantic authority. Same tool names, same
 * input schemas, same response shapes, same typed error taxonomy — the
 * parity is PINNED by tests/api-host (tool descriptors compared
 * value-for-value against the real McpToolServer).
 *
 * Transport binding: this host speaks HTTP (POST /mcp — JSON-RPC 2.0
 * bodies) because the P003 listener is an HTTP listener; the C001 stdio
 * framing (adapters/escalation's McpStdioTransport) stays the separate
 * wire binding it already owns. Authorization rides the SAME boundary as
 * the REST surface (Authorization: Bearer <developer key>; tools/call is
 * scoped per tool; tools/list is open contract metadata).
 *
 * JSON-RPC 2.0 renderings (mirroring the C001 layer's codes):
 *   - malformed JSON body            → HTTP 400 + PARSE_ERROR (-32700)
 *   - malformed request object       → HTTP 400 + INVALID_REQUEST (-32600)
 *   - unknown method                 → HTTP 200 + METHOD_NOT_FOUND (-32601)
 *   - unknown tool / bad arguments   → HTTP 200 + INVALID_PARAMS (-32602)
 *   - tool execution failure         → HTTP 200 + INTERNAL_ERROR (-32603)
 *     with `data` = the escalation wire error (typed code + category)
 *   - boundary auth/tenant failures  → HTTP 401/403 + the shared typed
 *     error body (transport-level; the SAME taxonomy as the REST routes).
 */

import { normalizeToEscalationError } from '@arena/escalation';
import type { CreateEscalationRequestInput } from '@arena/escalation';
import { authorizeBoundaryRequest, tenantBindingVerdict } from '../http-host/auth.js';
import {
  DEVELOPER_CODE_CATEGORY_MIRROR,
  DEVELOPER_CODE_HTTP,
  DEVELOPER_CODE_MIRROR,
  renderApiKeyDenial,
  renderTypedError,
} from '../http-host/errors.js';
import type {
  ApiKeyAuthenticator,
  HostEscalationsTransport,
  HttpHostClock,
} from '../http-host/ports.js';

/** The MCP tool names (mirror of the C001 MCP_TOOL_NAMES). */
export const MCP_TOOL_NAMES = Object.freeze([
  'create-escalation',
  'get-escalation-status',
] as const);
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** JSON-RPC 2.0 error codes (mirror of the C001 MCP_ERROR_CODES). */
export const MCP_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const);

/** One MCP tool descriptor (mirror of the C001 McpToolDescriptor). */
export interface McpToolDescriptor {
  readonly name: McpToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** The public environment this host serves (sandbox keys fail closed). */
const LIVE_ENVIRONMENT = 'live' as const;

/** The configured MCP tool host (all infrastructure injected). */
export interface McpHostConfig {
  /** The tenant-gated escalation surface — the SAME authority as REST. */
  readonly surface: HostEscalationsTransport;
  /** The scoped API-key authenticator (developer-platform key model). */
  readonly authenticator: ApiKeyAuthenticator;
  /** Injected clock (A015 law). */
  readonly clock: HttpHostClock;
}

/** One MCP-over-HTTP request as the HTTP transport feeds it. */
export interface McpHttpRequest {
  readonly authorization: string | undefined;
  readonly rawBody: string;
}

/** One MCP-over-HTTP response (status + serialized JSON body). */
export interface McpHttpResponse {
  readonly status: number;
  readonly body: string;
}

/** The tool catalog (mirrors the C001 McpToolServer.listTools verbatim). */
export function listMcpTools(): McpToolDescriptor[] {
  return [
    {
      name: 'create-escalation',
      description:
        'Escalate a capability boundary to a human expert (ES1.0 EscalationRequest). ' +
        'Idempotent on (tenant, idempotency key, correlation id); duplicates replay the original.',
      inputSchema: {
        type: 'object',
        required: [
          'clientAppId',
          'tenantId',
          'capabilityNeed',
          'escalationModes',
          'urgency',
          'idempotencyKey',
          'correlationId',
        ],
        properties: {
          clientAppId: { type: 'string' },
          tenantId: { type: 'string' },
          capabilityNeed: { type: 'string' },
          escalationModes: { type: 'array', items: { type: 'string' } },
          urgency: { type: 'string' },
          idempotencyKey: { type: 'string' },
          correlationId: { type: 'string' },
        },
      },
    },
    {
      name: 'get-escalation-status',
      description:
        'Idempotent, tenant-scoped status polling for one escalation (state, result, validation status, cost).',
      inputSchema: {
        type: 'object',
        required: ['requestId', 'tenantId'],
        properties: {
          requestId: { type: 'string' },
          tenantId: { type: 'string' },
        },
      },
    },
  ];
}

/** Handle one MCP-over-HTTP request (total; never throws). */
export async function handleMcpHttpRequest(
  config: McpHostConfig,
  request: McpHttpRequest,
): Promise<McpHttpResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.rawBody);
  } catch {
    return jsonRpcErrorResponse(null, MCP_ERROR_CODES.PARSE_ERROR, 'malformed MCP request body (not JSON)', 400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return jsonRpcErrorResponse(
      null,
      MCP_ERROR_CODES.INVALID_REQUEST,
      'malformed MCP tool call (jsonrpc 2.0 object required)',
      400,
    );
  }
  const call = parsed as Record<string, unknown>;
  const id = (['string', 'number'].includes(typeof call['id']) ? call['id'] : null) as
    | string
    | number
    | null;
  if (call['jsonrpc'] !== '2.0' || typeof call['method'] !== 'string') {
    return jsonRpcErrorResponse(
      id,
      MCP_ERROR_CODES.INVALID_REQUEST,
      'malformed MCP tool call (jsonrpc 2.0 + method required)',
      400,
    );
  }
  const method = call['method'];
  if (method === 'tools/list') {
    // Open contract metadata — no tenant data, no authorization needed.
    return {
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(listMcpTools()) }] },
      }),
    };
  }
  if (method !== 'tools/call') {
    return jsonRpcErrorResponse(id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `unknown MCP method: ${method}`, 200);
  }
  const params = call['params'];
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return jsonRpcErrorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, 'tools/call requires a params object', 200);
  }
  const name = (params as Record<string, unknown>)['name'];
  if (name !== 'create-escalation' && name !== 'get-escalation-status') {
    return jsonRpcErrorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, `unknown MCP tool: ${String(name)}`, 200);
  }
  const args = (params as Record<string, unknown>)['arguments'];
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return jsonRpcErrorResponse(
      id,
      MCP_ERROR_CODES.INVALID_PARAMS,
      `the ${name} tool requires an arguments object`,
      200,
    );
  }

  const scope = name === 'create-escalation' ? 'escalations:create' : 'escalations:read';
  const auth = await authorizeBoundaryRequest({
    authenticator: config.authenticator,
    authorizationHeader: request.authorization,
    scope,
    environment: LIVE_ENVIRONMENT,
  });
  if (auth.outcome === 'denied') {
    const rendering = renderApiKeyDenial(auth.reason, {
      scope,
      environment: LIVE_ENVIRONMENT,
    });
    return { status: rendering.status, body: JSON.stringify(rendering.body) };
  }

  if (name === 'create-escalation') {
    return handleCreateTool(config, auth.identity, args as Record<string, unknown>, id);
  }
  return handleStatusTool(config, auth.identity, args as Record<string, unknown>, id);
}

/** The create-escalation tool over the SAME authority (tenant-bound). */
async function handleCreateTool(
  config: McpHostConfig,
  identity: { readonly tenantId: string },
  args: Record<string, unknown>,
  id: string | number | null,
): Promise<McpHttpResponse> {
  const submittedTenantId = args['tenantId'];
  if (typeof submittedTenantId !== 'string' || submittedTenantId.length === 0) {
    const rendering = renderTypedError({
      status: 400,
      code: DEVELOPER_CODE_MIRROR.INVALID_REQUEST,
      category: 'validation',
      message: 'the create-escalation tool requires a non-empty tenantId argument',
    });
    return { status: rendering.status, body: JSON.stringify(rendering.body) };
  }
  const binding = tenantBindingVerdict(identity, submittedTenantId);
  if (binding.outcome === 'mismatch') {
    const rendering = renderTypedError({
      status: DEVELOPER_CODE_HTTP[DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS],
      code: DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS,
      category: DEVELOPER_CODE_CATEGORY_MIRROR[DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS],
      message: `the authenticated key belongs to tenant ${JSON.stringify(identity.tenantId)} and may not submit for tenant ${JSON.stringify(submittedTenantId)} (fail closed)`,
      details: { keyTenant: identity.tenantId, submittedTenant: submittedTenantId },
    });
    return { status: rendering.status, body: JSON.stringify(rendering.body) };
  }
  try {
    const outcome = await config.surface.create(
      binding.tenantId,
      args as unknown as CreateEscalationRequestInput,
    );
    return {
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                outcome: outcome.outcome,
                requestId: outcome.requestId,
                duplicate: outcome.duplicate,
                state: outcome.record.state,
              }),
            },
          ],
        },
      }),
    };
  } catch (error: unknown) {
    const err = normalizeToEscalationError(error);
    return jsonRpcErrorResponse(id, MCP_ERROR_CODES.INTERNAL_ERROR, err.message, 200, err.toWire());
  }
}

/** The get-escalation-status tool over the SAME authority (tenant-bound). */
async function handleStatusTool(
  config: McpHostConfig,
  identity: { readonly tenantId: string },
  args: Record<string, unknown>,
  id: string | number | null,
): Promise<McpHttpResponse> {
  const requestId = args['requestId'];
  const claimedTenantId = args['tenantId'];
  if (typeof requestId !== 'string' || typeof claimedTenantId !== 'string') {
    return jsonRpcErrorResponse(
      id,
      MCP_ERROR_CODES.INVALID_PARAMS,
      'get-escalation-status requires requestId and tenantId',
      200,
    );
  }
  const binding = tenantBindingVerdict(identity, claimedTenantId);
  if (binding.outcome === 'mismatch') {
    const rendering = renderTypedError({
      status: DEVELOPER_CODE_HTTP[DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS],
      code: DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS,
      category: DEVELOPER_CODE_CATEGORY_MIRROR[DEVELOPER_CODE_MIRROR.CROSS_TENANT_ACCESS],
      message: `the authenticated key belongs to tenant ${JSON.stringify(identity.tenantId)} and may not read tenant ${JSON.stringify(claimedTenantId)} (fail closed)`,
      details: { keyTenant: identity.tenantId, claimedTenant: claimedTenantId },
    });
    return { status: rendering.status, body: JSON.stringify(rendering.body) };
  }
  try {
    const status = await config.surface.status(identity.tenantId, requestId);
    return {
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                requestId: status.record.request.requestId,
                state: status.record.state,
                validationStatus: status.record.validationStatus ?? null,
                result: status.record.result ?? null,
                cost: status.record.cost ?? null,
                expertRef: status.record.expertRef ?? null,
                sessionRef: status.record.sessionRef ?? null,
              }),
            },
          ],
        },
      }),
    };
  } catch (error: unknown) {
    const err = normalizeToEscalationError(error);
    return jsonRpcErrorResponse(id, MCP_ERROR_CODES.INTERNAL_ERROR, err.message, 200, err.toWire());
  }
}

/** One JSON-RPC error response (mirrors the C001 layer's renderings). */
function jsonRpcErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  httpStatus: number,
  data?: unknown,
): McpHttpResponse {
  return {
    status: httpStatus,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    }),
  };
}
