/**
 * @arena/capability-improvement-service — the Arena capability-improvement
 * REFERENCE SERVICE (Work Order C008; issue #115).
 *
 * The staged candidate pipeline from one paid intervention to reusable
 * capability: consumes C007 completed-intervention outputs through the
 * injected InterventionOutcomePort (the EES1.0 session submission
 * vocabulary — tool-gap signals, four-tier knowledge artifacts,
 * consent/rights statements), captures staged ToolGapSignalRecords and
 * LatticeKnowledgeRecords on append-only content-dedup ledgers, triages
 * signals through the closed stage machine onto the EES1.0 feed
 * destinations (tool specification proposal → adapter request | body
 * improvement candidate | benchmark candidate | marketplace artifact
 * candidate), promotes knowledge explicitly through the
 * no-silent-promotion wall, and emits KnowledgePatches to the A019/A020
 * learning surfaces as CANDIDATES ONLY. Every capture-to-disposition
 * decision is append-only audited with a tamper-evident chain.
 */

export * from './errors.js';
export * from './ports.js';
export * from './fabric.js';
export * from './service.js';
