# Troubleshooting the local install

Every item below maps a symptom to the `node scripts/product/doctor.mjs`
line that diagnoses it and the fix. When something fails, run doctor
first — its output is the entry point for every common failure.

---

## `node … is OUTSIDE the supported range >=22 <23`

**doctor line:** `FAIL node: …`

The repository pins Node 22 (`engines.node`). Other majors are untested,
and `pnpm install` will refuse to run on them (`engine-strict`).

**Fix:**

```bash
nvm install 22 && nvm use 22     # or fetch Node 22 from https://nodejs.org
```

Re-run `node scripts/product/doctor.mjs` to confirm, then
`node scripts/product/install.mjs` if you have not installed yet.

---

## `pnpm is not on PATH`

**doctor line:** `FAIL pnpm: pnpm is not on PATH`

**Fix:** Node 22 bundles corepack, which provides the exact pinned pnpm
(`pnpm@10.34.5`):

```bash
corepack enable
```

If corepack itself is missing, your Node installation is unusual —
reinstall Node 22 from <https://nodejs.org>.

---

## `pnpm <x.y.z> does not match the pinned pnpm 10.34.5`

**doctor line:** `FAIL pnpm: …`

A manually installed pnpm is shadowing the corepack shim.

**Fix:**

```bash
corepack enable && corepack prepare pnpm@10.34.5 --activate
```

Run from the repository root so the `packageManager` pin is picked up.

---

## `unrecognized engines.node range …`

**doctor line:** `FAIL node: unrecognized engines.node range …`

The scripts only understand the repository's bounded pin shape
(`>=MAJOR <MAJOR`). If the repository changed its engines policy, the
product scripts must be updated to match — report it.

---

## `only <n> free (<2.0 GiB recommended)`

**doctor line:** `FAIL disk: …`

**Fix:** free up disk space (a full install + build needs roughly
2 GiB) and re-run `node scripts/product/install.mjs`.

---

## `the workspace is not installed yet (no node_modules)`

**doctor line:** `FAIL install: workspace is not installed (no node_modules)`
**Seed fails with:** `FAILED: the workspace is not installed yet`

**Fix:**

```bash
node scripts/product/install.mjs
```

---

## `pnpm install exited non-zero`

**install step 2 output.** Common causes: a Node/pnpm prerequisite
failure (see above — install checks these first and would have failed
earlier), a network problem, or a lockfile/manifest inconsistency.

**Fix:** read the `pnpm install` output above the failure line; fix the
reported issue and re-run `node scripts/product/install.mjs`. For a
diagnosis only: `node scripts/product/doctor.mjs`.

---

## `pnpm build exited non-zero`

**install step 3 output.** A workspace compile error — read the failing
task's output above the failure line. Build failures are repository
issues, not local-environment issues; re-running install after pulling
the latest main usually resolves them.

---

## `local fake persistence store is CORRUPT: …`

**doctor line:** `FAIL store: … CORRUPT …`

The store file (`.arena-local/store/control-plane.json`) is not valid
store JSON — typically hand-edited or truncated.

**Fix (total reset + reseed):**

```bash
node scripts/product/reset.mjs --yes
node scripts/product/seed.mjs
```

---

## `store diverges from the deterministic demo corpus …`

**doctor line:** `WARN store: … diverges …`

The store holds demo records whose content no longer byte-matches the
frozen corpus (e.g. records were mutated through the port, or an older
corpus version is on disk).

**Fix:** reset and reseed in one step:

```bash
node scripts/product/reset.mjs --yes --reseed
```

---

## `store holds records OUTSIDE the demo tenant (…)`

**doctor line:** `WARN store-tenants: …`

The CLI store is a local fake intended for demo/state experiments;
records under a non-demo tenant are unexpected there.

**Fix:** if unintentional — `node scripts/product/reset.mjs --yes`,
then `node scripts/product/seed.mjs`.

---

## `web dev server is not listening on http://localhost:3000`

**doctor line:** `WARN web: …`

The web app is simply not running.

**Fix:**

```bash
pnpm --filter @arena/web dev
```

If the port is busy with **another** application, doctor reports the
port as listening — stop the other application or start the web app on
a different port (`pnpm --filter @arena/web dev -- --port 3001`) and
open the printed URL instead.

---

## `reset` aborted: `non-interactive session …`

**Reset output:** `ABORTED: non-interactive session — the total wipe
requires explicit confirmation`.

This is the confirmation gate doing its job: without a TTY, reset
refuses to delete anything unless you pass `--yes`.

**Fix:** review the printed wipe plan, then:

```bash
node scripts/product/reset.mjs --yes
```

---

## The workspace modules could not be loaded

**Seed/doctor line:** `FAILED: the workspace modules could not be
loaded (…)`

The TypeScript source shim could not load `@arena/persistence` /
`@arena/demo`. Almost always a follow-on from an incomplete install.

**Fix:** `node scripts/product/doctor.mjs` for the root cause (usually
the `install` check), then `node scripts/product/install.mjs`.

---

## `build outputs are missing` (WARN only)

**doctor line:** `WARN build: …`

Not a failure: local demo mode runs from TypeScript sources. The
`dist/` outputs matter for publishing/hosted flows — run
`node scripts/product/install.mjs` (its build step produces them).

---

## Everything passes but something still feels wrong

1. `node scripts/product/reset.mjs --yes --reseed` — return to the
   pristine deterministic demo state.
2. `node scripts/product/doctor.mjs` — confirm 0 fail.
3. Re-run the quickstart from
   [README.md](README.md) — it is deliberately short.
