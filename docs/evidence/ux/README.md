# G003 — Fresh-Browser UX / Product Audit and Launch Evidence Closure

**Work Order:** G003 (issue #106) · **Stage:** post-B019 Launch Integrity Closure
**Audit window:** 2026-10-07 14:02–14:15 UTC · **Target:** https://arena-preview-five.vercel.app (hosted preview)
**Method:** fresh browser profile (agent-browser headless Chromium, clean session, no prior state) —
accessibility-tree snapshots, real interactions (role-lens click), viewport emulation, keyboard walks.
**Method disclosure:** TL-direct execution under worker-brain outage (worker LLM quota-blocked from 12:08 UTC).
No product redesign performed (audit-only work order).

## Verdict table (closure-spec surfaces → verdict)

| Surface | Verdict | Evidence |
|---|---|---|
| first-run landing | PASS | clear H1 + value prop + two primary CTAs; skip-link present (landing-and-demo.md) |
| Demo | PASS | deterministic labelling: "Demo mode. Demo state is not customer state…" (quoted verbatim) |
| role switch | PASS | Demo role lenses (Owner/Agent Builder/Expert); click → `?role=expert` + heading swap to "Expert lens" |
| cases | PASS | distinct title "Capability cases — Arena" |
| expert workbench | PASS | /expert — "Assigned work" heading |
| Body Studio | PASS | /bodies — "Agent Bodies" heading |
| replay | PASS | /replay — "Run replay" + "deterministic demo replay viewer" (non-mutation labelling) |
| evaluation/certification | PASS | /evaluation — distinct title + markers |
| marketplace | PASS | /marketplace — distinct title + screenshot |
| operations | PASS | shell renders; server-side fail-closed session gating verified by the G002 harness run |
| mobile/responsive | PASS | 390x844: NO horizontal overflow (JS-measured); nav + demo + role lenses reachable (responsive-and-keyboard.md) |
| keyboard accessibility | PASS | Tab sequence: skip-link → nav items, all with visible focus (`:focus-visible` yes ×8) |
| loading/empty/error/denied states | PASS-WITH-NOTES | 404 state verified; loading/empty states covered by the B017 `states.test.ts` (10 tests) + G002 harness denial checks (states.md) |
| /tasks | **CONCERN (minor)** | renders the generic landing shell (title identical to `/`; no distinct heading) — see findings |

## Findings (classified per the closure spec)

1. **CONCERN — product UX, minor:** `/tasks` presents the landing shell rather than a distinct
   tasks surface (observed: identical title to `/`, no tasks-specific heading). Not a launch
   blocker; recorded for the backlog owners. No fix applied (audit-only WO).
2. **NOTE — documentation/evidence:** the fresh-browser audit found no comprehension, CTA,
   truth-label, role-safety, mobile or keyboard defects across the audited surfaces.

All other audited surfaces: PASS. Screenshots in `screenshots/` (6, each <135KB).
