# Arena Launch Gate - Evidence Index

## Overview

This index maps every checklist item in the [Launch Checklist](../launch-checklist.md) to the specific artifact that provides proof of compliance. Each item is cross-referenced to the deliverable responsible for verification.

**Citation policy (B019 discipline):** every path below is verified against the repository tree at the B019 base (`331d5b8`). Where the proving artifact is a launch-day *output* (a generated result log, an audit run, a deployed URL) that cannot exist before the gate itself, the row cites the REAL script/suite/record that produces it and is marked **`pending launch-day evidence`** or **`TL-owned at the launch gate`** — never a fictional path.

## Gate A - Local Install/Use

| Checklist Item | Evidence Artifact | Responsible Deliverable | Verification Method |
|---|---|---|---|
| Fresh Linux/macOS/Windows-compatible Node 22 environment can install without hidden dependencies | `scripts/product/install.mjs` (B016) — Linux-leg run log ATTACHED: `docs/evidence/production/launch/install-fresh-machine-2026-10-09.md` (fresh clone of main `04e6b61`, EXIT 0, cold 123/123 build); macOS/Windows legs `pending launch-day evidence` | `scripts/product/` | `node scripts/product/install.mjs` on a fresh machine (prereq check → install → build → verify) |
| Documented single-command developer/demo start path works | `docs/getting-started/README.md` + `docs/getting-started/local-mode.md` (B016) | `docs/getting-started/` | Manual verification + docs review |
| Fresh browser opens Arena home | `tests/ux/route-reachability.test.ts` (B017: UX-ROUTE-02/03/04) | `tests/ux/` | Served-app route walk via `node tests/ux/run.mjs` |
| Demo workspace can be entered without provider credentials | `apps/web/src/app/demo/page.tsx` + `apps/web/src/demo/runtime.ts` (B006) | `apps/web/` | `node tests/product-e2e/run.mjs` (demo surfaces over HTTP, zero credentials) |
| Demo can reset | `apps/web/src/app/demo/reset/route.ts` (B006) — reset-semantics assertions in `tests/product-e2e/served-walk.test.ts` | `apps/web/` | Served-walk `/demo/reset` contract test |
| Demo covers the full reference chain | `tests/product-e2e/lifecycle-walk.test.ts` (B017) | `tests/product-e2e/` | Full lifecycle E2E test |
| No diagnostics-only route is the default experience | `apps/web/src/app/page.tsx` (B001) | `apps/web/` | UI review + `tests/ux/route-reachability.test.ts` |

## Gate B - Hosted Preview ⭐ *Primary Focus*

| Checklist Item | Evidence Artifact | Responsible Deliverable | Verification Method |
|---|---|---|---|
| Vercel production deployment is live | `.github/workflows/deploy-preview.yml` (B015) | `deploy/` | Deployment workflow output + live `GET /` smoke check |
| Stable public URL recorded in release docs | `docs/launch/launch-day-runbook.md` (URL token `__ARENA_PREVIEW_URL__`) — the recorded URL is **`TL-owned at the launch gate`** | `docs/launch/` | TL records the URL at finalization |
| Neon database bootstraps from versioned migrations | `adapters/hosted/neon-postgres/migrations/` + `adapters/hosted/neon-postgres/src/migrations.ts` (B002) | `adapters/hosted/neon-postgres/` | Migration ledger contract test (`adapters/hosted/neon-postgres/src/adapter.contract.test.ts`) |
| R2 artifact lifecycle works | `adapters/hosted/r2-object-store/src/adapter.ts` + `adapters/hosted/r2-object-store/src/adapter.contract.test.ts` (B002) | `adapters/hosted/r2-object-store/` | R2 adapter contract test |
| Upstash Redis coordination works | `adapters/hosted/upstash-redis/src/adapter.ts` + `adapters/hosted/upstash-redis/src/adapter.contract.test.ts` (B002) | `adapters/hosted/upstash-redis/` | Redis adapter contract test (idempotency windows, locks, rate counters) |
| Optional Apify path has a dry run and is never required by the core demo | `deploy/src/hosted/apify.test.ts` + `deploy/src/hosted/dry-run.ts` (B015) | `deploy/` | Apify wiring test (absent token ⇒ disabled = PASSING) + hosted dry-run |
| Provider secrets are server-side only | `deploy/env/hosted-preview.env.example` (B015) | `deploy/` | Secret scan + review |
| Health/readiness checks are live | `deploy/preview/src/acceptance/health-checker.ts` — **real probe surface: `GET /` (2xx/3xx, deploy-workflow smoke-check parity; the product has no `/api/health` endpoint)** | `deploy/preview/` | `deploy/preview` acceptance suite, live mode (`ARENA_PREVIEW_URL`) |
| Provider capacity state is visible | `deploy/preview/src/acceptance/capacity-validator.ts` — **real probe surfaces: `GET /operations` (fail-closed session gate) + `GET /demo/operations` (capacity board: `AVAILABLE`/`DEGRADED`/`EXHAUSTED`/`DISABLED`)** | `deploy/preview/` | Page-level body assertions over the real routes |
| Free-tier exhaustion is fail-closed | `deploy/preview/src/acceptance/quota-exhaustion.ts` — **real probe surface: `GET /demo/operations` rendered exhaustion posture (`EXHAUSTED` ⇒ `fail closed` + `quota-exhausted`)** | `deploy/preview/` | Rendered-posture assertion over the real route |
| No hidden paid fallback exists | `deploy/preview/src/acceptance/fail-closed-validator.ts` — **real probe surfaces: `GET /`, `/demo`, `/operations`, `/demo/operations` page-level paid-fallback-marker scan + rendered FT2.0 contract** | `deploy/preview/` | Page-level assertions over the real routes |

