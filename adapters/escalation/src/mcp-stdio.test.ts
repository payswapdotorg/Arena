/**
 * MCP stdio transport binding tests (Work Order C001): newline-delimited
 * JSON-RPC framing, chunk safety, fail-closed parse errors.
 */

import { describe, expect, it } from 'vitest';
import {
  MCP_TRANSPORT_ERROR_CODES,
  McpStdioTransport,
  frameWireMessage,
  parseErrorResponse,
  parseWireRequestLine,
} from './mcp-stdio.js';
import { EchoMcpHandler } from './test-support.js';

describe('McpStdioTransport — framing', () => {
  it('frames and answers one complete tool call line', async () => {
    const transport = new McpStdioTransport({ handler: new EchoMcpHandler() });
    const line = JSON.stringify({ jsonrpc: '2.0', id: 'call-1', method: 'tools/list', params: {} });
    const framed = await transport.handleLine(line);
    expect(framed).not.toBeNull();
    const parsed = JSON.parse(framed!) as { jsonrpc: string; id: string; result: unknown };
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe('call-1');
    expect(parsed.result).toBeDefined();
  });

  it('skips blank lines', async () => {
    const transport = new McpStdioTransport({ handler: new EchoMcpHandler() });
    expect(await transport.handleLine('')).toBeNull();
    expect(await transport.handleLine('   ')).toBeNull();
  });

  it('answers unparseable JSON with PARSE_ERROR (id null) and keeps the stream alive', async () => {
    const transport = new McpStdioTransport({ handler: new EchoMcpHandler() });
    const bad = await transport.handleLine('{not json');
    const parsed = JSON.parse(bad!) as { id: null; error: { code: number } };
    expect(parsed.id).toBeNull();
    expect(parsed.error.code).toBe(MCP_TRANSPORT_ERROR_CODES.PARSE_ERROR);
    // stream stays alive afterwards
    const good = await transport.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }));
    expect(JSON.parse(good!).id).toBe(7);
  });

  it('answers a JSON non-object line with PARSE_ERROR', async () => {
    const transport = new McpStdioTransport({ handler: new EchoMcpHandler() });
    const bad = await transport.handleLine('[1,2,3]');
    expect(JSON.parse(bad!).error.code).toBe(MCP_TRANSPORT_ERROR_CODES.PARSE_ERROR);
  });

  it('splits arbitrary chunks on newlines and buffers partial lines', async () => {
    const transport = new McpStdioTransport({ handler: new EchoMcpHandler() });
    const request = JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'tools/list' });
    // first half: no newline yet → no responses
    expect(await transport.handleChunk(request.slice(0, 20))).toEqual([]);
    // second half closes the line → exactly one response
    const responses = await transport.handleChunk(`${request.slice(20)}\n`);
    expect(responses).toHaveLength(1);
    expect(JSON.parse(responses[0]!).id).toBe('a');
    // two lines in one chunk → two ordered responses
    const b = JSON.stringify({ jsonrpc: '2.0', id: 'b', method: 'tools/list' });
    const c = JSON.stringify({ jsonrpc: '2.0', id: 'c', method: 'tools/list' });
    const two = await transport.handleChunk(`${b}\n${c}\n`);
    expect(two.map((r) => (JSON.parse(r) as { id: string }).id)).toEqual(['b', 'c']);
  });

  it('flush processes a trailing unterminated line — never silently dropped', async () => {
    const transport = new McpStdioTransport({ handler: new EchoMcpHandler() });
    const request = JSON.stringify({ jsonrpc: '2.0', id: 'final', method: 'tools/list' });
    expect(await transport.handleChunk(request)).toEqual([]);
    const flushed = await transport.flush();
    expect(flushed).toHaveLength(1);
    expect(JSON.parse(flushed[0]!).id).toBe('final');
    expect(await transport.flush()).toEqual([]);
  });

  it('fails closed on construction without a handler', () => {
    expect(() => new McpStdioTransport({ handler: undefined as unknown as never })).toThrow(
      /requires an MCP tool handler/,
    );
  });

  it('handler-thrown errors propagate to the host (the tool layer owns normalization)', async () => {
    const transport = new McpStdioTransport({
      handler: {
        async handleToolCall(): Promise<never> {
          throw new Error('handler outage');
        },
      },
    });
    await expect(
      transport.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' })),
    ).rejects.toThrow('handler outage');
  });
});

describe('mcp-stdio wire helpers', () => {
  it('frameWireMessage terminates with a newline', () => {
    expect(frameWireMessage({ a: 1 })).toBe('{"a":1}\n');
  });

  it('parseWireRequestLine returns typed malformed verdicts', () => {
    expect(parseWireRequestLine('nope')).toEqual({ outcome: 'malformed', reason: 'not-json' });
    expect(parseWireRequestLine('"string"')).toEqual({ outcome: 'malformed', reason: 'not-an-object' });
    const parsed = parseWireRequestLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    expect(parsed.outcome).toBe('parsed');
  });

  it('parseErrorResponse carries the PARSE_ERROR code with a null id', () => {
    expect(parseErrorResponse()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'malformed MCP stdio line (not JSON)' },
    });
  });
});
