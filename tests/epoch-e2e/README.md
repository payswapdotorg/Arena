# tests/epoch-e2e — the A027 end-to-end battery

The adversarial E2E battery for the epoch capability-gap learning
slice (A027). NOT a pnpm workspace project — the workspace root does
not include `tests/*` (adding it would be a root-manifest edit, which
A027 must not make). The battery runs via the `examples/epoch-e2e`
standalone project, which owns vitest:

```bash
cd examples/epoch-e2e
pnpm run battery:test          # vitest run --root ../../tests/epoch-e2e
pnpm run battery:typecheck     # tsc --noEmit -p ../../tests/epoch-e2e
```

Coverage:

- `full-loop.test.ts` — positive full-loop runs (the typed artifacts at
  every stage: job envelope, case, task spec, run, trajectories,
  evaluation, verification, skill draft, learning verdict,
  certification, the EPI1.0 response refs, the A025 read-back) and the
  regression pins (byte-determinism of the digest map; the exact
  response kind multiset).
- `adversarial.test.ts` — gap input validation failures (unknown
  fields, forged digests, missing idempotency keys, cross-tenant
  authorization), job-envelope discipline (idempotency-key rebinding,
  case-ref duplication, cross-kind digest collisions, terminal
  finality), fabric ref mismatches (evaluator input contracts, the
  A019 trajectory-verification binding), attribution confounds (the
  A020 evaluator-version confound forces
  `inconclusive-unless-controlled`), and the certification gates (the
  A024 candidate-channel grant requirement; gap evidence never
  certifies).