## Gate C - UX

| Checklist Item | Evidence Artifact | Responsible Deliverable | Verification Method |
|---|---|---|---|
| First-run onboarding is understandable without Arena terminology | `apps/web/src/app/_lib/landing-view.tsx` (B007) | `apps/web/` | UI review + `tests/ux/route-reachability.test.ts` (UX-ROUTE-02: one primary action into `/cases`) |
| Home is a role-aware capability cockpit | `apps/web/src/cockpit/cockpit-home-view.tsx` (B007) | `apps/web/src/cockpit/` | Cockpit view tests (`cockpit-home-view.test.tsx`) + `tests/ux/truth-labels.test.ts` (UX-TRUTH-02) |
| Persistent workspace + role switcher exists | `apps/web/src/cockpit/cockpit-home-view.tsx` (B007 — workspace selector + `data-arena-role-switcher`) | `apps/web/src/cockpit/` | Cockpit view tests |
| Multi-role users can switch context without losing safe navigation state | `tests/product-e2e/role-switch.test.ts` (B017) | `tests/product-e2e/` | Role-switch simulation (identity/tenancy preserved, only the projection changes) |
| Role switching cannot change authorization | `packages/role-context/src/grants/permission.ts` (B003 tenant permission policy) + `packages/auth/src/session.ts` (B004 session authority) | `packages/role-context/` + `packages/auth/` | `tests/product-e2e/role-switch.test.ts` (authorization stays server-side across every lens) |
| Same canonical case/body/run has role-specific projections | `packages/role-context/src/projections/projection.ts` (B003) | `packages/role-context/` | `packages/role-context/src/projections/projection.test.ts` + `tests/product-e2e/role-switch.test.ts` |
| Owner flow works | `apps/web/src/capability/flow-actions.ts` (B008 guided flow) + `apps/web/src/app/cases/start/page.tsx` | `apps/web/` | `tests/product-e2e/lifecycle-walk.test.ts` (draft → submitted → triaged → active → resolved) |
| Agent Builder flow works | `apps/web/src/capability/capability-views.tsx` + `apps/web/src/capability/role-lens.ts` (B008) | `apps/web/` | `tests/product-e2e/role-switch.test.ts` (Builder lens) + `apps/web/src/capability/case-view.test.ts` |
| Expert flow works | `apps/web/src/expert/workbench.ts` + `apps/web/src/expert/expert-view.tsx` (B009) | `apps/web/src/expert/` | `apps/web/src/expert/workbench.test.ts` + `expert-view.test.tsx` |
| Researcher flow works | `apps/web/src/research/research-views.tsx` (B012) | `apps/web/src/research/` | `apps/web/src/research/research-view-model.test.ts` + `tests/ux/truth-labels.test.ts` (UX-TRUTH-07) |
| Operator flow works | `apps/web/src/operations/operations-home-view.tsx` (B014) | `apps/web/src/operations/` | `apps/web/src/operations/operations-route.test.tsx` + `tests/ux/operational.test.ts` |
| Marketplace flow works | `apps/web/src/marketplace/marketplace-home-view.tsx` (B013) | `apps/web/src/marketplace/` | `apps/web/src/marketplace/marketplace-route.test.tsx` |
| Body/Substrate/Possession distinction is visually explicit | `apps/web/src/bodies/bodies-home-view.tsx` (B010) | `apps/web/src/bodies/` | `apps/web/src/bodies/bodies-route.test.tsx` |
| Replay is visibly non-authoritative | `apps/web/src/replay/replay-home-view.tsx` (B011) | `apps/web/src/replay/` | `apps/web/src/replay/replay-route.test.tsx` + `apps/web/src/replay/state-mark.test.ts` |
| Evidence, evaluation, certification and suggestion are visually distinct | `apps/web/src/evaluation/evaluation-home-view.tsx` (B012) | `apps/web/src/evaluation/` | `tests/ux/truth-labels.test.ts` (UX-TRUTH-03: three-way distinction + truth-class legend) |
| Loading, empty, error, denied and demo states exist | `tests/ux/states.test.ts` (B017: UX-STATE-01/02) + `apps/web/src/app/loading.tsx`, `apps/web/src/app/error.tsx`, `apps/web/src/app/not-found.tsx` | `tests/ux/` + `apps/web/` | `node tests/ux/run.mjs` |
| Mobile layouts work | `apps/web/src/responsive/` (B018) + `tests/ux/viewport.test.ts` (UX-VIEWPORT-02; UX-VIEWPORT-01 is a recorded known-defect tripwire) | `apps/web/` | `node tests/ux/run.mjs` (static overflow analysis always; browser layer env-dependent) |
| Keyboard navigation works | `apps/web/src/a11y/hooks/index.tsx` (B018 focus management) + `apps/web/src/a11y/testing/a11y.test.ts` (A11Y-COMP-01) | `apps/web/src/a11y/` | A11y conformance battery |
| Reduced motion works | `apps/web/src/a11y/hooks/index.tsx` (B018 reduced-motion detection, A11Y-COMP-05) + `tests/ux/viewport.test.ts` (UX-VIEWPORT-02 reduced-motion posture) | `apps/web/src/a11y/` | A11y conformance battery + UX viewport suite |

