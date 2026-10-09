/**
 * services/escalation-api/src/mcp-host — the P003 MCP-over-HTTP tool layer
 * (Work Order P003; issue #155; ADR-P001-08 rule 1: one authority, two
 * transports).
 *
 * Mirrors the C001 MCP tool semantics (../mcp.ts — McpToolServer) over the
 * SAME `HostEscalationsTransport` surface the REST host serves: same tool
 * names, same input schemas, same response shapes, same typed error
 * taxonomy (parity pinned by tests/api-host). Mounted at POST /mcp by the
 * http-host listener; the C001 stdio framing
 * (adapters/escalation McpStdioTransport) remains its own wire binding.
 */
