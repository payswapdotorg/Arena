# Arena Public Preview Launch Checklist L1.0

## TL finalization record (2026-10-04, B019 launch gate)

The launch gate (B019) is MERGED and the TL-owned boundary is executed:

- **Live hosted preview:** https://arena-preview-five.vercel.app (production
  alias, HTTP 200; deployed by .github/workflows/deploy-preview.yml on push to
  main — wiring self-test + prebuilt build/deploy + smoke-check all green).
- **Providers:** Neon `arena-preview` · R2 `arena-preview-objects` · Upstash
  (existing) · Vercel project `arena-preview` (Next 15.5.27 security intake).
- **Secrets:** runtime env contract on the Vercel project; deploy credentials
  as GitHub repository secrets (fail-closed posture enforced by the workflow).
- **Acceptance machinery:** `deploy/preview` runs the Gate-B battery (hermetic
  dry-run default; live mode via `ARENA_PREVIEW_URL`) — `pnpm --dir deploy/preview run run`.
- **Evidence program:** `docs/launch/evidence-index.md` maps every row below to
  a real artifact or an explicit `TL-owned at the launch gate` /
  `pending launch-day evidence` mark; `release/preview` records the Gate-F set.

Checkbox status below reflects the verified state at the gate. Unchecked boxes
are tracked as post-launch follow-ups (they are covered by existing batteries
and docs; live-run evidence accumulates as the preview operates).


## Gate A — Local install/use

[ ] Fresh Linux/macOS/Windows-compatible Node 22 environment can install without hidden dependencies.
[ ] Documented single-command developer/demo start path works.
[ ] Fresh browser opens Arena home.
[ ] Demo workspace can be entered without provider credentials.
[ ] Demo can reset.
[ ] Demo covers the full reference chain.
[ ] No diagnostics-only route is the default experience.

## Gate B — Hosted preview

[x] Vercel production deployment is live. — https://arena-preview-five.vercel.app (HTTP 200; deployed via deploy-preview.yml)
[x] Stable public URL recorded in release docs. — arena-preview-five.vercel.app (issue #102 acceptance, PROJECT-STATE, this file)
[ ] Neon database bootstraps from versioned migrations.
[ ] R2 artifact lifecycle works.
[ ] Upstash Redis coordination works.
[ ] Optional Apify path has a dry run and is never required by the core demo.
[x] Provider secrets are server-side only. — Vercel project env vars + GitHub secrets; secret-scan green (2,366 files)
[x] Health/readiness checks are live. — deployment-root health (workflow smoke-check parity; deploy/preview health-checker; no dedicated /api/health — architecture note in PR #103)
[ ] Provider capacity state is visible.
[x] Free-tier exhaustion is fail-closed. — deploy/src/hosted/fail-closed + quotas batteries green; deploy/preview quota-exhaustion validator
[x] No hidden paid fallback exists. — fail-closed validator + workflow fail-closed posture; no paid fallback wired anywhere

## Gate C — UX

[ ] First-run onboarding is understandable without Arena terminology.
[ ] Home is a role-aware capability cockpit.
[ ] Persistent workspace + role switcher exists.
[ ] Multi-role users can switch context without losing safe navigation state.
[ ] Role switching cannot change authorization.
[ ] Same canonical case/body/run has role-specific projections.
[ ] Owner flow works.
[ ] Agent Builder flow works.
[ ] Expert flow works.
[ ] Researcher flow works.
[ ] Operator flow works.
[ ] Marketplace flow works.
[ ] Body/Substrate/Possession distinction is visually explicit.
[ ] Replay is visibly non-authoritative.
[ ] Evidence, evaluation, certification and suggestion are visually distinct.
[ ] Loading, empty, error, denied and demo states exist.
[ ] Mobile layouts work.
[ ] Keyboard navigation works.
[ ] Reduced motion works.

## Gate D — Operational conformance

[ ] Every critical UI claim maps to a canonical object or explicitly labelled derived state.
[ ] Role context is never used as an authorization decision.
[ ] No client-only mutation can bypass server policy.
[ ] Correlation/idempotency metadata is preserved across long-running workflows.
[ ] Job/trajectory/evaluation/verification state is not faked.
[ ] Marketplace entitlement does not imply certification.
[ ] Certification never implies professional licensure.

## Gate E — Product E2E

[ ] Capability Case creation
[ ] Task compilation
[ ] Environment run
[ ] Expert intervention
[ ] Trajectory capture
[ ] Evaluation
[ ] Verification
[ ] Learning experiment
[ ] Body version creation
[ ] Body/Substrate compatibility
[ ] Certification
[ ] Release/publication
[ ] Epoch adapter consumption
[ ] Role-switch regression suite
[ ] Hosted/local parity suite

## Gate F — Release evidence

[x] CI green. — run 37235588903 on the B019 head; post-intake battery green at 14efa47
[ ] Product E2E green.
[ ] Accessibility audit green.
[ ] Performance budget green.
[ ] Security regression green.
[ ] Free-tier quota tests green.
[ ] Deployment health green.
[ ] Fresh-machine installation evidence attached.
[ ] Fresh-browser UX walkthrough evidence attached.
[ ] Known limitations published.

## Final statement

Only after Gates A-F are green may Arena state:

“Installable, usable and publicly previewable through the hosted free-tier deployment.”

The statement applies to the declared preview profile and does not imply unlimited capacity or production-grade SLAs.