## Gate D - Operational Conformance

| Checklist Item | Evidence Artifact | Responsible Deliverable | Verification Method |
|---|---|---|---|
| Every critical UI claim maps to a canonical object | `contracts/` (A-series) | `contracts/` | `pnpm run contracts:generate` (byte-identical) + `pnpm run check` |
| Role context is never used as an authorization decision | `packages/auth/src/session.ts` (B004 — the session record carries the workspace snapshot, carried never interpreted) | `packages/auth/` | `packages/auth/src/session.test.ts` + `tests/product-e2e/role-switch.test.ts` |
| No client-only mutation can bypass server policy | `services/api-read/src/protocol.ts` (B005 — tenancy server-controlled from the session, never from a payload) | `services/api-read/` | `services/api-read/src/service.test.ts` + `tests/product-e2e/served-walk.test.ts` (foreign Origin → 403, origin-checked POSTs) |
| Correlation/idempotency metadata is preserved | `adapters/hosted/upstash-redis/src/adapter.ts` (B002 — idempotency windows, namespaced keys, digest-conflict detection) | `adapters/hosted/upstash-redis/` | `adapters/hosted/upstash-redis/src/adapter.contract.test.ts` |
| Job/trajectory/evaluation/verification state is not faked | `services/job-orchestrator/src/orchestrator.ts` (A015 pure state machine) + `tests/ux/truth-labels.test.ts` (closed truth-badge vocabulary) | `services/job-orchestrator/` + `tests/ux/` | `services/job-orchestrator/src/orchestrator.test.ts` + truth-labels battery |
| Marketplace entitlement does not imply certification | `packages/marketplace-ui/src/certification.ts` (B013 — "a marketplace purchase is NOT a certification") + `packages/marketplace-ui/src/entitlement.ts` | `packages/marketplace-ui/` | `packages/marketplace-ui/src/certification.test.ts` + `entitlement.test.ts` |
| Certification never implies professional licensure | `packages/certification/src/hygiene.test.ts` (A-series — `licensure` is in the forbidden vocabulary) | `packages/certification/` | Certification hygiene battery |

