# @arena/capability-economics-service

Arena capability-economics reference service (Work Order C016; issue
#122).

Wires the `@arena/capability-economics` domain core to injected source
ports only (boundary rule B2 — no service-to-service imports):

- **PaymentLedgerSource** — the C010 commercial-truth read surface.
  REQUIRED for any cost figure: a missing or foreign-tenant ledger is
  the typed fail-closed `LEDGER_BACKING_MISSING` / `CROSS_TENANT`
  denial — a cost record fabricated without C010 backing is
  unrepresentable.
- **ValidationOutcomeSource** (C009) / **RoutingDecisionSource** (C015)
  / **EffortSignalSource** (C005/expert-session) / —
  **CapabilityLiftValueSource** (the Q1.0 value side): absent or broken
  sources degrade to recorded missing-input reasons on the record,
  never silent defaults into figures.
- **EconomicsRecordStore** — the append-only record history
  (supersession by append; idempotent replay).
- **EconomicsPolicyStore** — the versioned economics policy
  (supersessions only).

Serves the dimensional read models (`readAggregate` / `readAggregateValue`)
under an explicit truth lens — demo economics and customer economics
are read through SEPARATE lenses and never mix. Durable idempotent
recompute jobs run over the A015 job-protocol submission identity
(`submitRecomputeJob` / `drainRecomputeJobs`, bounded attempts,
fail-closed parking).

In-memory reference implementations live in `fabric.ts`; hosts wire the
real read surfaces behind the ports (adapters/*, never here).

## Scripts

- `pnpm run typecheck` — strict TypeScript, no emit.
- `pnpm run lint` — ESLint (root flat config).
- `pnpm run test` — Vitest integration + adversarial suite.
- `pnpm run build` — emit `dist/` via `tsconfig.build.json`.
