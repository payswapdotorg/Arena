# Arena Deployment Runbooks — B015 (ops/deployment)

Production provider wiring and deployment automation for the Arena hosted
preview (Work Order B015). These runbooks operationalize
`docs/deployment/free-tier-architecture.md` (FT1.0, the normative target
architecture) and `spec/free-tier-contract.md` (FT2.0, the normative
quotas/fail-closed rules).

## What B015 delivered

| Artifact | Where |
|---|---|
| Hosted provider wiring (env-driven, placeholder-safe, dry-run mode) | `deploy/src/hosted/` (typed, tested) |
| Free-tier quota ceilings + fail-closed guard | `deploy/src/hosted/quotas.ts`, `deploy/src/hosted/fail-closed.ts` |
| Adapter instantiation glue (composes the B002 hosted adapters) | `deploy/src/hosted/wiring.ts` |
| Credential-free wiring dry run (full path against local fakes) | `deploy/src/hosted/dry-run.ts` (`pnpm --dir deploy dryrun`) |
| Runtime env contract template (EMPTY placeholders only) | `deploy/env/hosted-preview.env.example` |
| Deployment automation (GitHub Actions) | `.github/workflows/deploy-preview.yml` |
| Committed-secret scanner | `deploy/scripts/secret-scan.mjs` |

## Runbook index

| Runbook | Purpose |
|---|---|
| [provider-setup.md](./provider-setup.md) | Per-provider free-tier setup, the env-var contract, GitHub/Vercel secret injection (TL-owned, launch gate B019) |
| [free-tier-limits.md](./free-tier-limits.md) | The free-tier quota table, where quota state surfaces (B014 capacity panel), the fail-closed rules |
| [rollback.md](./rollback.md) | Rollback procedure for the hosted preview (Vercel instant rollback first, then per-store) |
| [quota-exhaustion-playbook.md](./quota-exhaustion-playbook.md) | What happens when a quota is exhausted, how to verify fail-closed behavior, the never-upgrade-automatically rule |

## Ownership note (docs/deployment)

The B015 dispatch text lists `docs/deployment/*` additions among the owned
surfaces, but the machine-checked surface registry
(`scripts/work-order-surfaces.json`, A001-owned) registers B015 with
`deploy/*`, `ops/deployment/*`, `.github/workflows/deploy*` only — a
`docs/deployment/*` change would fail governance G4 at any branch. All
B015-authored pages therefore live HERE (`ops/deployment/`); the existing
`docs/deployment/free-tier-architecture.md` remains the normative source
this runbook set points at. Flagged to the Tech Lead as an architecture
question in the B015 final report.

## The three product truths these runbooks enforce

1. **Free-tier-compatible by construction** — the default deployed profile
   runs on Vercel Hobby + Neon Free + Cloudflare R2 free tier + Upstash
   Redis Free. Quota ceilings are encoded as config constants
   (`deploy/src/hosted/quotas.ts`) and declared to the B002 adapters so
   they surface through the capacity panel.
2. **Secrets never in git** — env-driven config, empty-placeholder
   templates, a wired secret scanner in the deploy workflow, and live
   secret injection owned by the Tech Lead at the launch gate (B019).
3. **Fail closed, no paid fallback — ever** — quota exhaustion refuses
   operations (`PersistenceCapacityError`); a billable fallback is not
   representable anywhere in the wiring.
