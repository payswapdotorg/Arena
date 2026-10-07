# examples/generic-ai-client — the C019 generic AI application reference client

One provider-neutral, third-party-shaped client drives the COMPLETE
escalation loop (docs/LLM-ARCHITECT-FINAL-HANDOFF.md §15, the §16
Accra-house BOQ vertical) through Arena's PUBLIC contracts ONLY — the
FINAL-HANDOFF §15 closure proof for the C-series:

```
third-party AI application
→ register/authorize (C017 developer key + client app + webhook endpoint)
→ POST /v1/escalations (C001 — durable request id, idempotency + correlation)
→ idempotent status polling + SIGNED webhook consumption (verify + dedupe)
→ capability demand → qualified expert match (expert-kwame)
→ bounded expert session (C006 — privacy-sanitized replica capsule)
→ intervention (C007 — SOLVE/UNBLOCK, permitted-actions allowlist)
→ validation (recorded verdict)
→ typed structured result (ES1.0 result taxonomy)
→ payment + Arena fee (C010 — hold/offer/acceptance/capture/release)
→ optional learning artifacts (consent-gated)
→ the application applies the result through its OWN authority and
  resumes its authoritative workflow (the reference-flow boundary law)
→ bounded-session replay (observational, visibly labelled)
```

`src/epoch-loop.ts` drives the SAME §15 loop for Epoch — the EPI1.0
reference integrator — through `adapters/epoch-escalation` (trigger →
ES1.0 request → public API → signed webhook consumption → READ-ONLY
typed delivery projection → own-authority application → write-back
attempts fail closed).

Every stage composes the REAL merged C-era seams (C001 escalation
API/adapters, C006 expert-session, C007 intervention, C010 payments,
C017 developer-platform) — no live model calls, no randomness, no clock
reads: the whole loop is byte-reproducible (see `src/*.test.ts`).

## Running

This project is NOT a pnpm workspace project (the workspace root does
not include `examples/*` — adding it would be a root-manifest edit,
which C019 must not make; the `examples/epoch-e2e` A027 precedent). It
carries its own lockfile and `node_modules`:

```bash
cd examples/generic-ai-client
pnpm install
pnpm run test          # walkthrough + Epoch loop + adversarial battery (11 tests)
pnpm run typecheck
pnpm run lint
pnpm run build         # tsc --noEmit (the example ships types, not artifacts)
```

Workspace package imports (`@arena/escalation`, `@arena/expert-session`,
`@arena/payments-service`, `@arena/developer-platform`, …) resolve
through vitest/tsconfig aliases to the REAL TypeScript sources — the
same sources the workspace exports maps point at — so the walkthroughs
exercise the REAL protocol code end-to-end.

## Layout

- `src/client.ts` — the generic AI application client (public contracts
  only: REST transport port, signed-webhook verification + event-id
  dedupe, own-authority result application).
- `src/fabric.ts` — the reference Arena fabric wired from the real C-era
  seams (escalation API + signed webhook delivery + payments +
  developer platform); deterministic fixed clock, in-process transport.
- `src/arena-side.ts` — the shared Arena-side §15 lifecycle driver
  (session → intervention → validation → result → payment → close).
- `src/loop.ts` — `runBoqEscalationLoop()`: the deterministic §15/§16
  BOQ walkthrough for the generic client.
- `src/epoch-loop.ts` — `runEpochEscalationLoop()`: the same loop for
  Epoch through the epoch-escalation adapter.
- `src/walkthrough.test.ts` / `src/epoch-loop.test.ts` /
  `src/adversarial.test.ts` — the full-loop + adversarial battery
  (cross-tenant access, webhook signature forgery, idempotency-key
  conflict/replay, live-world write-back denial, unpermitted expert
  actions, Epoch posture/tenant mismatch).
