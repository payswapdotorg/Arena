# tests/ux — the B017 UX/operational conformance + regression battery

Work Order B017 Milestone 2: route reachability, truth-label conformance,
truthful/actionable states, no-raw-JSON, overflow + keyboard usability
(real browser), and operational conformance (free-tier capacity,
fail-closed exhaustion, audit lifecycle) — plus the regression manifest
the TL uses at every future intake.

## How to run (self-contained runner)

```bash
pnpm build                    # produces apps/web/.next (the gate battery always does)
node tests/ux/run.mjs         # typecheck -> next start (localhost) -> vitest -> cleanup
```

The runner typechecks the battery through apps/web's typescript, serves
the built app on localhost (31318 by default; `--no-serve` runs the
composition-layer suites only), runs vitest through apps/web's vitest
with `--root ../../tests/ux` (this tree is NOT a pnpm workspace project —
the tests/security and tests/epoch-e2e precedent), and always cleans up
(POST `/demo/reset` + server stop).

**Browser layer**: the real-browser viewport checks need Playwright +
Chromium on the host, resolved through `ARENA_PLAYWRIGHT_MODULE` or the
global npm prefix. The repo carries no Playwright dependency (a
root-manifest/lockfile edit is forbidden for B017). Without it the
browser checks self-skip — the runner prints which layer ran — and the
static overflow analysis still holds.

## The suites

| File | What it proves |
| --- | --- |
| `route-reachability.test.ts` | Every nav affordance leads to a real, rendering route (composition + served); unknown routes 404 with the standard empty state; session surfaces fail closed (denied) without a session. |
| `truth-labels.test.ts` | Truth-label conformance per screen class: closed rendered vocabulary, distinct kinds with distinct treatments (no collapse), the evaluation three-way distinction + legend, the research composition-scope banner, demo labelling everywhere, the B006 label vocabulary maps onto closed kinds. |
| `states.test.ts` | Empty/loading/error states are truthful and actionable: fail-closed gates for every session surface; honest empties over an empty control plane (nothing fabricated, no-data SLOs never green, actionable next steps). |
| `no-raw-json.test.ts` | No raw JSON payload rendering on any page (entity-aware scan; the labelled corpus-hash digest display is the single documented, count-bounded exception). |
| `viewport.test.ts` | Overflow + keyboard usability: static CSS analysis (minmax grids, no wide fixed widths, breakpoints, reduced-motion) plus REAL headless-Chromium measurement at 390x844 and 1280x800 with per-element offender naming, responsive zone switching and Tab-reachability. Carries the UX-VIEWPORT-01 known-defect tripwire (see below). |
| `operational.test.ts` | Operational conformance: all four FT2.0 capacity postures with visible ceilings; EXHAUSTED/DISABLED as fail-closed REFUSAL (no billable fallback, typed B002 guard); the verified append-only audit chain recording lifecycle hops; job lifecycle transition histories. |
| `manifest.json` | The regression manifest: every check mapped to the surface that OWNS the behavior it asserts — the TL's intake companion. |

## UX-VIEWPORT-01 (the honest defect record)

This battery discovered a systemic mobile-only overflow: every
demo-surface data table overflows the 390px viewport because its
`role="region"` scroll wrapper class never sets `overflow-x: auto`
(affected: bodies 741px, research 875px, evaluation 840px, operations
684/826px, capacity 472px, plus the /demo/cases demo-banner corpus-hash
line at 394px; all pages are clean at 1280x800). The owning surfaces
(`packages/ui-platform` CSS + `apps/web` table markup) are FORBIDDEN to
B017, so the defect is encoded as a **characterization tripwire**: the
battery asserts the defect's presence — keeping it machine-visible in
every future run — and fails the moment a surface is fixed, forcing the
page back into the strict no-overflow expectation. The proposed root
fix is recorded in the manifest for TL intake.
