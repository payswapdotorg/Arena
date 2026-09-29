# Arena Expert Workbench — app route layer (A017)

The route layer of the Expert Workbench (Work Order A017): a read-only
`node:http` server serving the pages rendered by `@arena/workbench`,
plus the seeded reference corpus that instantiates the domain records
through the domain packages' public APIs and the reference service
fabrics. This mirrors `apps/web/src/console` (A018) exactly — the house
pattern for web surfaces.

## Files

- **`server.ts`** — the transport: Node's built-in `node:http` module
  (ZERO external runtime dependencies). The pure handler from
  `@arena/workbench` is INJECTED (the `@arena/web` manifest is frozen at
  `@arena/protocol-core` only, and the app-level tsconfig cannot emit a
  compiled-in module graph that reaches other workspaces — same
  architectural note as the console). Owns HTTP concerns only:
  request-path normalization, status/content-type/allow headers, HEAD
  suppression, fail-closed 500.
- **`main.mjs`** — the bootstrap: registers the `.js` → `.ts` resolution
  shim (`module.registerHooks` on Node ≥ 22.15, `module.register` before
  that), dynamically imports the corpus builder + the pure router +
  the transport, wires them together and serves. Programmatic entry:
  `startWorkbench({ port, host, expertSupply })`.
- **`loader.mjs`** — the `.js` → `.ts` resolution shim (Node built-ins
  only).
- **`corpus.mjs`** — the seeded reference corpus (JavaScript edition;
  see the header comment for why .mjs). Builds, deterministically:
  2 expert registry profiles (published + suspended, admitted through
  the registry's audit flow and read back through its tenant-scoped
  query API), the full A007 qualification + matching flow through the
  expert-matching REFERENCE FABRIC (evidence, claims, policy, idempotent
  qualify-claim command runs, and two match outcomes through the real
  engine — one clean match, one partial with explicit closed-vocabulary
  unmatched reasons), 2 TaskSpecs + 2 compilation records (A008), 2
  trajectory records with full digest-chained entry chains (A011), and
  3 durable jobs through the job-orchestrator REFERENCE FLOW (A015:
  succeeded-with-progress, failed, queued).
- **`corpus.d.mts`** — the self-contained type surface for the .mjs
  builder (the precise `WorkbenchCorpus` shape is asserted at the typed
  test boundary).
- **`workbench.test.ts`** — the end-to-end suite: corpus content gates,
  byte-determinism, sha256 GOLDEN HTML per route (including the
  degraded-directory golden), R41 degradation behavior, the read-only
  guarantee, no-secrets negatives, transport behavior, and REAL
  node:http round-trips on ephemeral ports (healthy + degraded).

## Running

```bash
# from the repository root, Node >= 22.6 (type stripping):
node --experimental-strip-types apps/web/src/workbench/main.mjs

# environment:
#   ARENA_WORKBENCH_PORT            listen port (default 8788)
#   ARENA_WORKBENCH_EXPERT_SUPPLY   'down' boots the R41 degraded mode
```

Routes (read-only — GET/HEAD only; every mutation method answers 405):

```
/                             overview (aggregate + degradation rollup)
/experts                      expert directory (A006 + A007 states)
/tasks                        task queue (A008 + A007 match outcomes)
/trajectories                 trajectory feed (A011, read-only)
/trajectories/:trajectoryId   one trajectory, drilled down
/jobs                         job status (A015)
```

## Degradation (R41)

`buildWorkbenchCorpus({ expertSupply: 'down' })` (or
`ARENA_WORKBENCH_EXPERT_SUPPLY=down`) marks the expert supply
unavailable: the directory then serves its LAST-KNOWN state under the
degradation banner with the refresh affordance. No data is ever
invented; with no last-known state the directory renders an honestly
empty listing.
