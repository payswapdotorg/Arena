# @arena/product-flows

Guided product workflows for Arena (Work Order B008; issue #80).

## What this package owns

- **Guided-flow definitions** (`src/definitions.ts`): the ordered,
  versioned, FROZEN steps of the capability-development guided flow
  (start case → frame capability gap → compose task → run → observe →
  evaluate → decide), each bound to the canonical A005 Capability Case
  lifecycle states it is valid from/to.
- **Flow runtime** (`src/runtime.ts`): applies ONLY canonical lifecycle
  transitions (`@arena/capability-case` pure functions) through the B002
  `ControlPlaneRepository` port (the in-memory fake is the local/demo
  posture). Optimistic-concurrency updates; canonical typed lifecycle
  rejections propagate verbatim; no clock, no randomness, no state.
- **Record codecs** (`src/case-codec.ts`): the tenant-qualified recordId
  scheme (`case.<tenant>.<caseId>` / `task.<tenant>.<taskId>`) and the
  fail-closed payload codecs (structural guard + digest verification).

## Product truths honored here

- Lifecycle transitions are canonical (A005) or rejected — never invented.
- No parallel lifecycle, no parallel store, no second authority.
- Evaluation ≠ verification; evidence is append-only; unknown never guessed.
- Determinism: every timestamp, id and actor is injected by the caller.

## Non-goals

- UI composition (apps/web/src/capability), route mounts, session boundaries.
- Hosted write adapters (B-series scope boundary: local/demo posture only).
