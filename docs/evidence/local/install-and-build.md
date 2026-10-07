# G001 evidence — fresh machine, install and build

## Environment record (fresh E2B sandbox, nothing pre-warmed)

```
[env] Linux 6.x server, x86_64 | node v22.23.3 (downloaded this run) | pnpm 10.34.5 (installed this run)
[clone] fresh git clone of payswapdotorg/Arena (main tip)
[disk] >9 GiB free
```

## Install — the documented B016 entrypoint (exit 0, 111s total)

```
$ node scripts/product/install.mjs
… pnpm install (workspace, engine-strict) …
… pnpm build (turbo — workspace build outputs) …
[arena-install] step 4/4: verifying the workspace…
[arena-install]   PASS  build outputs present (packages/demo, packages/persistence)
[arena-install]   PASS  deterministic demo corpus verified: 5 records · tenant arena-demo · hash summary 4dfd1acd
[arena-install] done — Arena is installed and verified (local mode: zero providers, zero credentials).
```

## Doctor (B016 diagnosis — 7 pass · 1 warn · 0 fail)

```
PASS  node: v22.23.3 (engines >=22 <23)
PASS  pnpm: pnpm 10.34.5 (packageManager pin)
PASS  corepack: corepack 0.36.0 available
PASS  disk: 9.1 GiB free (>= 2.0 GiB recommended)
PASS  install: workspace installed (node_modules present)
PASS  build: workspace build outputs present (packages/*/dist)
WARN  store: local fake persistence store is not seeded (expected before first seed — optional store)
PASS  web: web dev server listening on http://localhost:3000
[arena-doctor] verdict: 7 pass · 1 warn · 0 fail
```

## Explicit web build (for the served-app batteries)

```
$ pnpm --filter @arena/web build        # exit 0 in 41s
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```
