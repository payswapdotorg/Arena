# Arena — Getting Started (local install)

This quickstart takes a **fresh machine** to a running local Arena with
the deterministic **Demo mode** — in the smallest honest number of
steps. Everything runs locally on fakes: **no provider accounts, no
credentials, no billing** (see [local-mode.md](local-mode.md)).

## What your machine needs

| Requirement | Why |
| --- | --- |
| **Node 22** (the repository pins `engines: ">=22 <23"`) | The workspace runs its TypeScript sources through Node 22's type stripping. |
| **corepack** (bundled with Node 22) | Selects the exact pinned pnpm (`pnpm@10.34.5`) automatically — you never install pnpm by hand. |
| **git** | To clone this repository. |
| ~2 GiB free disk | A full install + build. |

You do **not** need: a Neon, Cloudflare, Upstash, Vercel or Apify
account; any API key; any paid plan. Local mode is entirely local.

## Steps

### 0. Enable corepack (one-time)

```bash
corepack enable
```

This wires the `pnpm` command to the exact version pinned by the
repository (`packageManager: pnpm@10.34.5`). If `corepack` is missing,
install Node 22 from <https://nodejs.org> first.

### 1. Clone and install

```bash
git clone https://github.com/payswapdotorg/Arena.git
cd Arena
node scripts/product/install.mjs
```

`install` checks your prerequisites first (Node range, exact pnpm pin,
corepack, disk) and **fails early with an actionable message** — never a
deep stack trace — then runs `pnpm install`, `pnpm build`, and verifies
that the workspace loads and the deterministic demo corpus seeds to its
stable hash.

### 2. Seed the deterministic demo corpus

```bash
node scripts/product/seed.mjs
```

This writes the B006 demo corpus — 5 canonical records under the
reserved demo tenant `arena-demo` — into the **local fake persistence
store** (`.arena-local/store/control-plane.json`). The command prints
exactly what was seeded, the demo tenant identity, and the corpus hash
summary (`4dfd1acd` at corpus version 1 — identical on every machine).

Seeding is **idempotent**: re-running creates nothing new.

> **Demo state is not customer state.** Everything seeded here is a
> deterministic, resettable replay — visibly labelled as such everywhere
> it appears.

### 3. Start the web app and open Demo mode

```bash
pnpm --filter @arena/web dev
```

Open <http://localhost:3000>:

- `/` — the first-run landing (a calm three-step introduction with one
  primary action);
- **`/demo` — the deterministic Demo mode**, the recommended first
  exploration: a guided narrative over the seeded corpus with role
  lenses (`?role=owner`, `?role=agent-builder`, `?role=expert`; default
  `owner`). Every demo page carries the always-visible "Demo mode"
  banner and per-datum "Demo data" badges, and offers a one-click demo
  reset (`POST /demo/reset`) that reseeds to the identical corpus hash.

### 4. When anything looks off

```bash
node scripts/product/doctor.mjs
```

One PASS/WARN/FAIL verdict per item (Node, pnpm, corepack, disk,
install, build, the local store — including a byte-level comparison
against the deterministic demo corpus — and the web port), each
non-pass with an actionable next step. Common failures are mapped in
[troubleshooting.md](troubleshooting.md).

## Starting over: the total reset

```bash
node scripts/product/reset.mjs --yes          # wipe local state + caches
node scripts/product/reset.mjs --yes --reseed # …and reseed the demo corpus
```

Reset is **total and explicit**: it wipes the local fake persistence
store and the regenerable caches (`.turbo`, `coverage`, `dist`, `.next`),
and **never** touches source, `node_modules`, the lockfile or git
history. Interactive sessions are asked to type exactly `reset` to
confirm; non-interactive sessions must pass `--yes` — otherwise reset
aborts before deleting anything.

## Command reference

| Command | What it does |
| --- | --- |
| `node scripts/product/install.mjs` | prerequisite check → `pnpm install` → `pnpm build` → verify |
| `node scripts/product/seed.mjs` | deterministic demo corpus into the local fake store (idempotent) |
| `node scripts/product/doctor.mjs` | environment diagnosis (pass/warn/fail per item) |
| `node scripts/product/reset.mjs [--yes] [--reseed]` | total wipe of local state, optional reseed |

All commands support `--help` and exit `0` / `1` (failure) / `2` (usage
error). Full details: [`scripts/product/README.md`](../../scripts/product/README.md).

## Where to go next

- **What "local = fakes" means, and what it deliberately is not:**
  [local-mode.md](local-mode.md)
- **Something failed:** [troubleshooting.md](troubleshooting.md)
- **The hosted preview posture (explicit opt-in, providers, free-tier):**
  [docs/deployment/free-tier-architecture.md](../deployment/free-tier-architecture.md)
- **The demo narrative and its product-truth labels:**
  [docs/demo/reference-narrative.md](../demo/reference-narrative.md)
