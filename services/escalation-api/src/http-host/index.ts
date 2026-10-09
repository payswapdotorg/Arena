/**
 * services/escalation-api/src/http-host — the P003 real HTTP transport
 * surface (Work Order P003; issue #155; ADR-P001-07 §4 + ADR-P001-08).
 *
 * Public surface:
 *   ports    — the structural mirrors of the frozen host surfaces
 *              (escalation transport, health, API-key auth ports)
 *   errors   — the shared transport error taxonomy (documented HTTP
 *              renderings over the existing typed code sets)
 *   auth     — the scoped API-key auth boundary (wire parsing + tenant
 *              binding; verdicts from the injected authenticator)
 *   server   — createEscalationApiHttpApp / startEscalationHttpHost (the
 *              node:http listener binding the C001 REST contracts)
 *
 * The MCP-over-HTTP tool layer lives beside this as ../mcp-host (one
 * authority, two transports — ADR-P001-08 rule 1).
 */

export * from './ports.js';
export * from './errors.js';
export * from './auth.js';
export * from './server.js';
