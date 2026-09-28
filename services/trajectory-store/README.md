# @arena/trajectory-store

The in-process **reference store** for Arena trajectories (Work Order A011
gate 6; requirements R10, R11, R24). Pure TypeScript, **zero external
runtime dependencies** — only `@arena/protocol-core` and `@arena/trajectory`
workspace packages. Durable persistence is a deployment-tier concern and is
deliberately NOT modeled here: the protocol is storage-neutral, and this
store demonstrates the boundary.

## API

| Operation | Semantics |
| --- | --- |
| `open(headerInput)` | Idempotent by trajectory id — same header ⇒ same record; a different header under the same id is an `IDENTITY_CONFLICT`. |
| `append(trajectoryId, entryInput, { idempotencyKey? })` | Full domain validation (contiguous sequences, monotonic timestamps, typed payloads, completion finality) + **chained-digest computation** — the store never trusts caller-side digests. Keyed appends replay as no-ops; the same key with a different input is an `IDEMPOTENCY_CONFLICT`. |
| `getById(trajectoryId)` | The latest version. |
| `getByDigest(digest)` | The EXACT historical version whose chain head equals the digest — the empty version is addressable by its header digest, and every append version by the chain head it produced. |
| `findByRunRef(runRef)` | Trajectories bound to the four RunAddress-shaped digest refs. |
| `findByBodyRef(agentBodyDigest)` | Trajectories whose acting agent/body has the digest. |
| `findByTimeRange({ from?, to? })` | Inclusive started-at window. |
| `list()` | Every latest version, deterministically ordered. |
| `replay(trajectoryId)` / `replayAt(digest)` | The ordered entry stream — latest, or pinned content-addressed. |

## Append-only persistence guarantee

There are **no update/delete APIs** (negative tests assert both the frozen
record objects and the absence of any mutation surface). Each append
produces a NEW frozen record; every historical version remains addressable
by its chain-head digest forever — content-addressed, append-only storage.
A trajectory with a `completion` entry is frozen: append-after-complete is
rejected with `TRAJECTORY_ALREADY_COMPLETED`.

## Demo

```
cd services/trajectory-store && pnpm demo    # (or: node main.mjs)
```

The demo self-bootstraps `node --experimental-strip-types` with a
`.js`→`.ts` resolve hook so the real workspace packages run straight from
their TypeScript sources — no build step, zero new dependencies. It drives
one deterministic end-to-end scenario: open (through the command envelope) →
mixed 7-entry append sequence (command → store → entry-appended event round
trips) → five negative probes → verification, addressability, queries,
replay views and an observability dump.

## Contracts

This service ships **no contract generator** — all trajectory contracts are
owned and emitted by `packages/trajectory` into `contracts/trajectory/` at
the repository root (the governance G9 check auto-discovers generators under
`packages/*/scripts` only; a `services/*` generator would not be picked up
without a root wiring change, which is a Tech Lead decision).

## Layering

Service layer (per docs/architecture.md §18): imports flow strictly downward
into the domain package (`@arena/trajectory`) and the protocol package
(`@arena/protocol-core`). No service-to-service imports. Boundary checker
green.

## Scripts

```
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (unit + property + hygiene)
pnpm build       # tsc -p tsconfig.build.json
pnpm demo        # node main.mjs (deterministic end-to-end demo)
```
