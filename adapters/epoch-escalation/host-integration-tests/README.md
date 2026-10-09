# adapters/epoch-escalation/host-integration-tests — the P006 Epoch-adapter host-integration battery

Work Order **P006** (issue #158) · ADR-P001-08: **Epoch consumes through
`adapters/epoch-escalation` over the PUBLIC transport — there is no
Epoch-specific Arena API, and none is used here.**

## What this battery is

The Epoch-side surface of the P006 integrated acceptance: the REAL Epoch
adapter (`../src` — the C019 public surface) driven through the SAME full
§15 core flow as the generic AI application client, against the SAME
integrated deployment composition booted by the shared harness
(`tests/integration/production/support/` — **imported, not replicated**;
one composition site, two clients):

- **declared posture + wire trigger** → the adapter's closed-shape,
  fail-closed parsers → `mapTriggerToCreateInput` onto the ES1.0 create
  input (the domain construction is validated through the adapter's own
  `buildEscalationRequestFromWire` path — the REAL `@arena/escalation`
  constructor);
- **filing, polling, MCP** over the SAME public routes the generic client
  uses (`POST /v1/escalations`, `GET /v1/escalations/{id}`, `POST /mcp`)
  with a scoped developer key — plain `fetch`, never an in-process
  service reference;
- **signed webhook consumption** through the adapter's
  `consumeEpochWebhook` (HMAC-SHA256 verify, posture-tenant guard,
  per-EVENT-ID dedupe) with each consumed event projected into the
  READ-ONLY `EpochEscalationDelivery`;
- **own-authority application** of the terminal result over the adapter's
  delivery projection (Arena never writes Epoch state);
- the adapter's **fail-closed walls**: unknown trigger/posture fields,
  authorization mismatch (the cross-tenant adversarial case), forged
  signatures, correctly-signed foreign-tenant events, and the typed
  `WRITEBACK_FORBIDDEN` denial for every Epoch authoritative store.

The **identical public flow** acceptance rides the shared driver
(`tests/integration/production/support/public-flow.ts`): the same §15
loop, the same public assertions, the same normalized receipt. The
generic client's twin run and the machine-checked receipt equality live
in `tests/integration/production/identical-flow.e2e.test.ts`.

## How to run

This subtree is **not** a pnpm workspace project and **not** part of the
adapter package's own `vitest run` (its frozen config includes `src/**`
only). Two equivalent entry points:

```bash
node adapters/epoch-escalation/host-integration-tests/run.mjs   # this battery alone
node tests/integration/production/run.mjs                       # the FULL integrated battery (both clients)
```

Both runners drive `services/runtime-host`'s typescript + vitest (the
workspace package that owns the `@electric-sql/pglite` pin — the
embedded real PostgreSQL 17 engine the shared harness composes).

## Evidence class

Engine class per run: **embedded-postgres → AUTOMATED-TEST-ONLY** per
`spec/post-roadmap-release-gate.md` §3 (a real database ENGINE embedded in
the test process — not a live hosted deployment; the optional live-Neon
path is env-gated in the battery's composition suite). Truth lens
`customer` (ADR-P001-02). The payment step runs the DEMO provider
(`executesCustomerMoney=false` — CI moves no real money). Fresh
transcripts land in `docs/evidence/production/integration/`.
