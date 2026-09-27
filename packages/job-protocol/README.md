# @arena/job-protocol

Arena durable jobs, events and audit protocol (Work Order **A015**; requirements
**R26** — asynchronous long-running jobs, **R27** — idempotent commands and
correlation ids, **R28** — audit logs for consequential mutations, **R33** —
typed job observability).

Domain package (layer: `domain`); its ONLY workspace import is
`@arena/protocol-core` (protocol layer) — never a sibling domain package.
Zero external runtime dependencies.

## Surfaces

| Surface | Purpose |
|---|---|
| `JobDefinition` | Versioned, content-addressed job blueprint (sha256 canonical digest via `digestCanonical` — never reimplemented); registry-style dedup: same definition ⇒ same digest. Carries kind id/version, input schema ref, correlation address, idempotency semantics (key scope), timeout policy, retry policy (pure data: max attempts, backoff schedule, retryable error classes), priority class, resource hints. |
| `JobRecord` | Append-only lifecycle: `queued → running → succeeded \| failed \| cancelled`. Terminal states are FINAL (every mutation after terminal throws `JOB_TERMINAL_STATE`). Each transition is a pure function returning a NEW deep-frozen record and appends one `JobEvent` to the embedded, immutable history. A failed attempt with retry budget re-queues the job behind a backoff-gated `nextRetryAt`. |
| `JobEvent` taxonomy | `job-submitted / job-started / job-progressed / job-retried / job-completed / job-failed / job-cancelled` + the generic consequential-mutation audit event `mutation-audited`. Every event travels inside `Envelope<T>` (`makeJobEventEnvelope`) carrying the job's correlation id and idempotency key. Per-job sequences are contiguous 1..n — gap, duplicate and out-of-order appends are REJECTED (embedded history, envelope-side `JobEventLog`, and strict `parseJobRecord` all enforce this). |
| `AuditLog` | Append-only, tamper-evident sha256 chain over consequential mutations: each `AuditRecord.digest` = sha256 over canonical `{payload, previousDigest, sequence}` — every audit digest INCLUDES the previous event's digest. `verifyAuditChain` fails closed (`JOB_AUDIT_CHAIN_BROKEN`) on tampered payloads/digests, removed or reordered records. |
| Idempotency & addressability | Submission identity = (idempotency scope, idempotency key, correlation id). Same identity + same definition digest ⇒ the SAME job record (idempotent hit); same identity + DIFFERENT definition digest ⇒ `JOB_IDENTITY_CONFLICT`. Jobs are addressable by job id AND by correlation id (lookups provided by the persistence port). |
| `submit-job-command` | Idempotency-keyed command envelope (`makeSubmitJobCommand`) mirroring `@arena/artifact-protocol`'s command/event envelope patterns. |

## Authority boundary (architecture-lock rule 16)

This protocol layer owns: the lifecycle state machine, content addressing,
idempotency dedup semantics, event ordering, retry/timeout policy shapes and
the audit chain. It does NOT own: domain outcome judgment (results are
recorded verbatim; the `inputSchema` is referenced, never enforced — schema
validation authority stays with the domain that owns the schema), nor
authorization (actors are recorded, not verified). Consumers orchestrate with
`services/job-orchestrator`.

## Contracts

Generated contracts live at the repository root in `contracts/events/`
(14 schemas, JSON Schema draft 2020-12, `$id`
`arena:schema/events/<name>@1.0.0`). Regenerate with:

```bash
pnpm contracts:generate   # node scripts/generate-contracts.mjs
pnpm contracts:check      # --check drift gate (also run by governance G9 and src/drift.test.ts)
```

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative + property tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

See `docs/repo-layout.md` for the layering rules this package must obey
(enforced by `pnpm boundary`).
