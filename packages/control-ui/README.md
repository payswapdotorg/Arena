# @arena/control-ui

Arena workspace package (layer: domain — a UI-consumption package that
imports the other domain packages + @arena/protocol-core as a consumer),
delivered by Work Order A018 (customer/control-plane web console).

Vanilla TypeScript with ZERO external runtime dependencies: pure functions
producing HTML strings, served by Node's built-in `node:http` module in
`apps/web/src/console`. There is no UI framework and no server framework
in the frozen pnpm catalog — by design.

## Surfaces

- **View-models** (`src/views.ts`) — typed, DEEP-FROZEN projections of the
  domain packages' public types via digest refs (domain types referenced,
  never redefined): `CaseSummaryView`, `BodyView`, `SubstrateView`,
  `JobView`, `EnvironmentRunView`, `TrajectoryView`, `DashboardView`, plus
  the 404/405 negative views.
- **Renderers** (`src/render.ts`) — pure `(view) => string` functions, one
  per view-model + the document layout + the dashboard aggregate. Every
  dynamic interpolation goes through the shared `escapeHtml` /
  `escapeHtmlAttribute` utils (`src/escape.ts`); the stylesheet
  (`src/stylesheet.ts`) is a plain CSS string served inline (no external
  assets, no CDN).
- **Router** (`src/router.ts`) — a pure `(path, corpus) => view` router
  over hash-free, server-routed paths (`/`, `/cases`, `/bodies`,
  `/substrates`, `/jobs`, `/runs`, `/runs/:runId/trajectory`); unknown
  routes render a 404 view and mutation methods render a 405 view (the
  console is strictly read-only).
- **Corpus** (`src/corpus.ts`) — the frozen reference-dataset type
  (`ConsoleCorpus`) the console renders from, built app-side through the
  domain packages' public APIs.

## Read-only guarantee

No function in this package mutates domain state, performs I/O, reads a
clock or generates randomness: every page is derived from frozen,
content-addressed domain records, and the router serves GET/HEAD only.

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
