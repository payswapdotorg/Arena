# Local mode = fakes, no providers, no billing

This page states exactly what runs on your machine in local mode, what
is deliberately absent, and how the hosted posture differs. It is the
contract behind the quickstart's claim that local Arena needs **no
provider accounts and no credentials**.

## What runs locally

| Concern | Local mode implementation |
| --- | --- |
| Control-plane state | The B002 **local fakes**: the in-memory `FakeControlPlaneRepository` (used by the web demo runtime and by tests) and the file-backed repository behind the product scripts' store (`.arena-local/store/control-plane.json`). Both implement the SAME provider-neutral `ControlPlaneRepository` port. |
| Demo state | The B006 deterministic demo corpus (5 canonical records under the reserved demo tenant `arena-demo`), seeded through the `DemoStore` port — idempotent, byte-identical on every machine. |
| Reads | The B005 canonical read path (`ReadModelService`) — demo reads go through the same port the product uses; there is no parallel demo-only API. |
| Auth | The B004 local/fake auth stack with one demo-only credential (a fixed descriptor, never a real secret). Demo sessions are disposable and carry no authority. |
| Web app | The Next.js app (`apps/web`) in dev mode on `http://localhost:3000`. |
| Clock | A `ManualClock` frozen at the fixed demo narrative epoch — no wall-clock, no randomness, so two runs are byte-identical. |

## What is deliberately absent in local mode

- **No hosted adapters are activated.** The Neon PostgreSQL, Cloudflare
  R2 and Upstash Redis adapters (B002/B015) exist in the repository but
  are NOT wired into local mode. Nothing in the local profile reads a
  provider credential, and no adapter is constructed.
- **No provider credentials anywhere.** Local mode runs with zero
  environment variables. Any `.env` files you create are ignored by the
  local workflow (`.env*` is gitignored).
- **No billing.** Nothing in the local profile can incur a cost: there
  are no provider calls to bill, and the free-tier capacity guards
  (B002 fail-closed exhaustion policy) are not even exercised locally.
- **No customer data.** The only state is demo state under the reserved
  demo tenant — and demo state is **never** customer-authoritative
  state. It is visibly labelled (banner + badges + reset affordance,
  from the frozen `@arena/demo` labelling contract) wherever it renders.

## The two demo stores — and why that is honest

Local mode has two surfaces over the SAME deterministic corpus:

1. **The CLI store** (`.arena-local/`, created by
   `node scripts/product/seed.mjs`): the file-backed local fake —
   persistent across commands, inspected by `doctor`, wiped totally by
   `reset`. It serves scripts, tooling and inspection.
2. **The web demo runtime** (composed by `apps/web/src/demo/runtime.ts`
   when you open `/demo`): an in-process demo store seeded
   automatically on first access, resettable from the UI
   (`POST /demo/reset`).

Both are local fakes over the same B002 port, both seed the identical
B006 corpus, and the corpus hash summary your `seed` command prints
(`4dfd1acd` at corpus version 1) is the same deterministic corpus the
`/demo` routes render. Neither is a hosted or customer posture; `reset`
wipes the CLI store totally, and the web runtime recomposes per process.

## Hosted posture is an explicit opt-in

Running Arena against real providers (Vercel Hobby, Neon Free,
Cloudflare R2, Upstash Redis, optional Apify Free) is a **separate,
deliberate step**, documented in
[docs/deployment/free-tier-architecture.md](../deployment/free-tier-architecture.md)
and wired by the B015 deployment tooling (`deploy/`). It requires
provider accounts, injected credentials (a Tech-Lead-owned step), and
respecting the free-tier contract — none of which local mode needs,
permits or implies.

The seed command will never write demo data into a hosted/customer
store posture: it targets the local fake store only.

## Reset semantics

`node scripts/product/reset.mjs` (see the quickstart) wipes **all local
state**: the `.arena-local/` store plus regenerable caches (`.turbo`,
`coverage`, per-package `dist`, per-app `.next`). It never touches
source, `node_modules`, `pnpm-lock.yaml` or git history, and it never
deletes anything without explicit confirmation. After a reset the
workspace is in the same state as a fresh install minus dependencies —
`node scripts/product/install.mjs` rebuilds the outputs if you need
them, and `node scripts/product/seed.mjs` reseeds the demo corpus to the
identical hash.
