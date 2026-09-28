/**
 * @arena/environment-runner — the in-process REFERENCE environment
 * runner service (Work Order A010 gate 10; spec/environment.md ENV1.0;
 * docs/architecture.md §7, §16; architecture-lock rules 8, 21;
 * requirements R9, R29, R30, R33).
 *
 * Consumes job-orchestrator-style command envelopes
 * (@arena/environment-runtime schemas) and executes runs against the
 * ENV1.0 protocol types (@arena/environment-protocol): admission,
 * tenant isolation, lifecycle, deterministic seeded-LCG workload
 * simulation, time-limit enforcement, checkpoints/restore and
 * evidence-addressed RunResult production — all observable through the
 * append-only EnvironmentEventLog.
 *
 * Runtime neutrality: the reference runner SIMULATES workload
 * execution deterministically in pure TypeScript (no container or
 * namespace execution, zero external runtime dependencies); real
 * isolation runtimes ship later per deployment tier. The service
 * imports only @arena/protocol-core, @arena/environment-protocol,
 * @arena/job-protocol and @arena/environment-runtime (service →
 * domain + protocol layering; enforced by `pnpm boundary`).
 */

export * from './ports.js';
export * from './in-memory.js';
export * from './runner.js';
