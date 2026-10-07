/**
 * @arena/expert-session-policy-service — the Arena ENTERPRISE SESSION
 * POLICY reference service (Work Order C018; issue #124).
 *
 * Resolution OWNS, enforcement BORROWS: this service resolves an
 * EscalationRequest's policy fields + the applicable tenant PolicyPack
 * into the concrete effective policy and hands it to the C006 session
 * builder and the C007 mode guards through injected ports; it audits
 * every apply/redact/mask/deny decision on an append-only tamper-evident
 * trail; it runs the retention disposition engine (expiry sweeps,
 * expert withdrawal, customer erasure — double-spend safe with audit
 * history retained after deletion).
 */

export * from './ports.js';
export * from './fabric.js';
export * from './service.js';
export * from './test-support.js';
