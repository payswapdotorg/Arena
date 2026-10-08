# @arena/capability-economics

Arena capability economics / intervention unit economics domain core
(Work Order C016; issue #122).

The economic VIEW over the escalation network — never the money truth
(C010 owns the escrow/hold ledger; fee-split formulas stay C010-owned).

- **UnitEconomicsRecord** — per-intervention, append-only,
  provenance-addressed, content-addressed records whose cost figures are
  folded ONLY out of real C010 `PaymentLedger` state (integrity-verified
  through the C010 sha256 digest chain). A cost figure with no C010
  backing is unrepresentable: there is no constructor that accepts
  free-standing amounts.
- **EconomicsPolicy** — versioned, deterministic view policies
  (small-sample thresholds, metric allow-lists, disclosure notes);
  changes are supersessions by version, never silent restatements.
- **CapabilityLiftValueRecord** — the Q1.0 value side: capability-lift
  figures gated by the five capability-lift conditions (pinned
  evaluation population, verification audit, evaluator/version
  attribution, protected-capability regression, reported uncertainty),
  with LE1.0 attribution separation — a changed evaluator score is never
  an economics gain.
- **EconomicsAggregate** — dimensional read models (capability, domain,
  tenant lens, resource class, validation outcome) disclosing formula,
  sample sizes, small-sample status and known limitations. No collapsed
  "ROI score" — score-shaped keys are typed rejections (the C005
  no-single-global-score law, mirrored).
- The truth-label law rides every record and aggregate: demo money is
  not customer money, and they never mix.
- Tenant isolation at the domain level; deterministic folds given
  identical inputs (BigInt-only arithmetic; floats never touch a figure).

Pure TypeScript. Runtime dependencies: `@arena/protocol-core` (canonical
JSON + sha256 digests) and `@arena/payments` (C010 Money primitives,
ledger fold + integrity verification — composed, never forked). Zero
service imports. The reference service lives in
`services/capability-economics`
(`@arena/capability-economics-service`).

## Scripts

- `pnpm run typecheck` — strict TypeScript, no emit.
- `pnpm run lint` — ESLint (root flat config).
- `pnpm run test` — Vitest unit + adversarial suite.
- `pnpm run build` — emit `dist/` via `tsconfig.build.json`.
