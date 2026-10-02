# Local Profile Release Checklist

Run this checklist at the exact SHA being released. Every step is a
command with an expected observable result — no step is "believed done".

## 1. Gates (repository battery)

```bash
git fetch origin main:main
pnpm governance          # expect: clean, 0 findings
pnpm boundary            # expect: clean, 0 violations
pnpm typecheck           # expect: 0 errors
pnpm lint                # expect: 0 problems
pnpm test                # expect: all suites pass
pnpm build               # expect: ok
git checkout -- pnpm-lock.yaml   # restore before the final commit
```

## 2. Product workflow battery (the local profile itself)

```bash
node scripts/product/tests/run-tests.mjs   # expect: 66/66 pass
node scripts/product/doctor.mjs            # expect: exit 0, 0 fail
node scripts/product/reset.mjs --yes       # expect: total wipe, exit 0
node scripts/product/install.mjs           # expect: steps 1-4 PASS, exit 0
node scripts/product/seed.mjs              # expect: created 5, corpus hash summary 4dfd1acd
node scripts/product/seed.mjs              # expect: created 0 (idempotent)
node scripts/product/doctor.mjs            # expect: store healthy, byte-identical corpus
```

## 3. Quickstart walkthrough (fresh-machine simulation)

- [ ] Follow `docs/getting-started/README.md` from step 0 on a clean
      clone + clean state directory; no step requires a provider
      account, credential or payment.
- [ ] `/demo` renders with the always-visible demo banner and per-datum
      demo badges; role lenses work (`?role=owner|agent-builder|expert`).
- [ ] `POST /demo/reset` (the demo reset control) reseeds and lands back
      on labelled demo state.
- [ ] Every failure intentionally provoked from
      `docs/getting-started/troubleshooting.md` produces the documented
      doctor line and is fixed by the documented next step.

## 4. Product-truth audit

- [ ] Seed output names the demo tenant, every seeded record id, the
      corpus hash summary and the labelling contract text.
- [ ] Reset without confirmation deletes nothing (abort before any fs
      change, exit 1).
- [ ] Reset `--yes` wipes state + caches AND leaves source,
      `node_modules`, `pnpm-lock.yaml` and git history untouched.
- [ ] No command reads, requires or hints at provider credentials.
- [ ] Demo state never reaches a hosted/customer posture (the seed
      target is the local fake store only).

## 5. Release record

- [ ] `release/local/RELEASE-NOTES.md` updated with the profile version,
      verified evidence and known limitations.
- [ ] The completion report carries the exact gate numbers observed at
      the release SHA.
