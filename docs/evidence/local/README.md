# G001 — Fresh-Machine / Local Product Proof and Reconciliation

**Work Order:** G001 (issue #104) · **Stage:** post-B019 Launch Integrity Closure
**Run window:** 2026-10-07 13:36–13:58 UTC · **Executor:** genuinely fresh E2B sandbox (fresh node 22.23.3 + pnpm 10.34.5 install, fresh clone, no pre-warmed state)
**Method disclosure:** delivered by direct Tech-Lead execution under worker-brain outage (all worker LLM access quota-blocked from 12:08 UTC). Every record is a verbatim output from this run.

## Verdict table (closure-spec checklist → evidence)

| Checklist item | Verdict | Evidence |
|---|---|---|
| install | PASS | `node scripts/product/install.mjs` — prereqs + workspace install + build + verify, exit 0 in 111s (install-and-build.md) |
| build | PASS | workspace build outputs verified by install; explicit `pnpm --filter @arena/web build` re-run OK (install-and-build.md) |
| start | PASS | `next start -p 3100` — Ready in 571ms (start-landing-demo.md) |
| home/landing | PASS | GET / → HTTP 200, text/html, 20879B (byte-identical to the hosted preview's 20879B landing — deterministic build) |
| Demo | PASS | GET /demo → 200 (97570B); deterministic corpus hash `4dfd1acd` verified (5 records, tenant arena-demo) |
| Demo reset | PASS | POST /demo/reset → 303 redirect contract; `product:reset --yes --reseed` wipes + reseeds to the identical hash |
| representative lifecycle | PASS | B017 product-E2E runner: 28/28 tests (role-switch 9, lifecycle-walk 9, served-walk 5, determinism 5) (lifecycle-e2e.md) |
| reference Bodies | PASS | covered by the E2E lifecycle-walk + served-walk suites against the seeded corpus (mapped in lifecycle-e2e.md) |
| role switch | PASS | `role-switch.test.ts` 9/9 |
| replay | PASS | replay routes exercised by the E2E served-walk + UX route-reachability suites (replay NEVER mutates live state — read-only assertions) |
| evaluation/certification | PASS | covered by the E2E lifecycle walk (deterministic demo lifecycle) + UX route-reachability over /evaluation |
| documented persistence behavior | PASS | seed → new command sees the same store (doctor: "healthy: 5 records, byte-identical"); reset wipes totally (persistence.md) |

## Suite summary (all fresh runs on the fresh machine)

| Suite | Result |
|---|---|
| product:install (B016) | PASS — corpus hash 4dfd1acd, "zero providers, zero credentials" |
| product:doctor (B016) | 7 pass · 1 warn (unseeded-store at that point) · 0 fail |
| test:e2e (B017) | 28/28 tests across 4 files |
| test:ux (B017) | 46/46 tests across 6 files — incl. REAL headless Chromium viewport/keyboard suite |
| test:product | 66/66 subtests |

## Files

- `install-and-build.md` — environment record + install/doctor outputs
- `start-landing-demo.md` — serve + landing/demo/reset/404 probes
- `lifecycle-e2e.md` — product E2E + UX + product runner outputs
- `persistence.md` — seed/store/persistence/reset contract
