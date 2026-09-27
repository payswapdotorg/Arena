# @arena/job-orchestrator

Arena durable-job orchestration service skeleton (Work Order **A015**, gate 8).

A **deterministic in-process state machine** over [`@arena/job-protocol`](../../packages/job-protocol)
with **pluggable persistence via injected ports**. Zero external infrastructure:
no Redis, no Kafka, no Postgres, no new runtime dependencies. The only imports
are `@arena/job-protocol` and `@arena/protocol-core` (service → domain +
protocol layering, enforced by `pnpm boundary`).

## Ports (gate 8)

| Port | Purpose |
|---|---|
| `Clock` | Injected time (epoch ms). The engine NEVER sleeps and never reads a wall clock — retry backoff and timeouts are pure data compared against the clock (architecture-lock rule 17). `ManualClock` (deterministic) and `SystemClock` ship in-repo. |
| `JobStore` | Persistence port for job records, including the idempotency-submission index (lock rule 17) and both addressability lookups (job id, correlation id). `InMemoryJobStore` ships for tests. |
| `EventSink` | Append port for domain-event envelopes and the tamper-evident audit chain. `InMemoryEventSink` ships for tests; it enforces the protocol's per-job event ordering (gap/duplicate/out-of-order rejection) and the sha256 audit chain at the persistence boundary. |

## API

```ts
const orchestrator = new JobOrchestrator({ clock, store, sink });

await orchestrator.submit({ definition, input, correlationId, idempotencyKey, actor });
await orchestrator.claim({ jobId, actor });
await orchestrator.progress({ jobId, percent: 50, actor });
await orchestrator.complete({ jobId, result, actor });
await orchestrator.fail({ jobId, errorClass: 'transient', message, actor });
await orchestrator.cancel({ jobId, reason, actor });
await orchestrator.retryDue();      // pure query: retries whose backoff elapsed
await orchestrator.timeoutDue();    // sweep: mark past-deadline attempts timed-out
await orchestrator.get(jobId);
await orchestrator.findByCorrelationId(correlationId);
```

## Determinism

Every method's decision logic is pure: given the same clock reading, store
state, sink state and envelope-id source, the same inputs produce the same
results. The property suite (src/property.test.ts) drives whole runs with a
seeded in-file LCG and an LCG-backed envelope-id factory and asserts
byte-identical outcomes across repeated runs.

## Authority boundary (architecture-lock rule 16)

The orchestrator **owns orchestration, and nothing else**:

| Responsibility | Owner |
|---|---|
| Lifecycle state machine (queued → running → terminal) | `@arena/job-protocol` (pure transitions); the orchestrator drives them |
| Idempotent submission dedup (`(scope, key, correlation)` + definition digest) | orchestrator (via the protocol's resolution rule) |
| Retry / timeout scheduling | the definition's declared policies (pure data); the orchestrator applies them |
| Event emission + audit chain | protocol constructors; the orchestrator sequences them |
| **Domain outcome judgment** | **NOT the orchestrator** — `complete()` records executor-reported results verbatim |
| **Input-schema validation** | **NOT the orchestrator** — the definition only references the schema; validation authority stays with the domain that owns it |
| **Authorization** | **NOT the orchestrator** — actors are recorded in audit events, never verified |

Services communicate only through versioned contracts (spec/service-boundaries.md);
this service never imports another service.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (golden paths, retry/timeout simulation, determinism)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```
