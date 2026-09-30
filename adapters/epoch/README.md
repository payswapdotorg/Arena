# @arena/epoch-adapter

The provider-neutral **Epoch capability-development adapter** (Work Order
A026; `spec/epoch-integration.md` contract **EPI1.0**; the Epoch
CONSUMPTION stage of the Arena loop).

## What this is

A workspace package under `adapters/epoch/` that bridges Epoch
capability-development requests to Arena's public surface —
provider-neutral (no Epoch SDK, no provider brand names), fail-closed,
and structurally barred from Epoch authority.

```
Epoch detects capability failure
→ capability-development request
→ [this adapter] Arena Capability Case (A005 constructor)
→ [this adapter] typed command envelope → Arena write surface
→ task/environment/expert work → evaluation/verification/learning
→ Body/substrate certification
→ [this adapter] typed EPI1.0 output refs (content-addressed)
→ Epoch consumes the artifact via its adapter
```

## Surface

- **EPI1.0 incoming** — `toCapabilityDevelopmentRequest`: closed-shape,
  fail-closed parse of a CapabilityDevelopmentRequest carrying the
  capability-case seed, failed trajectory refs, evaluation gaps, and
  capability/domain requirements. Deep seed validation is delegated to
  the A005 constructors (`@arena/capability-case`) — never reimplemented.
- **EPI1.0 outputs** — the spec's **eleven** content-addressed Ref kinds
  (`EPOCH_OUTPUT_REF_KINDS`; the dispatch brief said "twelve" — the spec
  lists eleven and is authoritative; disclosed in the PR). `toEpochOutputRef`,
  `epochOutputRefFromCapabilityCase`, `epochOutputRefFromBodyVersion`.
- **Asynchronous job envelope** — job id, correlation id (A015),
  **causation id** (EPI1.0-mandated, defined here), idempotency key under
  the `epoch` scope, sorted-unique artifact digests, authorization
  metadata, and an explicit `queued → running → succeeded|failed|cancelled`
  lifecycle with terminal finality. Replayed identical submissions return
  the SAME job (no re-execution, no second command); a replayed
  idempotency key with different content is a conflict.
- **Arena reads** — `resolveOutputRef` resolves
  `agent-body-version` / `compatibility-report` / `certification` refs
  through the real `ArenaApiClient` (A025 `@arena/arena-sdk`);
  not-found is a value (`null`), never an error.
- **Release admission citation** — candidate/stable target channels
  require certification-backed output refs (A024
  `CHANNEL_GRANT_REQUIREMENTS`).

## Authority boundary (EPI1.0 "Arena does not")

Enforced **structurally**: no method, export, or type mutates — or even
accepts — Epoch World Model, action, constraint, baseline or delivery
state. `EPOCH_AUTHORITY_BOUNDARY` declares the six clauses; the hygiene
suite scans the public surface for forbidden mutation vocabulary and
asserts the exact method allowlist of the adapter class.

## Contracts

This package owns **no** `contracts/` surface (A026 owns
`adapters/epoch/*` only). Schemas live in-package as SchemaRef-referenced
data (`EPOCH_SCHEMAS`, namespace `epoch`) — the A019/A024 precedent. No
generator ships, so `pnpm run contracts:generate` is a no-op here.

## Limitations

- The A025 public API surface is **read-only**; provisioning commands are
  prepared as typed envelopes for the host to forward — remote execution
  awaits a future Arena write API (architecture question in the PR).
- Output refs other than the three queryable kinds resolve to `null`
  (carried validated and frozen, awaiting a future read surface).
- The job store is in-memory, single-process (the durable store is A015's
  job-orchestrator; this adapter reuses its submission-identity
  discipline, not its persistence).
