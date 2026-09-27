/**
 * @arena/job-orchestrator — Arena durable-job orchestration service
 * skeleton (Work Order A015, gate 8; requirements R26, R27, R28, R33).
 *
 * A deterministic in-process state machine over @arena/job-protocol with
 * pluggable persistence: the ONLY imports are @arena/job-protocol and
 * @arena/protocol-core (service layer → domain + protocol layers,
 * enforced by the boundary checker). Zero external infrastructure and
 * zero new runtime dependencies.
 *
 * Surfaces:
 *   - JobOrchestrator      — submit / claim / progress / complete / fail /
 *                            cancel / retryDue / timeoutDue + correlation
 *                            and job-id lookups
 *   - ports                — Clock, JobStore, EventSink (inject everything)
 *   - in-memory adapters   — ManualClock, SystemClock, InMemoryJobStore,
 *                            InMemoryEventSink (shipped for tests; the
 *                            event sink enforces the protocol's per-job
 *                            ordering and audit-chain invariants)
 */

export * from './ports.js';
export * from './in-memory.js';
export * from './orchestrator.js';
