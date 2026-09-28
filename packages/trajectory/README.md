# @arena/trajectory

The Arena **trajectory protocol** — the append-only, digest-addressed record
of what an agent DID inside a run: actions taken, observations received, and
their ordering (Work Order A011; requirements R10, R11, R24;
architecture-lock rule 6 — *trajectories are append-only and
content-addressed*; spec ENV1.0 "Evidence"; docs/architecture.md §5).

## Objects

| Object | What it commits to |
| --- | --- |
| `TrajectoryRunRef` | The run binding: the four **input** parts of the run's evidence address (task version, environment version, run id, initial snapshot digest) plus the optional A010 `RunRecord` digest pin. The trajectory/evidence **output** digests are bound downstream by the RunResult — binding them here would be circular. |
| `TrajectoryHeader` | Content-addressed declaration: trajectory id, run ref, agent/body ref (digest), substrate ref (digest), started-at, seed. Same header ⇒ same digest. |
| `TrajectoryEntry` | One ordered step: sequence (1..n, **contiguous** — gaps/duplicates/regressions rejected), kind (`action \| observation \| checkpoint \| error \| completion`), typed payload per kind, occurred-at, and the **chained** `stepDigest` — entry N commits to entry N−1's digest; entry 1 anchors at the header digest. Mutating history changes every subsequent digest. |
| `TrajectoryRecord` | Header + entries + `chainHead` (the final digest over the full chain — the trajectory digest referenced by ENV1.0's RunAddress). Frozen at completion (append-after-complete rejected). Pure replay view. Full-chain verification. |

Entry kinds:

- `action` — an action the agent took (`actionId` + canonical-JSON input);
- `observation` — an observation received (`observationId` + channel + content;
  channel vocabulary mirrors A009's observation surface);
- `checkpoint` — an environment checkpoint reached (A010-shaped digest refs);
- `error` — an error encountered mid-run (recoverable — the run may continue);
- `completion` — the terminal entry (outcome + evidence digests); a trajectory
  with a completion entry is **frozen**.

## Envelope wiring

Wire shapes travel inside `@arena/protocol-core`'s `Envelope<T>`:
`open-trajectory-command` / `trajectory-opened-event` and
`append-trajectory-entry-command` / `trajectory-entry-appended-event`.
Commands carry a **required non-null idempotency key** (lock rule 17); the
append command carries the **digest-free** entry view so the store computes
the chained digest itself; the entry-appended event carries the store's
authoritative entry plus the resulting chain head.

## Storage neutrality

The protocol is storage-neutral (gate 7): no persistence backend is named or
implied anywhere in this package — the reference store lives in
`@arena/trajectory-store` and is in-process, pure TypeScript, zero external
runtime dependencies. Durable persistence is a deployment-tier concern.

## Layering

Runtime imports: `@arena/protocol-core` only (canonical JSON + sha256,
envelopes, branded identifiers — never reimplemented). Type-only import:
`TaskVersionRef` from `@arena/environment-protocol` (domain→domain
composition permitted by the boundary checker on this base; the runtime
guard is a local mirror). The boundary checker is green.

## Contracts

Generated contracts live at the repository root in `contracts/trajectory/`
(10 files), emitted by `scripts/generate-contracts.mjs`. The governance G9
check auto-discovers the generator through its `packages/*/scripts`
glob. Parity against this TS surface is asserted by
`src/contracts.parity.test.ts`; drift by `src/drift.test.ts`.

## Scripts

```
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (unit + property + hygiene + parity + drift)
pnpm build       # tsc -p tsconfig.build.json
pnpm contracts:generate   # regenerate contracts/trajectory/
pnpm contracts:check      # drift-check committed contracts
```
