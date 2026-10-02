# tests/product-e2e — the B017 full-product E2E battery

Work Order B017 Milestone 1: the product end-to-end suite over the REAL
web-app composition — the canonical lifecycle walk, the four-role
role-switch simulation, determinism + B016 seed parity, and the
served-app HTTP walk.

## How to run (self-contained runner)

```bash
pnpm build                      # produces apps/web/.next (the gate battery always does)
node tests/product-e2e/run.mjs  # typecheck → next start (localhost) → vitest → cleanup
```

The runner:

1. **typechecks** the battery through apps/web's typescript
   (`tsc --noEmit -p tests/product-e2e/tsconfig.json`);
2. **serves** the built app (`next start -p 31317`, localhost only) when
   `apps/web/.next` exists — pass `--no-serve` to run only the
   composition-layer suites (the served-walk suite then self-skips);
3. **runs** the battery through apps/web's vitest with
   `--root ../../tests/product-e2e` (this tree is NOT a pnpm workspace
   project — the tests/security and tests/epoch-e2e precedent — so no
   root manifest or config edit is needed);
4. **cleans up**: POST `/demo/reset` (corpus reseed) and stops the
   server. The server process restart IS the total demo-state reset
   (guided-walk writes outside the corpus persist across `/demo/reset`
   by design — see the served-walk suite's reset-semantics test).

Deterministic: frozen B006 corpus, injected fixed timestamps on the
product-flows runtime, no network beyond localhost, no wall-clock in any
assertion (byte-identity is asserted only for the frozen corpus
surfaces).

## The suites

| File | What it proves |
| --- | --- |
| `lifecycle-walk.test.ts` | The backbone: a full Capability Case walked through the canonical A005 state machine via the B008 guided flow (draft → submitted → triaged → active → resolved) with legality, append-only history, Task/Environment hops, and four-role projection equality after EVERY hop; illegal transitions rejected at every state; then the read-path story walk (Task → Trajectory → Evaluation → Verification → Certification → Release) across the real surfaces with truth labels; reset restores the identical corpus hash. |
| `role-switch.test.ts` | The headline: the SAME canonical case projected through Owner, Expert, Builder and Researcher at three layers — the B003 projection contract (identity preserved, only the projection changes), the real app surfaces (cockpit, case list, case detail — same facts/record/corpus hash, different lens), and rendered markup (shared identity anchors, distinct lens content, authorization unchanged). Includes the truthful not-granted denial path. |
| `determinism.test.ts` | Two fresh runtimes → identical corpus hash (the frozen constant); every demo surface view model byte-identical across double resolution; every rendered markup byte-identical across double render; read stamps are the fixed narrative epochs (no wall-clock); B016 parity — the real `scripts/product/seed.mjs` command seeds the identical corpus (same hash summary) into a scratch local store, which is wiped afterwards. |
| `served-walk.test.ts` | The transport layer: GET the demo surfaces over HTTP from a real `next start`; the four role projections over HTTP; the full lifecycle walk through the REAL form POSTs (origin-checked, 303 redirect contract at every hop); foreign Origin → 403; illegal transition → 303 `?flowError=CAPABILITY_CASE_INVALID_TRANSITION`; `/demo/reset` semantics. Skips itself when `ARENA_E2E_BASE_URL` is absent (the runner sets it). |

## Driver

`driver/demo-boot.ts` boots the app in local/demo mode at the
composition layer — the exact seam the `/demo/*` route mounts use
(shared B006 runtime, per-surface demo contexts, canonical read path,
product-flows runtime), with a total-reset helper.
`driver/case-lens-source.ts` maps a canonical demo read into the B003
`CapabilityCaseView` projection input (the read-model-side mapper the
role-switch simulation asserts through; two declared narrative postures
are documented in the module header).
