# @arena/workbench

Arena workspace package (layer: domain — a UI-consumption package that
imports the rendered domain packages + @arena/protocol-core as a
consumer), delivered by Work Order A017 (Expert Workbench; requirements
R7/R8 qualification + matching UX, R10 trajectory visibility, R26 async
jobs visibility, R41 graceful degradation).

Vanilla TypeScript with ZERO external runtime dependencies: pure
functions producing HTML strings, served by Node's built-in `node:http`
module in `apps/web/src/workbench`. This replicates the A018
control-ui house pattern exactly — there is no UI framework and no
server framework in the frozen pnpm catalog, by design.

## Surfaces

- **View-models** (`src/views.ts`) — typed, DEEP-FROZEN projections of
  the domain packages' public types via digest refs (domain types
  referenced, never redefined): `ExpertDirectoryView` (A006 profiles
  joined with A007 qualification states), `TaskQueueView` (A008
  TaskSpecs + compilation records + A007 match outcomes — the matching
  UX), `TrajectoryFeedView` / `TrajectoryDetailView` (A011 records,
  read-only), `JobStatusView` (A015 jobs/events), the
  `WorkbenchOverviewView` aggregate, and the 404/405 negative views.
- **Degradation** (`src/degradation.ts`) — the R41 model: EVERY
  view-model carries an explicit `degradation: DegradationState` with
  machine-readable reasons from a closed vocabulary. A degraded view
  renders its LAST-KNOWN records plus the banner + refresh affordance
  and NEVER invents data (an unavailable supply with no snapshot
  renders an honest empty listing).
- **Renderers** (`src/render.ts`) — pure `(view) => string` functions,
  one per view-model + the document layout + the degradation banner.
  Every dynamic interpolation goes through the shared `escapeHtml` /
  `escapeHtmlAttribute` utils (`src/escape.ts`); the stylesheet
  (`src/stylesheet.ts`) is a plain CSS string served inline (no external
  assets, no CDN, no scripts).
- **Router** (`src/router.ts`) — a pure `(path, corpus) => view` router
  over hash-free, server-routed paths (`/`, `/experts`, `/tasks`,
  `/trajectories`, `/trajectories/:trajectoryId`, `/jobs`); unknown
  routes render a 404 view and mutation methods render a 405 view (the
  workbench is strictly read-only).
- **Corpus** (`src/corpus.ts`) — the frozen reference-dataset type
  (`WorkbenchCorpus`) the workbench renders from, with the per-section
  supply states that drive degradation; built app-side through the
  domain packages' public APIs (and the reference service fabrics).
- **Typed errors** (`src/errors.ts`) — the closed `workbench/*` code
  vocabulary; malformed domain objects fail CLOSED with a
  `WorkbenchError` naming the surface and index (never a crash, never a
  silently empty page).

## Dependency posture (disclosed)

`dependencies`: `@arena/protocol-core`, `@arena/expert-registry`,
`@arena/expert-qualification`, `@arena/task-spec`, `@arena/trajectory`,
`@arena/job-protocol` — all `workspace:*`, ZERO external runtime
dependencies. devDependencies are all `catalog:`.

- `@arena/protocol-core` runtime use is confined to the INTERNAL test
  fixture builder (branded id constructors); the public surface only
  type-references it.
- The five domain packages are consumed **type-only** EXCEPT for a
  closed allow-list of their exported structural guard predicates
  (`isExpertProfile`, `isCompetencyClaim`, `isQualificationRecord`,
  `isMatchResult`, `isTaskSpec`, `isCompilationRecord`,
  `isTrajectoryRecord`, `isJobRecord`) in `views.ts`: this is the
  disclosed, deliberate deviation from the pure type-only A018
  discipline — it lets the malformed-domain-object boundary REUSE the
  domain packages' own validation instead of reimplementing it. The
  hygiene suite (`src/hygiene.test.ts`) enforces exactly this posture
  (including that `@arena/web`'s frozen manifest is untouched and the
  package adds no dependency beyond the disclosed set).

## Read-only guarantee

No function in this package mutates domain state, performs I/O, reads a
clock or generates randomness: every page is derived from frozen,
content-addressed domain records, and the router serves GET/HEAD only.
Rendering the entire surface (including mutation attempts) leaves the
corpus byte-identical — asserted by `src/readonly.test.ts`.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).
