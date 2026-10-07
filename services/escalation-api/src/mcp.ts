/**
 * MCP tool interface (Work Order C001; ES1.0 "API surfaces" — MCP tool
 * interface). A THIN tool layer over the SAME canonical lifecycle:
 * MCP is a SURFACE, not a new semantic authority. Tools:
 *
 *   - create-escalation       → EscalationApiService.createEscalation
 *   - get-escalation-status   → EscalationApiService.getEscalationStatus
 *
 * Wire form: JSON-RPC 2.0 shaped tool calls
 *   { jsonrpc: '2.0', id, method: 'tools/list' | 'tools/call',
 *     params: { name, arguments } }
 * answered by { jsonrpc: '2.0', id, result } or
 * { jsonrpc: '2.0', id, error: { code, message, data } } — the wire
 * transport binding (stdio framing, sessions) lives in
 * adapters/escalation (adapter law: transports never live in domain or
 * service packages).
 */

import { ESCALATION_ERROR_CODES, EscalationError, normalizeToEscalationError } from '@arena/escalation';
import type { CreateEscalationRequestInput } from '@arena/escalation';
import type { EscalationApiService } from './service.js';

export const MCP_TOOL_NAMES = Object.freeze(['create-escalation', 'get-escalation-status'] as const);
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const MCP_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const);

export interface McpToolDescriptor {
  readonly name: McpToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpToolCallRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: { readonly name?: string; readonly arguments?: Record<string, unknown> };
}

export interface McpToolCallResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
}

export interface McpToolCallResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: McpToolCallResult;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

/** The MCP tool server: one instance per backing EscalationApiService. */
export class McpToolServer {
  constructor(private readonly service: EscalationApiService) {}

  listTools(): McpToolDescriptor[] {
    return [
      {
        name: 'create-escalation',
        description:
          'Escalate a capability boundary to a human expert (ES1.0 EscalationRequest). ' +
          'Idempotent on (tenant, idempotency key, correlation id); duplicates replay the original.',
        inputSchema: {
          type: 'object',
          required: ['clientAppId', 'tenantId', 'capabilityNeed', 'escalationModes', 'urgency', 'idempotencyKey', 'correlationId'],
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

  /** Handle one JSON-RPC 2.0 shaped tool call (fail-closed). */
  async handleToolCall(request: McpToolCallRequest): Promise<McpToolCallResponse> {
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return error(request.id, MCP_ERROR_CODES.INVALID_REQUEST, 'malformed MCP tool call (jsonrpc 2.0 + method required)');
    }
    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { content: [{ type: 'text', text: JSON.stringify(this.listTools()) }] },
      };
    }
    if (request.method !== 'tools/call') {
      return error(request.id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `unknown MCP method: ${request.method}`);
    }
    const name = request.params?.name;
    if (name !== 'create-escalation' && name !== 'get-escalation-status') {
      return error(request.id, MCP_ERROR_CODES.INVALID_PARAMS, `unknown MCP tool: ${String(name)}`);
    }
    try {
      if (name === 'create-escalation') {
        const args = request.params?.arguments as CreateEscalationRequestInput | undefined;
        if (typeof args !== 'object' || args === null) {
          return error(request.id, MCP_ERROR_CODES.INVALID_PARAMS, 'create-escalation requires an arguments object');
        }
        const outcome = await this.service.createEscalation(args);
        return {
          jsonrpc: '2.0',
          id: request.id,
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
        };
      }
      const args = request.params?.arguments as { requestId?: string; tenantId?: string } | undefined;
      if (
        typeof args !== 'object' ||
        args === null ||
        typeof args.requestId !== 'string' ||
        typeof args.tenantId !== 'string'
      ) {
        return error(request.id, MCP_ERROR_CODES.INVALID_PARAMS, 'get-escalation-status requires requestId and tenantId');
      }
      const { record } = await this.service.getEscalationStatus({
        requestId: args.requestId,
        tenantId: args.tenantId,
      });
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                requestId: record.request.requestId,
                state: record.state,
                validationStatus: record.validationStatus ?? null,
                result: record.result ?? null,
                cost: record.cost ?? null,
                expertRef: record.expertRef ?? null,
                sessionRef: record.sessionRef ?? null,
              }),
            },
          ],
        },
      };
    } catch (thrown) {
      const err = normalizeToEscalationError(thrown);
      return error(request.id, MCP_ERROR_CODES.INTERNAL_ERROR, err.message, err.toWire());
    }
  }
}

function error(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): McpToolCallResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

/** Re-exported for consumers wiring the MCP surface. */
export { EscalationError as McpEscalationError, ESCALATION_ERROR_CODES as McpEscalationErrorCodes };
