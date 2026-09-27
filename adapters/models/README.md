# @arena/adapter-models — reference model adapters (A016)

This directory is the **first adapter surface** in the repository
(architecture-lock rule 10; docs/architecture.md §17: external providers
and models interact via adapters; provider-specific semantics never enter
Arena kernel contracts). It hosts TWO reference adapters implementing the
`SubstrateAdapter` protocol from `@arena/model-substrate`:

- **`adapter-neutral-mock/`** — `@arena/adapter-neutral-mock`: a fully
  capable deterministic mock. Registers any neutral descriptor that fits
  its declared capability envelope; probes report the envelope; health
  self-checks the descriptor digest.
- **`adapter-offline-stub/`** — `@arena/adapter-offline-stub`: a fixed
  offline catalog stub (a single offline model family). Registrations must
  match the catalog exactly; probes return the offline baseline profile;
  all outputs are deterministic.

Both are pure TypeScript with **zero external runtime dependencies** and
deterministic outputs — NO real provider SDKs (provider adapters ship
later per deployment tier; A026 owns the Epoch adapter surface).

## Workspace wiring (READ THIS — known glob gap)

`pnpm-workspace.yaml` declares the workspace glob `adapters/*`, which
matches **this directory itself** (`adapters/models`) but NOT the nested
adapter packages (`adapters/models/adapter-neutral-mock`,
`adapters/models/adapter-offline-stub`) — standard glob semantics, `*`
does not cross `/`. Root files are outside A016's owned surfaces, so the
gap is worked around INSIDE the owned surface:

- `adapters/models` is the pnpm workspace package (`@arena/adapter-models`,
  matched by `adapters/*`). Its scripts typecheck / lint / test / build
  BOTH adapters (vitest includes `adapter-*/src/**/*.test.ts`; the build
  runs each adapter's `tsconfig.build.json`), so the full battery covers
  the reference adapters today.
- Each adapter is ALSO a self-contained, workspace-READY package (own
  `package.json` with `workspace:*` deps, own tsconfigs, own vitest
  config) so that the ONE-LINE root intake — adding `adapters/models/*`
  (or equivalent) to `pnpm-workspace.yaml`'s packages list — makes them
  first-class workspace packages with no further changes.

Related gaps flagged for Tech Lead root intake (see the A016 report):

1. `pnpm-workspace.yaml` glob `adapters/*` does not reach
   `adapters/models/*` (this README's workaround).
2. Governance G9's package-generator glob covers `packages/*` only —
   `adapters/*` (and `services/*`) generators would not be auto-discovered.
   The reference adapters define no new wire schemas (all contracts are
   owned by `@arena/model-substrate` under `contracts/model-substrate/`),
   so no adapter-level generator is shipped; if later adapters need
   contract governance, the G9 glob needs a root-file extension.

The boundary checker treats both adapters as one workspace
(`adapters/models`, layer: adapter) — adapters may import
`@arena/protocol-core` and `@arena/model-substrate` (downward into
protocol/domain, the documented §17 exception) and NEVER import each
other's internals (B3: provider adapters are isolation boundaries).

## Development

From the repository root (or here):

```bash
pnpm install
pnpm typecheck   # tsc --noEmit (both adapters)
pnpm lint        # eslint . (both adapters)
pnpm test        # vitest run (both adapters' suites)
pnpm build       # tsc -p adapter-*/tsconfig.build.json (dist/ per adapter)
```
