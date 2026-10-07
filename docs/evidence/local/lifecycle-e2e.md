# G001 evidence — lifecycle coverage via the B017 runners (fresh runs)

## product E2E — `pnpm run test:e2e` (exit 0)

```
[product-e2e] serve: next start -p 31317 … ✓ Ready in 607ms
✓ role-switch.test.ts (9 tests) 87ms
✓ lifecycle-walk.test.ts (9 tests) 140ms
✓ served-walk.test.ts (5 tests) 522ms
✓ determinism.test.ts (5 tests) 729ms
   ✓ B017 M1 — B016 seed parity: the real seed command seeds the identical corpus
     (same hash summary, same record ids, same tenant)
Test Files  4 passed (4)
     Tests  28 passed (28)
[product-e2e] cleanup: POST /demo/reset (demo state reseeded to the frozen corpus)
```

Closure-spec mapping: **representative lifecycle** = lifecycle-walk (CREATED→…→CLOSED demo walk);
**reference Bodies** = served-walk + lifecycle-walk over the seeded corpus (5 canonical records);
**role switch** = role-switch.test.ts (9 tests); **replay** = served-walk route coverage
(read-only assertions — replay never mutates live state); **evaluation/certification** =
lifecycle-walk evaluation phase + route reachability below.

## UX conformance — `pnpm run test:ux` (exit 0; 46/46)

```
[ux-battery] serve: ready on http://localhost:31318
[ux-battery] browser layer: Playwright module found — the real-browser viewport checks will run
✓ route-reachability.test.ts (7 tests) — every core and demo route answers 200 with its route marker
✓ truth-labels.test.ts (9 tests)
✓ viewport.test.ts (8 tests) — REAL headless Chromium:
    ✓ no horizontal overflow on any demo page at 390x844 and 1280x800
    ✓ the responsive shell switches zones between mobile and desktop widths
    ✓ the keyboard can reach real interactive elements with a visible focus treatment
✓ operational.test.ts (10 tests)
✓ no-raw-json.test.ts (2 tests)
✓ states.test.ts (10 tests)
Test Files  6 passed (6)  ·  Tests  46 passed (46)
```

Fresh-machine setup notes (disclosed): Playwright installed globally
(`npm install -g playwright` + `playwright install chromium`) at the runner's documented
global-prefix path, symlinked untracked into the workspace root node_modules for TS
resolution (no manifest/lockfile change — the B017 runner carries no repo playwright
dependency by law); Chromium system libraries installed via apt (standard fresh-machine step).

## product tests — `pnpm run test:product` (exit 0)

```
ok 65 - seed determinism: two fresh state directories produce identical store files
ok 66 - the seeded store satisfies the DemoStore isSeeded() port check
# tests 66  # pass 66  # fail 0
```