## Gate E - Product E2E

| Checklist Item | Evidence Artifact | Responsible Deliverable | Verification Method |
|---|---|---|---|
| Capability Case creation | `tests/product-e2e/lifecycle-walk.test.ts` (B017 — guided flow draft → submitted → triaged → active → resolved) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Task compilation | `tests/product-e2e/lifecycle-walk.test.ts` (B017 — Task hop: `compose-task` stores traced TaskSpec proposals) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Environment run | `tests/product-e2e/lifecycle-walk.test.ts` (B017 — Environment hop: pinned initial environment + case requirements) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Expert intervention | `apps/web/src/expert/workbench.ts` (B009 expert workbench: case work lens, task execute/review, evidence appends) | `apps/web/src/expert/` | `apps/web/src/expert/workbench.test.ts` |
| Trajectory capture | `tests/product-e2e/lifecycle-walk.test.ts` (B017 — read-path story walk: Task → Trajectory → …) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Evaluation | `tests/product-e2e/lifecycle-walk.test.ts` (B017 — read-path story walk, truth labels intact) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Verification | `tests/product-e2e/lifecycle-walk.test.ts` (B017 — read-path story walk, truth labels intact) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Learning experiment | `tests/epoch-e2e/full-loop.test.ts` (A027 — capability-gap learning loop, typed artifact at every stage) | `tests/epoch-e2e/` | `tests/epoch-e2e` battery |
| Body version creation | `packages/body-forge/src/forge.ts` (A021 — `forgeBodyVersion`: deterministic, tamper-detected, REAL A003 BodyVersion by construction) | `packages/body-forge/` | `packages/body-forge/src/forge.test.ts` + `property.test.ts` |
| Body/Substrate compatibility | `packages/compatibility/src/evaluator.ts` (A-series compatibility evaluation) | `packages/compatibility/` | `packages/compatibility/src/evaluator.test.ts` + `registry.test.ts` |
| Certification | `tests/product-e2e/lifecycle-walk.test.ts` (B017 — read-path story walk: … → Certification → Release) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Release/publication | `tests/product-e2e/lifecycle-walk.test.ts` (B017 — read-path story walk, Release hop) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Epoch adapter consumption | `tests/epoch-e2e/full-loop.test.ts` + `tests/epoch-e2e/adversarial.test.ts` (A027) | `tests/epoch-e2e/` | `tests/epoch-e2e` battery |
| Role-switch regression suite | `tests/product-e2e/role-switch.test.ts` (B017) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |
| Hosted/local parity suite | `tests/product-e2e/served-walk.test.ts` (B017 — the served app honours the same composition-layer contract over HTTP) + `tests/product-e2e/determinism.test.ts` (B016 seed parity: the real `scripts/product/seed.mjs` seeds the identical corpus hash) | `tests/product-e2e/` | `node tests/product-e2e/run.mjs` |

## Gate F - Release Evidence

