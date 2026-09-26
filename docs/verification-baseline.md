# Arena Verification Baseline

> This file is required by the A001 dispatch (acceptance criteria item 10) and
> fulfils the "Verification baseline" section of spec/PROJECT-STATE.md for
> A001. A001's owned surfaces in spec/work-items.md do not include `docs/*`;
> the A001 dispatch explicitly mandates this file and docs/repo-layout.md.
> The carve-out is recorded in `scripts/work-order-surfaces.json` and flagged
> to the Tech Lead.
>
> The final merge SHA and the CI run on GitHub Actions are recorded by the
> Tech Lead at acceptance/merge time (spec/PROJECT-STATE.md successor rule);
> the branch head SHA of this delivery is recorded in the delivery
> MANIFEST.txt and in the PR body.

## Toolchain (A001 verification environment)

| Tool | Version | Notes |
|---|---|---|
| Node.js | v22.23.3 | per `.nvmrc` (22) and `engines.node` (>=22 <23, engine-strict). Sandbox default node is v24.21.0 — the battery intentionally ran under Node 22 to match the pinned engines. |
| pnpm | 10.34.5 | matches `packageManager` exactly; installed via npm `--prefix ~/.local` (corepack symlink not permitted in the sandbox) |
| Python | 3.12.14 | runs `scripts/governance-check.py` (stdlib only) |
| git | system git | clone of payswapdotorg/arena at dispatch base `a2e9549bf2d4d72226a09147699256763fafdb50` |
| Platform | linux x64 | isolated worker sandbox |

Dependency pins (exact, via pnpm catalog — verified to exist on npm at
dispatch time): `@types/node 22.20.4`, `@eslint/js 10.0.1`, `eslint 10.11.0`,
`globals 17.12.0`, `turbo 2.11.3`, `typescript 5.9.3`, `typescript-eslint
8.70.1`, `vitest 5.0.1`, `zod 4.6.5` (zod catalogued, not yet consumed).

## Verification battery (exact commands and results)

Run from the repository root under Node v22.23.3 / pnpm 10.34.5, on the
committed branch `work/A001-repo-foundation`:

| Command | Exit code | Result |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | lockfile up to date; 3 workspace projects resolved |
| `pnpm governance` | 0 | self-test **24/24** fixtures behaved as expected; repo check clean (G1–G9; 108 changed paths all inside owned surfaces; diff base `a2e9549`) |
| `pnpm boundary` | 0 | self-test **11/11** fixtures behaved as expected; repo scan clean (B1–B4) |
| `pnpm typecheck` | 0 | turbo: 2/2 packages (`@arena/protocol-core`, `@arena/web`) |
| `pnpm lint` | 0 | turbo: 2/2 packages + root scripts/eslint config |
| `pnpm test` | 0 | **105/105** tests in `@arena/protocol-core` (7 files) + **3/3** in `@arena/web` (1 file) = **108/108** |
| `pnpm build` | 0 | turbo: 2/2 packages; `dist/` emitted with `.js`/`.d.ts`/maps |

### Negative evidence (checks must fail on violations)

1. **Built-in self-tests** (run as part of `pnpm governance` / `pnpm boundary`):
   24 governance fixtures + 11 boundary fixtures; violation fixtures MUST
   produce failures, clean fixtures MUST pass — a fixture that does not behave
   as expected makes the whole command exit non-zero.
2. **Manual end-to-end demos** (in a throwaway clean clone, then reverted):
   - adding `"left-pad": "^1.0.0"` to protocol-core devDependencies →
     `pnpm governance --check-only` exits 1 with
     `[G6-frozen-deps] ... non-exact dependency spec left-pad@'^1.0.0'`;
   - adding `import '@arena/web'` to protocol-core → `pnpm boundary
     --check-only` exits 1 with `[B1] ... no workspace may import an app`.

### Reproducibility evidence

- **Clean checkout install**: fresh `git clone` of this repository, checkout
  of `work/A001-repo-foundation`, `pnpm install --frozen-lockfile` → exit 0.
- **Pristine scaffold battery**: in a clean clone, `node scripts/new-package.mjs
  --name @arena/scaffold-proof --layer domain` followed by typecheck / lint /
  test / build → all exit 0 (2/2 tests, dist emitted). The scaffolder's
  structural self-test (`--self-test`) passes 5/5. `@arena/protocol-core`
  itself was scaffolded with this tool (dogfooding evidence).

## CI

`.github/workflows/ci.yml` runs the full battery on pull_request and push to
main, with action refs pinned to exact release tags (`actions/checkout@v7.0.1`,
`actions/setup-node@v7.0.0` — tags verified to exist via `git ls-remote`).
Governance check G8 machine-verifies the workflow's shape (triggers, pinned
refs, all battery steps). The workflow has not yet been observed running on
GitHub Actions (no push credentials in the worker sandbox); the first CI run
on the PR is the remaining evidence item for the Tech Lead.

## Known limitations

1. **CI not yet observed on GitHub Actions** — authored and machine-checked,
   but the sandbox cannot execute GitHub workflows. First PR CI run pending.
2. **Push failed (expected)** — no token granted; delivery is via git bundle
   at `~/arena-delivery/A001/`.
3. **LICENSE placeholder** — proprietary all-rights-reserved text; final
   license is an Architect decision.
4. **docs/ carve-out** — `docs/repo-layout.md` and this file are mandated by
   the A001 dispatch but sit outside A001's spec/work-items.md surfaces;
   recorded transparently in `scripts/work-order-surfaces.json` and flagged
   as an architecture question.
5. **Boundary checker is regex-based** (no full AST) — sufficient for the
   deliberate import styles here; exotic syntax could evade it.
6. **Canonical JSON is defined post-parse** — duplicate keys in raw wire JSON
   collapse (last wins) before canonicalization; raw-byte duplicate detection
   is out of scope (consistent with RFC 8785).
7. **Adapter-layer exception is an interpretation** — B4 allows
   `adapters/*` to import protocol/domain packages (architecture.md §17
   provider adapters). Flagged for Architect confirmation.
8. **Overlap check (G5) is conservative** — prefix-based glob intersection
   may report potential overlap where none can occur in practice.
9. **Source-resolved internal packages** — workspace `exports` point at
   `src/` (types + default) so typecheck/tests never need a pre-built
   dependency; `publishConfig` reserves the dist-based shape for a future
   publish flow. Running emitted JS under stock Node requires the dependency
   to be built (or Node's type stripping).
10. **engine-strict=true** — hosts on Node 24 (like this sandbox's default)
    fail `pnpm install` by design; use Node 22 (`.nvmrc`).
