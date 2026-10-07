# @arena/escalation

Arena expert escalation **domain core** — Work Order **C001** (issue #75),
implementing `spec/expert-escalation-api.md` **ES1.0**, the canonical spec
for the provider-neutral escalation integration boundary.

Pure TypeScript domain package. The ONLY workspace dependency is
`@arena/protocol-core` (canonical JSON, sha256 digests, `Envelope<T>`,
branded identifiers, `SchemaRef`) — never reimplemented here.

## Surface

| Module | Delivers |
| --- | --- |
| `request.ts` | `EscalationRequest` — the ES1.0 primary object with every minimum field (request/client/tenant ids, source refs, capability need, modes, urgency, deadline, budget/currency, expert requirements, locale, desired output schema, context references, environment-session policy, privacy policy, permitted actions, learning permissions, retention policy, idempotency key, correlation ID), strict fail-closed construction and a content-addressed sha256 digest. |
| `lifecycle.ts` | The durable state machine `CREATED → TRIAGED → MATCHING → OFFERED → ACCEPTED → SESSION_READY → IN_PROGRESS → SUBMITTED → VALIDATING → ACCEPTED \| REVISION_REQUIRED \| REJECTED → PAID → LEARNING_CAPTURED → CLOSED` with **explicit** `TIMED_OUT`, `CANCELLED` and `EXPERT_REPLACED` states; machine-readable transition verdicts (closed reason vocabulary — never a bare boolean); append-only, contiguous, frozen state history; terminal states final; injected timestamps only. |
| `results.ts` | The closed 11-kind result taxonomy (Correction, Unblock, Answer, Decision, Solution, Review, EvidenceBundle, KnowledgePatch, ToolGapSignal, EvaluationVerdict, LearningArtifactRef) with per-kind required fields. |
| `idempotency.ts` | The `(tenant, idempotency key, correlation id)` submission identity: duplicates **replay** the original request; conflicting key+body is a typed `ESCALATION_IDENTITY_CONFLICT` rejection. |
| `events.ts` | The closed 13-event webhook vocabulary (ES1.0 minimum) as a pure projection of the lifecycle; `eventId` is the idempotent consumer key. |
| `envelopes.ts` | Wire wiring: `create-escalation-command` (command kind, REQUIRED idempotency key), `get-escalation-status-query` (query kind, NULL key), `escalation-response`, `escalation-webhook-event` — all in the `escalation` SchemaRef namespace. |
| `errors.ts` | Typed `EscalationError` taxonomy (closed codes/categories, wire-safe, strict parsing). |
| `shared.ts` | Branded ids, canonical ms-UTC timestamps, closed vocabularies (modes, urgencies), deep-freeze helpers. |

Tenant isolation is enforced at the DOMAIN level: every transition context
may carry an expected tenant; mismatches are typed
`ESCALATION_CROSS_TENANT_ACCESS` failures.

## Contracts

Generated contracts live in `contracts/escalation/` (repository root) via
`pnpm run contracts:generate` (this package's
`scripts/generate-contracts.mjs`). Governance check **G9** auto-discovers
the generator; drift is additionally asserted by `src/drift.test.ts` and
parity by `src/contracts.parity.test.ts`.

## Authority boundaries

- This package is the domain core ONLY — no HTTP, no delivery, no MCP
  transport (those live in `services/escalation-api` and
  `adapters/escalation`).
- The escalation API is an integration boundary, not a new semantic
  authority (ES1.0 design constraint): host applications remain
  authoritative over their own workflows and worlds.
