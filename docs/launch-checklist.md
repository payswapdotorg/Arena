# Arena Public Preview Launch Checklist L1.0

## Gate A — Local install/use

[ ] Fresh Linux/macOS/Windows-compatible Node 22 environment can install without hidden dependencies.
[ ] Documented single-command developer/demo start path works.
[ ] Fresh browser opens Arena home.
[ ] Demo workspace can be entered without provider credentials.
[ ] Demo can reset.
[ ] Demo covers the full reference chain.
[ ] No diagnostics-only route is the default experience.

## Gate B — Hosted preview

[ ] Vercel production deployment is live.
[ ] Stable public URL recorded in release docs.
[ ] Neon database bootstraps from versioned migrations.
[ ] R2 artifact lifecycle works.
[ ] Upstash Redis coordination works.
[ ] Optional Apify path has a dry run and is never required by the core demo.
[ ] Provider secrets are server-side only.
[ ] Health/readiness checks are live.
[ ] Provider capacity state is visible.
[ ] Free-tier exhaustion is fail-closed.
[ ] No hidden paid fallback exists.

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

[ ] CI green.
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
