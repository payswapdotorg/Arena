/**
 * @arena/runtime-host-service — the durable host runtime core
 * (Work Order P002; issue #154; ADR-P001-01/02/07).
 *
 * Public surface:
 *   durable — the durable port implementations over the Neon/Postgres
 *             SqlTransport seam (escalation store + webhook outbox +
 *             idempotency outcomes + job store + event sink/audit chain +
 *             projection checkpoints) + createDurableRuntimeComponents
 *             (the full shared component set over ONE transport)
 *   host    — createRuntimeHost (the REAL RuntimeHostApi: lifecycle,
 *             health/readiness, tenant-gated + lens-stamped escalation
 *             surface, the registered job kinds with host claiming
 *             semantics, recorded outcomes, restart recovery). The
 *             composed SERVICE engines are INJECTED through the frozen
 *             package's structural surfaces (boundary law B2: a service
 *             never imports another service); deploy/runtime/src/
 *             composition.ts is the production composition site and
 *             tests/runtime-host pins the real-class parity.
 *
 * The nested neon-postgres adapter is composed through the tsconfig/
 * vitest path alias (the TL-flagged nested-adapter glob-gap precedent
 * from deploy/src/hosted).
 *
 * TEST-ONLY fabric stays private to this package and is deliberately
 * NOT exported here (the A033 hygiene precedent):
 *   ./memory-transport.ts — the in-memory reference SqlTransport
 *   ./test-support.ts     — the reference escalation/job engines
 */

export * from './durable.js';
export * from './host.js';
