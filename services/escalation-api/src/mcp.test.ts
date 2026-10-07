/**
 * MCP tool interface tests (Work Order C001) — the thin tool layer over
 * the canonical lifecycle: tools/list, create-escalation,
 * get-escalation-status and fail-closed JSON-RPC error shapes.
 */

import { describe, expect, it } from 'vitest';
import { McpToolServer, MCP_TOOL_NAMES, MCP_ERROR_CODES } from './mcp.js';
import { referenceService, validCreateInput } from './test-support.js';

const NOW = Date.parse('2026-10-07T10:00:00.000Z');

describe('MCP tool interface (surface, not authority)', () => {
  it('lists exactly the two canonical tools', async () => {
    const { service } = referenceService(NOW);
    const mcp = new McpToolServer(service);
    const tools = mcp.listTools();
    expect(toals(tools)).toEqual([...MCP_TOOL_NAMES]);
    expect(tools[0]?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('create-escalation tool delegates to the canonical service', async () => {
    const { service } = referenceService(NOW);
    const mcp = new McpToolServer(service);
    const response = await mcp.handleToolCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create-escalation', arguments: validCreateInput() as Record<string, unknown> },
    });
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();
    const payload = JSON.parse(response.result?.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload['outcome']).toBe('created');
    expect(String(payload['requestId'])).toMatch(/^esc_[0-9a-f]{32}$/);
    expect(payload['state']).toBe('offered');
    // The canonical service really holds the record (same lifecycle).
    const status = await service.getEscalationStatus({
      requestId: String(payload['requestId']),
      tenantId: 'tenant-alpha',
    });
    expect(status.record.state).toBe('offered');
  });

  it('get-escalation-status tool returns the canonical record fields', async () => {
    const { service } = referenceService(NOW);
    const mcp = new McpToolServer(service);
    const created = await service.createEscalation(validCreateInput() as never);
    const response = await mcp.handleToolCall({
      jsonrpc: '2.0',
      id: 'q1',
      method: 'tools/call',
      params: {
        name: 'get-escalation-status',
        arguments: { requestId: created.requestId, tenantId: 'tenant-alpha' },
      },
    });
    const payload = JSON.parse(response.result?.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload['state']).toBe('offered');
    expect(payload['expertRef']).toBe('expert-kwame');
    expect(payload['result']).toBeNull();
  });

  it('idempotent replay through the MCP surface returns the ORIGINAL request', async () => {
    const { service } = referenceService(NOW);
    const mcp = new McpToolServer(service);
    const first = await mcp.handleToolCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create-escalation', arguments: validCreateInput() as Record<string, unknown> },
    });
    const second = await mcp.handleToolCall({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create-escalation', arguments: validCreateInput() as Record<string, unknown> },
    });
    const a = JSON.parse(first.result?.content[0]?.text ?? '{}') as Record<string, unknown>;
    const b = JSON.parse(second.result?.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(b['outcome']).toBe('replay');
    expect(b['requestId']).toBe(a['requestId']);
  });

  it('fail-closed: unknown tools, methods and malformed calls return typed JSON-RPC errors', async () => {
    const { service } = referenceService(NOW);
    const mcp = new McpToolServer(service);
    const unknownTool = await mcp.handleToolCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'delete-everything', arguments: {} },
    });
    expect(unknownTool.error?.code).toBe(MCP_ERROR_CODES.INVALID_PARAMS);
    const unknownMethod = await mcp.handleToolCall({ jsonrpc: '2.0', id: 2, method: 'admin/shutdown' });
    expect(unknownMethod.error?.code).toBe(MCP_ERROR_CODES.METHOD_NOT_FOUND);
    const malformed = await mcp.handleToolCall({ id: 3, method: 'tools/call' } as never);
    expect(malformed.error?.code).toBe(MCP_ERROR_CODES.INVALID_REQUEST);
  });

  it('domain failures surface as typed JSON-RPC internal errors with wire data', async () => {
    const { service } = referenceService(NOW);
    const mcp = new McpToolServer(service);
    const response = await mcp.handleToolCall({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'create-escalation', arguments: validCreateInput({ escalationModes: ['vibes'] }) as Record<string, unknown> },
    });
    expect(response.error?.code).toBe(MCP_ERROR_CODES.INTERNAL_ERROR);
    expect(response.error?.data).toMatchObject({ code: 'ESCALATION_INVALID_MODE' });
  });
});

function toals(tools: ReadonlyArray<{ name: string }>): string[] {
  return tools.map((tool) => tool.name);
}
