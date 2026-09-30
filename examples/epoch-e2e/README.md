# examples/epoch-e2e — the A027 reference end-to-end capability-gap learning slice

One deterministic function (`runEpochCapabilityGapLoop`) walks the FULL
Arena loop, driven by an EPI1.0 Epoch capability-development request
through the A026 adapter:

```
Epoch capability-gap input (failed trajectory refs + evaluation gaps)
→ A026 adapter (typed translation + async job envelope)
→ CapabilityCase provisioning + lifecycle (A005)
→ TaskSpec compilation (A008)
→ Environment provisioning + run (A009/A010 — the A028 reference sandbox)
→ Trajectory (A011 — baseline gap + intervention repair)
→ Evaluation (A012 — the SAME evaluator version on both arms)
→ Verification (A013 — green/red evidence, fail-closed on the gap)
→ Skill extraction (A019 — the learned capability artifact)
→ Learning attribution (A020 — confound discipline + capability-lift verdict)
→ Certification citation (A023 — CANDIDATE channel grant)
→ Typed Epoch response refs (A026 — the EPI1.0 output kinds)
→ A025 SDK read-back (the certification resolves through the loopback client)
```

Every stage composes the REAL reference fabrics — no live model calls,
no randomness, no clock reads: the whole loop is byte-reproducible
(see `src/walkthrough.test.ts` and the battery in `tests/epoch-e2e`).

## Running

This project is NOT a pnpm workspace project (the workspace root does
not include `examples/*` — adding it would be a root-manifest edit,
which A027 must not make). It carries its own lockfile and
`node_modules`:

```bash
cd examples/epoch-e2e
pnpm install
pnpm run test          # the walkthrough + determinism tests
pnpm run typecheck
```

## The E2E battery (`tests/epoch-e2e`)

The adversarial E2E battery lives in `tests/epoch-e2e` and is hosted
by THIS project (it has no `node_modules` of its own):

```bash
cd examples/epoch-e2e
pnpm run battery:test          # vitest run --root ../../tests/epoch-e2e
pnpm run battery:typecheck     # tsc --noEmit -p ../../tests/epoch-e2e
```

## Contracts disclosure (A027)

This example owns NO `contracts/` surface and ships no schema
generator. The wire shapes it exercises (the EPI1.0 request/response,
job envelope, output refs) are defined, validated and disclosed by the
A026 epoch adapter package (`adapters/epoch`); this slice composes
them end-to-end (the A019/A024 in-package-schema precedent).
