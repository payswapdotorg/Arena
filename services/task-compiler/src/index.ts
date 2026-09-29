/**
 * @arena/task-compiler-fabric — the ARENA TASK COMPILER reference fabric
 * (Work Order A008; requirement R6 "Compile Capability Cases into
 * reproducible TaskSpecs").
 *
 * The R6 BRIDGE: compile a CapabilityCase (via A005's
 * TaskCompilationTarget) under a versioned, content-addressed
 * CompilationPolicy into reproducible TaskSpec PROPOSALS.
 *
 *   - TaskCompiler (compiler.ts) — the PURE engine: same case state + same
 *     policy ⇒ byte-identical specs; fail-closed on tampered inputs;
 *   - TaskSpecRegistry (registry.ts) — in-process, append-only spec
 *     pinning: content-deduplicated, supersession by append (never
 *     rewrite);
 *   - TaskCompilerFabric (fabric.ts) — command orchestration: register
 *     cases + policies, runCompilation (idempotency key REQUIRED, lock
 *     rule 17), compilation records + events, pure queries.
 *
 * Invariants the fabric upholds:
 *   - COMPILATION NEVER MUTATES A CASE (lock rule 6): the case is read,
 *     the target is derived, specs are emitted as PROPOSALS;
 *   - SPECS ARE PROPOSALS UNTIL PINNED: pinning is an explicit registry
 *     act with append-only supersession;
 *   - CROSS-TENANT REUSE IS NEVER A COMPILATION DEFAULT (R24): every
 *     compiled spec carries dataRights.crossTenantReuse = false.
 *
 * In-process reference implementation (house style): no network, no
 * database, zero external runtime dependencies.
 */

export * from './compiler.js';
export * from './registry.js';
export * from './fabric.js';