| Checklist Item | Evidence Artifact | Responsible Deliverable | Verification Method |
|---|---|---|---|
| CI green | `.github/workflows/ci.yml` — run status is **`pending launch-day evidence`** (TL attaches the final CI run at the gate) | `.github/workflows/` | CI pipeline status |
| Product E2E green | `tests/product-e2e/run.mjs` (B017 self-contained runner) + the four suites (`lifecycle-walk`, `role-switch`, `determinism`, `served-walk`) — run output recorded into a `release/preview/src/records.ts` ProductE2E evidence record | `tests/product-e2e/` + `release/preview/` | `node tests/product-e2e/run.mjs` |
| Accessibility audit green | `apps/web/src/a11y/testing/a11y.test.ts` (B018 conformance battery) + `tests/performance/manifest.json` (A11Y-COMP-01…06 rows) — the audit **result record** is **`pending launch-day evidence`** (TL fills the Accessibility record in `release/preview`) | `apps/web/src/a11y/` + `release/preview/` | A11y battery + `docs/release/product/accessibility-statement.md` |
| Performance budget green | `tests/performance/src/perf.test.ts` + `tests/performance/src/product-budget.test.ts` (B018/A036 PERF1.0) — the budget **result record** is **`pending launch-day evidence`** (TL fills the Performance record in `release/preview`) | `tests/performance/` + `release/preview/` | Performance battery + `docs/release/product/performance-budget.md` |
| Security regression green | `tests/security/battery.test.ts` (+ `audit-replay.test.ts`, `data-rights-violations.test.ts`) — the regression **result record** is **`pending launch-day evidence`** (TL fills the Security record in `release/preview`) | `tests/security/` + `release/preview/` | Security battery |
| Free-tier quota tests green | `deploy/src/hosted/quotas.test.ts` (B015) | `deploy/` | Quota battery (`pnpm run test`) |
| Deployment health green | `deploy/preview/src/acceptance/health-checker.test.ts` — live run against `ARENA_PREVIEW_URL` is **`TL-owned at the launch gate`** (deployment-root probe `GET /`) | `deploy/preview/` | `deploy/preview` acceptance suite, live mode |
| Fresh-machine installation evidence | `scripts/product/install.mjs` (B016) — Linux-leg run log ATTACHED (`docs/evidence/production/launch/install-fresh-machine-2026-10-09.md`); the Installation record in `release/preview` is FILLED (`install-001` exitStatus 0, `release/preview/evidence/evidence-bundle.json` — bundle honestly INCOMPLETE: 7 launch-day records pending); macOS/Windows legs `pending launch-day evidence` | `scripts/product/` + `release/preview/` | Fresh-machine `node scripts/product/install.mjs` run |
| Fresh-browser UX walkthrough evidence | `tests/ux/run.mjs` (B017 browser layer) + `tests/ux/manifest.json` — the walkthrough **output** is ATTACHED: `docs/evidence/production/launch/ux-walkthrough-2026-10-09.md` (46/46 green on real headless Chromium, fresh cold-built tree); the HUMAN onboarding-clarity walkthrough (Gate C row 1) is `pending launch-day evidence` | `tests/ux/` | `node tests/ux/run.mjs` on a browser-capable host |
| Known limitations published | `docs/release/product/accessibility-statement.md` (Known Limitations section), `docs/release/product/mobile-support-statement.md` (Platform/Feature Limitations), `docs/launch/public-demo-guide.md` (What to Expect / What Not to Expect) | `docs/release/product/` + `docs/launch/` | Documentation review |

## Evidence Management

### Evidence Bundle Structure
```
release/preview/evidence/          # generated at launch (NOT committed — regenerated)
├── metadata.json          # Evidence bundle metadata
├── checklist-status.json  # Gate completion status
├── artifacts/             # Individual evidence artifacts
│   ├── health-checks.json
│   ├── capacity-states.json
│   ├── demo-execution.json
│   ├── e2e-results.json
│   ├── accessibility.json
│   ├── performance.json
│   └── security.json
└── reports/               # Generated reports
    ├── summary.txt
    └── detailed-report.md
```

The committed truth is the record TYPES (`release/preview/src/records.ts`) and the deterministic generator (`release/preview/src/evidence-generator.ts`) — see `release/preview/README.md` for the record contract and how the TL fills TL-owned rows (deployment URL, secret injection attestation, checklist finalization).

### Evidence Verification Process
1. **Automated Evidence**: Generated by CI/CD pipelines and test suites
2. **Manual Evidence**: Created by human verification and testing
3. **Artifact Validation**: Each artifact is verified for authenticity
4. **Cross-Reference**: Checklist items mapped to evidence artifacts
5. **Final Review**: Tech Lead reviews complete evidence bundle

### Evidence Retention
- **Duration**: 12 months post-launch
- **Storage**: Arena release records + backup
- **Access**: Available to stakeholders upon request
- **Audit**: Regular audits for evidence integrity

## Related Documentation

- [Launch Checklist](../launch-checklist.md) - Complete checklist requirements
- [Preview Acceptance Harness](../../deploy/preview/README.md) - Gate B verification
- [UX Regression Manifest](../../tests/ux/manifest.json) - Gate C check-to-surface mapping (B017)
- [Performance/A11y Manifest](../../tests/performance/manifest.json) - Gate C/F check-to-surface mapping (B018)
- [Product E2E Tests](../../tests/product-e2e/README.md) - Gate E verification
- [Release Evidence Records](../../release/preview/README.md) - Evidence management
- [Operational Runbooks](../../ops/preview/README.md) - Launch procedures

---

*This index is maintained by the Tech Lead and updated as evidence artifacts are generated during the launch process.*
