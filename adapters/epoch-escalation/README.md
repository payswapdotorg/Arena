# @arena/epoch-escalation-adapter

The Epoch escalation **reference adapter** (Work Order C019; issue #125).

Epoch is a **reference customer** of the generic Arena Escalation API
(architecture-lock rule 36), never a special semantic authority inside
Arena. This adapter proves both directions of that mapping through
Arena's **public contracts only**:

```
Epoch capability-failure / uncertainty event (EPI1.0 async envelope)
  → EpochEscalationTrigger (closed shape, fail-closed)
  → EpochIntegrationPosture (the declared session/privacy posture)
  → [adapter] → the REAL ES1.0 EscalationRequest (@arena/escalation)
  → Arena Escalation API (POST /v1/escalations — services/escalation-api)
  → lifecycle → typed result → payment/fee
  → [adapter] → EpochEscalationDelivery (READ-ONLY projection)
  → Epoch applies the result through its OWN authority
```

## What it provides

- **`parseEpochEscalationTrigger`** — closed-shape, fail-closed parsing of
  Epoch-side escalation triggers carrying the EPI1.0 asynchronous
  contract: job id, correlation id, causation id, idempotency key,
  artifact digests, authorization metadata, explicit lifecycle.
- **`parseEpochIntegrationPosture`** — Epoch's declared integration
  posture (authorization identity + environment-session / privacy /
  learning / retention policy), which feeds the ES1.0 request.
- **`buildEscalationRequest` / `EpochEscalationAdapter`** — the mapping
  onto the REAL `@arena/escalation` request constructor (never
  reimplemented); authorization mismatch is a typed
  `AUTHORIZATION_MISMATCH` rejection.
- **`epochDeliveryFromRecord` / `epochDeliveryFromEvent`** — the
  Arena → Epoch delivery projection: typed result taxonomy, evidence
  refs, validation status, cost/fee fields, learning-artifact refs
  **only where the request authorized reuse**. Deep-frozen, read-only.
- **`consumeEpochWebhook`** — signed webhook consumption (HMAC-SHA256
  over `<timestamp>.<payload>`, `v1=` scheme) with event-id dedupe and
  tenant checks; machine-readable verdicts.
- **`attemptEpochAuthoritativeWrite`** — the fail-closed denial surface
  proving the authority boundary: **no** World-Model mutation, **no**
  Action-Gateway execution, **no** constraint/baseline/delivery-state
  alteration (EPI1.0 "Authority"; lock rules 13-15). Write-backs are
  structurally unrepresentable — the public surface accepts no Epoch
  store handles anywhere.

## Deviations / derivation notes (honesty)

EPI1.0 specifies the **capability-development** request shape, not an
escalation request. The escalation mapping is **derived** from ES1.0 +
lock rule 36 and recorded as open architecture questions in the C019 PR.

## Run

```bash
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build
```

The full-loop E2E proof (Epoch client + generic AI client over the
reference fabric) lives in `examples/generic-ai-client`.
