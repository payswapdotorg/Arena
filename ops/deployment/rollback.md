# Rollback Procedure — Hosted Preview (B015)

Rollback order for the Arena hosted preview: **web first** (the fastest,
most user-visible lever), then per-store. The hosted preview is a
PREVIEW: demo/labelling posture per the B006 contract — hosted demo state
is never customer state, which bounds blast radius and simplifies
rollback.

> The deploy pipeline is `.github/workflows/deploy-preview.yml`
> (prebuilt deploys from `apps/web`, production alias, concurrency group
> `deploy-preview`, HTTP smoke check after every deploy).

## 0. When to roll back

- The post-deploy smoke check failed (non-2xx/3xx on the deployment URL),
  or
- the deployment is green but a hosted-preview acceptance path is broken
  (health checks failing, capacity panel reporting a provider DOWN), and
  a fix-forward is not immediately available.

## 1. Web tier — Vercel instant rollback (minutes)

1. In the Vercel dashboard (project → Deployments) select the last known
   good production deployment and choose **Instant Rollback** — this
   repoints the production alias to the previous build; no rebuild, no
   re-deploy of code.
   (CLI equivalent: `pnpm dlx vercel@62.1.0 rollback <deployment-url>
   --token <token>` run from `apps/web` with the CI credentials.)
2. Verify: open the hosted-preview URL; confirm the B006 demo surfaces
   render and `/operations/capacity` reports the providers.
3. Rollback covers the WEB TIER only — it does not roll back data.

## 2. Control plane — Neon (PostgreSQL)

- Migrations are **versioned, ordered and idempotent**
  (`SQL_MIGRATION_SOURCES`, B002): `CREATE TABLE IF NOT EXISTS` guards;
  re-running bootstrap is a no-op (proven in the dry run).
- Rollback policy is **forward-only**: do not hand-edit schema. If a
  migration must be reverted, ship a new forward migration; never mutate
  the ledger by hand.
- Free-tier reality: Neon Free has no guaranteed point-in-time restore
  window for arbitrary timestamps — treat preview control-plane data as
  expendable. The nuclear option (last resort, documented, not default):
  drop and recreate the project database, then re-run bootstrap
  (migrations + hosted-preview seed marker re-apply deterministically).
- The hosted-preview seed is one marker record
  (`preview-bootstrap-marker`); demo content is B006/B016 territory, not
  rollback state.

## 3. Object store — Cloudflare R2

- R2 objects are **content-addressed and immutable** (`sha256:<hex>` key =
  content digest; first write's metadata wins): there is nothing to
  "roll back" — a bad write cannot corrupt a good object, and older
  deployments referencing old digests keep resolving.
- If a bad artifact set must disappear: delete the objects (bucket →
  objects) — free-tier Class A/B operation budgets are tracked in the
  capacity panel; a mass delete counts against Class A operations.
- Bucket-level recreation is the nuclear option (empty bucket → re-upload
  from source-of-truth artifacts).

## 4. Coordination — Upstash Redis

- Redis holds ONLY bounded/rebuildable state (caches, idempotency
  windows, rate limits, leases; `arena:cache|idem|rl|lease` namespaces).
  **Flushing the database is safe**: the system rebuilds this state; no
  authoritative fact lives here (FT2.0).
- If rate-limit/idempotency behavior degrades after an incident: flush
  the database (Upstash console) rather than trying to surgically repair
  keys.

## 5. Rollback of the wiring itself (deploy/ + workflow)

- All wiring changes land via PR with the deploy battery green
  (103 tests, including the credential-free dry run and fail-closed
  proofs). Reverting the offending commit re-runs
  `deploy-preview.yml` on main automatically.
- The runtime env contract is additive-only in practice (new names are
  optional or defaulted); removing an env name requires checking
  `deploy/env/hosted-preview.env.example` consumers first — the
  env-contract test fails the battery on template/registry drift.

## 6. Verification checklist after any rollback

- [ ] Hosted-preview URL serves 2xx (smoke check).
- [ ] `/operations/capacity`: all three registered providers report
      AVAILABLE/DEGRADED (none DISABLED/EXHAUSTED).
- [ ] `pnpm --dir deploy dryrun` passes locally from the rolled-back SHA.
- [ ] Incident note appended to the launch checklist (TL-owned,
      docs/launch/* at B019).
