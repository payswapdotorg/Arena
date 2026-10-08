/**
 * @arena/capability-economics-service — the Arena capability-economics
 * REFERENCE SERVICE (Work Order C016; issue #122).
 *
 * Wires the @arena/capability-economics domain core to injected source
 * ports only (boundary rule B2 — no service-to-service imports): the
 * C010 ledger read surface (the REQUIRED commercial backing — a
 * missing ledger is the typed fail-closed LEDGER_BACKING_MISSING
 * denial), the C009 validation-outcome and C015 routing-decision read
 * surfaces, the C005/expert-session effort signals, the Q1.0
 * capability-lift value source, plus the append-only record store and
 * the versioned policy store. Durable idempotent recomputation jobs
 * run over the A015 job-protocol submission identity.
 *
 * Fail-closed everywhere: an internal failure NEVER invents an
 * economics figure; absent sources are recorded as missing-input
 * reasons on the record; cross-tenant records are typed denials; demo
 * and customer economics are read through SEPARATE truth lenses.
 *
 * In-memory reference implementations live in fabric.ts; hosts wire
 * the real read surfaces behind the ports (adapters/*, never here).
 */

export * from './ports.js';
export * from './jobs.js';
export * from './service.js';
export {
  FixedClock,
  InMemoryCapabilityEconomicsJobStore,
  InMemoryCapabilityLiftValueSource,
  InMemoryEconomicsPolicyStore,
  InMemoryEconomicsRecordStore,
  InMemoryEffortSignalSource,
  InMemoryPaymentLedgerSource,
  InMemoryRoutingDecisionSource,
  InMemoryValidationOutcomeSource,
} from './fabric.js';
