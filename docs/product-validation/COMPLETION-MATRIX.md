# The B-series completion matrix (B017)

Every roadmap completion criterion mapped to the SPECIFIC check that
proves it, with current status honestly recorded. Check ids reference
`tests/ux/manifest.json`; suites live in `tests/product-e2e/` and
`tests/ux/` (run per `docs/product-validation/RUNBOOK.md`).

Status vocabulary: **PROVEN** (green check exists and passes today) ·
**PROVEN-BY-SIBLING** (delivered and gated by a sibling work order;
B017 re-proves only the local slice) · **PARTIAL** (a real gap exists —
named, with owner and proposed fix) · **NOT-DELIVERED** (the surface
does not exist at this base SHA).

| # | Criterion | The check that proves it | Status |
| --- | --- | --- | --- |
| 1 | Local install + deterministic demo | B016's own battery (`node scripts/product/tests/run-tests.mjs`) + **E2E-DETERMINISM-01**: frozen corpus hash constant, byte-identical double resolution/render across 13 demo surfaces, and the REAL `scripts/product/seed.mjs` command seeds the identical corpus hash into a scratch local store (app demo state ≡ B016 seed — one corpus, not two). | **PROVEN** |
| 2 | Hosted preview | B015's deploy battery (103 tests, credential-free dry run) + `deploy-preview.yml` CI workflow (merge 245059c). B017 additionally proves the local serving path (`next start` boot + 18-route served reachability, **UX-ROUTE-04** / **E2E-SERVED-01**). No live hosted instance is asserted — TL-only secret injection arrives at B019. | **PROVEN-BY-SIBLING** (B015 wiring; live hosting gated on B019) |
| 3 | Role-aware shell | `apps/web/src/app/app.test.tsx` (the B001/B007 route-mount matrix — B017 layers ON TOP of it, never replaces) + **UX-VIEWPORT-03**: real-Chromium zone switching (bottom-nav at 390, rail at 1280). | **PROVEN** |
| 4 | Multi-role switch | **E2E-ROLESWITCH-01** at three layers: the B003 projection contract (identity preserved, four distinct payloads), the real demo compositions (cockpit/case list/case detail — same facts, different lens, authorization unchanged), rendered markup (all 8 role links + `?role=` explicit query state); truthful `not-granted` denial path included. | **PROVEN** |
| 5 | Two reference Bodies | **E2E-LIFECYCLE-01** (story walk): the bodies studio renders exactly `demo.agent-body.software-engineer` (1.1.0) and `demo.agent-body.structural-engineer` (1.0.0) with lineage; the body detail renders the certified release claim scoped to `body-software-engineer@1.1.0`. | **PROVEN** |
| 6 | Full lifecycle walk | **E2E-LIFECYCLE-01**: a canonical case walked start→frame→compose→run→observe→evaluate→decide with state-machine legality at every hop (draft→submitted→triaged→active→resolved), append-only monotone history, Task hop (TaskSpec proposals traced to the case version) and Environment hop; illegal transitions typed-rejected at every state; PLUS the served HTTP walk through the REAL origin-checked form POSTs (**E2E-SERVED-01**). | **PROVEN** |
| 7 | Four-role projections | **E2E-ROLESWITCH-01** (contract layer): Owner/Expert/Builder/Researcher over ONE canonical `CapabilityCaseView` — identical canonical identity (kind/tenant/objectId/version), four distinct payloads, the RC1.0 lens questions verbatim; AND after EVERY lifecycle hop in the walk, the four-role projection invariants re-asserted (identity preserved, only the projection changes). | **PROVEN** |
| 8 | Persistence across reload | **E2E-SERVED-01**: the served walk's writes are visible on subsequent GETs across requests (page reload preserves state within the server process); **E2E-DETERMINISM-01** proves the seeded corpus re-seeds identically after reset. HONEST LIMIT: the local demo store is in-process — durability across a SERVER RESTART is the B015 hosted wiring (not composed into the app runtime at this base SHA); the process restart is the documented total reset. | **PROVEN** (reload-level; server-restart durability is B015/B019 scope) |
| 9 | Capacity visible + fail-closed | **OPS-CAPACITY-01**: all four closed FT2.0 postures (AVAILABLE/DEGRADED/EXHAUSTED/DISABLED) with visible ceilings and worst-of overall, rendered as data. **OPS-CAPACITY-02**: EXHAUSTED/DISABLED are REFUSALS — `assertCapacityUsable` throws the typed error, the board renders "fail closed" with typed reasons, unknown ceilings render as unknown (never unlimited). | **PROVEN** |
| 10 | No billable fallback | **OPS-CAPACITY-02**: `CAPACITY_EXHAUSTION_POLICY` is the literal `'fail-closed'` — the single type inhabitant; `noBillableFallback: true` rendered verbatim; no upgrade/billing escape text anywhere on the served capacity page (asserted negative). | **PROVEN** |
| 11 | Mobile/keyboard usable | **UX-VIEWPORT-02** (static CSS analysis: minmax grids, no wide fixed widths, breakpoints, reduced-motion) + **UX-VIEWPORT-03** (keyboard Tab reachability, responsive zone switching) pass; desktop 1280x800 is overflow-clean on every page. BUT **UX-VIEWPORT-01**: a systemic MOBILE-only table overflow exists on 6 demo pages (scroll wrappers lack `overflow-x: auto`) plus the /demo/cases banner hash line. Encoded as characterization tripwires; owning surfaces (packages/ui-platform CSS + apps/web table markup) are forbidden to B017. | **PARTIAL — UX-VIEWPORT-01** (desktop + keyboard PROVEN; mobile blocked on the TL applying the one-rule root fix recorded in the manifest) |
| 12 | UX regression green | The B017 batteries themselves: `tests/product-e2e` 28/28 and `tests/ux` 46/46 green at the pushed SHA (the 46 includes the UX-VIEWPORT-01 tripwires — green means "every check passes, with the one recorded defect encoded honestly", not "no defects exist"). The regression manifest maps each check to its owning surface for every future intake. | **PROVEN** (with the recorded UX-VIEWPORT-01 defect) |

## Dispatch-base discrepancies (recorded honestly)

- **B011 (replay viewer) and B013 (marketplace UX) are AUTHORIZED — NOT
  MERGED — at the dispatch base SHA `c29c359`**, although the B017
  dispatch lists them among "all MERGED" dependencies
  (`spec/PROJECT-STATE.md` frontier: B011 AUTHORIZED, B013 AUTHORIZED;
  no `apps/web/src/replay/*` exists and `/marketplace` is still the
  B001 stub). Consequences for this matrix:
  - The lifecycle walk's **Trajectory** hop is proven through the B006
    narrative steps (truth-labelled `simulation-replay`) and the
    canonical case history — not through a dedicated replay surface
    (row 6 above is proven on what exists).
  - **Marketplace** appears only as a reachable B001 stub
    (**UX-ROUTE-04**); purchase/license/entitlement UX cannot be
    validated until B013 lands.
- **The `/demo/reset` control's hint** ("Reset drops the demo
  workspace") overpromises relative to the implementation
  (`store.reset()` drops + reseeds the CORPUS records; guided-walk
  writes persist until process restart). B017 asserts the ACTUAL
  semantics (**E2E-SERVED-01**) and flags the copy for TL review.

## How to re-verify this matrix

Run the runbook (`docs/product-validation/RUNBOOK.md`) on a clean
machine; every PROVEN row above must stay green, and the two PARTIAL /
dispatch-base rows are the honest backlog the TL carries into B018.
