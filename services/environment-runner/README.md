# @arena/environment-runner

The in-process **reference environment runner** service (Work Order **A010** gate 10; requirements R9, R29, R30, R33).

A deterministic, seeded-LCG state machine over [`@arena/environment-runtime`](../../packages/environment-runtime) with pluggable persistence via injected ports. **Zero external runtime dependencies; no container or namespace execution** — workload execution is SIMULATED deterministically in pure TypeScript (like `adapters/models`' reference adapters). Real isolation runtimes ship later per deployment tier. The only imports are `@arena/protocol-core`, `@arena/environment-protocol`, `@arena/job-protocol` and `@arena/environment-runtime` (service → domain + protocol layering, enforced by `pnpm boundary`).

## What it does

| Capability | How |
|---|---|
| Command envelopes (lock rule 17) | Consumes job-orchestrator-style `Envelope<command>` payloads (environment-runtime schemas) with REQUIRED idempotency keys; idempotent submission dedup reuses A015's `toJobSubmissionIdentity` / `jobSubmissionKey`. |
| Admission (R30) | `submitRun` proves the run's isolation envelope fits the target A009 EnvironmentDefinition's bounds; violations are logged as `admission-decided` events and rejected with typed `ADMISSION_REJECTED` errors. |
| Tenant isolation (R29) | Run ids are tenant-scoped (`<tenant>/<run-key>`); every command's tenant is checked against the run's owner — cross-tenant references fail closed. |
| Lifecycle (R9) | Drives the pure FSM `requested → provisioning → ready → running → (checkpointing → running)* → completed \| failed \| timed-out → cleaned`, emitting every transition as an enveloped, idempotency-keyed event. |
| Deterministic simulation | Seeded LCG derives every workload step's duration from (seed, step) — never `Math.random`; the same inputs always produce the same trajectory. |
| Time limits (lock rule 8) | Cumulative simulated elapsed vs the environment's declared wall clock — exhaustion transitions the run to `timed-out`. |
| Checkpoints / restore | Content-addressed snapshots of the simulated world; restore validates the ref chain (foreign-run checkpoints rejected). |
| Evidence (R9) | Completed runs produce a content-addressed `RunResult` binding A009's `RunAddress` (trajectory digest + evidence digests). |
| Observability (R33) | Everything lands in the append-only `EnvironmentEventLog`, queryable by run / tenant / state. |

## Ports (gate 10)

| Port | Purpose |
|---|---|
| `Clock` | Injected time (epoch ms). The engine never sleeps and never reads a wall clock. `ManualClock` (deterministic) and `SystemClock` ship in-repo. |
| `EnvironmentRegistry` | Registered, content-addressed environment definitions (A009) keyed by digest. |
| `RunRecordStore` | Persistence for run submissions (record + task-version context) with the idempotent submission index. |
| `EventSink` | Append port for the `EnvironmentEventLog` (per-run ordering enforced by the protocol's log). |

In-memory implementations ship in `src/in-memory.ts` for tests and the demo.

## API

```ts
const runner = new EnvironmentRunner({ clock, environments, records, sink });

await runner.registerEnvironment(definition);               // A009 EnvironmentDefinition
await runner.submitRun(submitCommand);                      // declare + admit (idempotent)
await runner.startRun(startCommand);                        // requested → … → running
await runner.advanceRun(advanceCommand);                    // one deterministic step (or timed-out)
await runner.checkpointRun(checkpointCommand);              // running → checkpointing → running
await runner.restoreRun(restoreCommand);                    // reset to a recorded checkpoint
await runner.completeRun(completeCommand);                  // → completed + RunResult
await runner.failRun(failCommand);                          // → failed
await runner.cleanupRun(cleanupCommand);                    // → cleaned
await runner.getRun(runId, tenantId);                       // tenant-scoped lookup
await runner.eventLog();                                    // the append-only log
```

Command envelopes are built with `@arena/environment-runtime`'s `makeSubmitRunCommand`, `makeStartRunCommand`, … (all require idempotency keys).

## Demo

```bash
pnpm demo    # or: node main.mjs
```

`main.mjs` drives a full deterministic run (register → submit → start → advance ×3 → checkpoint → advance → restore → complete → cleanup), two negative probes (over-quota admission, cross-tenant reference) and dumps the whole event log. It self-bootstraps `node --experimental-strip-types` plus a 20-line `.js`→`.ts` resolve hook (`ts-source-hooks.mjs`) so the real workspace packages run straight from their TypeScript sources — no build step, zero new dependencies.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
