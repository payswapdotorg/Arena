/**
 * MCP stdio transport binding (Work Order C001; ES1.0 "API surfaces" —
 * MCP tool interface). The MCP TOOL SEMANTICS live in
 * services/escalation-api's McpToolServer (MCP is a surface, not a new
 * semantic authority); this adapter owns ONLY the wire transport
 * (newline-delimited JSON-RPC 2.0 framing over stdio) — architecture-lock
 * rule 10: transports never live in domain or service packages, and
 * boundary rule B4: adapters never import services.
 *
 * The handler below is a PURELY STRUCTURAL port satisfied by
 * McpToolServer (asserted at compile time in
 * services/escalation-api/src/wiring.test.ts):
 *
 *   host wires:   new McpStdioTransport({ handler: mcpToolServer })
 *
 * Framing contract (deterministic, fail-closed):
 *   - each stdio line carries exactly one JSON-RPC 2.0 request;
 *   - blank/whitespace lines are skipped;
 *   - unparseable JSON answers with PARSE_ERROR (id null) and never
 *     crashes the stream;
 *   - responses are returned framed (one `\n`-terminated JSON string
 *     each) so the host writes them to stdout without owning framing.
 */

/** Wire shape of one MCP tool call (JSON-RPC 2.0). */
export interface McpToolCallWireRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: { readonly name?: string; readonly arguments?: Record<string, unknown> };
}

/** Wire shape of one MCP tool call response (JSON-RPC 2.0). */
export interface McpToolCallWireResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: { readonly content?: unknown };
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

/**
 * The tool handler port (structural mirror of McpToolServer.handleToolCall
 * — the service class satisfies this without any import in this package).
 */
export interface McpToolHandler {
  handleToolCall(request: McpToolCallWireRequest): Promise<McpToolCallWireResponse>;
}

/** JSON-RPC 2.0 error codes used by the transport layer itself. */
export const MCP_TRANSPORT_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
} as const);

export interface McpStdioTransportConfig {
  readonly handler: McpToolHandler;
}

/** Parse one wire line (fail-closed, machine-readable verdict). */
export function parseWireRequestLine(line: string):
  | { readonly outcome: 'parsed'; readonly request: McpToolCallWireRequest }
  | { readonly outcome: 'malformed'; readonly reason: 'not-json' | 'not-an-object' } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { outcome: 'malformed', reason: 'not-json' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { outcome: 'malformed', reason: 'not-an-object' };
  }
  return { outcome: 'parsed', request: value as McpToolCallWireRequest };
}

/** Frame one response as a stdio line (JSON + `\n`). */
export function frameWireMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

/** PARSE_ERROR wire response for unparseable input. */
export function parseErrorResponse(): McpToolCallWireResponse {
  return {
    jsonrpc: '2.0',
    id: null,
    error: { code: MCP_TRANSPORT_ERROR_CODES.PARSE_ERROR, message: 'malformed MCP stdio line (not JSON)' },
  };
}

/**
 * The MCP stdio transport binding. Chunk- and line-safe: hosts push
 * arbitrary stdio chunks (which may split or join lines) and write the
 * returned framed responses to stdout in order.
 */
export class McpStdioTransport {
  readonly handler: McpToolHandler;
  #buffer = '';

  constructor(config: McpStdioTransportConfig) {
    if (typeof config.handler?.handleToolCall !== 'function') {
      throw new Error('McpStdioTransport requires an MCP tool handler');
    }
    this.handler = config.handler;
  }

  /** Handle ONE complete stdio line. Returns null for skipped lines. */
  async handleLine(line: string): Promise<string | null> {
    if (line.trim().length === 0) return null;
    const parsed = parseWireRequestLine(line);
    if (parsed.outcome === 'malformed') {
      return frameWireMessage(parseErrorResponse());
    }
    const response = await this.handler.handleToolCall(parsed.request);
    return frameWireMessage(response);
  }

  /**
   * Handle one arbitrary stdio chunk: buffers partial lines internally
   * and returns the framed responses for every COMPLETE line it closed.
   */
  async handleChunk(chunk: string): Promise<string[]> {
    this.#buffer += chunk;
    const responses: string[] = [];
    let newlineIndex = this.#buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      const framed = await this.handleLine(line);
      if (framed !== null) responses.push(framed);
      newlineIndex = this.#buffer.indexOf('\n');
    }
    return responses;
  }

  /**
   * Flush a trailing unterminated line (end of stream). An empty buffer
   * yields no responses; a non-empty buffer is processed as one final
   * line — fail-closed, never silently dropped.
   */
  async flush(): Promise<string[]> {
    if (this.#buffer.length === 0) return [];
    const remainder = this.#buffer;
    this.#buffer = '';
    const framed = await this.handleLine(remainder);
    return framed === null ? [] : [framed];
  }
}
