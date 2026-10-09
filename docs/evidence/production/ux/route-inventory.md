# P005 — Reconciled Route Inventory (App Router × route matrix × C-series PR bodies)

- **Work order:** P005 — Route inventory, mount completion and UX finding (issue #157)
- **Branch:** `work/P005-route-inventory` → PR pending at time of writing
- **Base:** `75bb2b4` (post-P001-merge main) · **M1:** `1bf9467` · **M2:** `215143a` · **Evidence:** this commit
- **Lineage (honest):** the original P005 worker died after pushing milestones M1 and M2 but
  before writing this inventory, running the final battery or opening the PR. A finisher worker
  (task `28-c-finisher`) verified the delivered code, built this inventory from the live tree,
  ran the full battery and opened the PR. No feature code was modified by the finisher.
- **Method:** the App Router route tree was enumerated from `apps/web/src/app/**` page/route
  files at head and cross-checked against the authoritative `next build` route table (83 rows:
  82 real routes + `/_not-found`), the route matrix (`spec/ux-route-matrix.md`, UXM1.0 §Core
  routes), the C-series PR bodies as harvested in `spec/PROJECT-STATE.md`, and the P001
  register Part 4 (`docs/architecture-review/register.md`, derived at base `5067356`).
  Nothing was guessed, silently omitted or duplicated.

---

## 1. The three P001-named surfaces and their dispositions (ADR-P001-09)

ADR-P001-09 delegates the disposition of exactly three surfaces — "route mount, nested route,
or intentionally non-UI" — to this inventory. Each disposition is recorded here:

### S-01 — the competitions web feature (`apps/web/src/competitions`, C013, PR #143, register R-054)

**Disposition: MOUNTED as a first-class route + nested detail route.**

| Served route | Mount file | Kind |
|---|---|---|
| `/competitions` | `apps/web/src/app/competitions/page.tsx` | dynamic (ƒ), thin mount over `resolveCompetitionsHomeExperience` |
| `/competitions/[id]` | `apps/web/src/app/competitions/[id]/page.tsx` | dynamic (ƒ), thin mount over `resolveCompetitionDetailExperience` |
| `/competitions` (loading) | `apps/web/src/app/competitions/loading.tsx` | honest pending state (role="status", aria-live) |

Posture: fail-closed session through the resolver seam (an unauthenticated visitor gets the
auth-required notice, never an anonymous arena); the reserved demo tenant reads the
deterministic, visibly labelled demo corpus (ADR-P001-02 truth lens); every other session
reads its own (possibly empty — honest) state; unknown ids render the honest error state, never
a fabricated competition. The two mounts carry distinct route metadata (no generic shell title).
The thin-mount house pattern (C012/C017/C021 precedent — R-027/R-063) is followed: the mounts
contain no domain logic. The resolver seam answers PR #143 Q1 ("Who mounts `/competitions`?")
conclusively: P005 does, at exactly these two paths.

### S-02 — the body-marketplace web feature (`apps/web/src/body-marketplace`, C014, PR #144, register row S-02)

**Disposition: MOUNTED as a first-class route + three nested routes, at exactly the paths the feature module declares.**

| Served route | Mount file | Kind |
|---|---|---|
| `/body-marketplace` | `apps/web/src/app/body-marketplace/page.tsx` | dynamic (ƒ), browse over `resolveBodyMarketplaceBrowseExperience`; explicit `?lens=` role-lens query state (a lens, never a permission) |
| `/body-marketplace/listings/[listingId]` | `apps/web/src/app/body-marketplace/listings/[listingId]/page.tsx` | dynamic (ƒ), listing detail (lineage, provenance, rights, substrate compatibility, version history); unknown/cross-tenant ids render the honest not-found state |
| `/body-marketplace/request-pretraining` | `apps/web/src/app/body-marketplace/request-pretraining/page.tsx` | dynamic (ƒ), consequence exposure — forbidden/unspecified training use BLOCKS the run visibly |
| `/body-marketplace/my-listings` | `apps/web/src/app/body-marketplace/my-listings/page.tsx` | dynamic (ƒ), honest empty state for a tenant with no listings yet |
| `/body-marketplace` (loading) | `apps/web/src/app/body-marketplace/loading.tsx` | honest pending state |

Posture: the mounts are thin, but S-02 required one mount-owned wiring —
`apps/web/src/app/body-marketplace/_lib/session-probe.ts` connects the feature's
`BodyMarketplaceSessionProbe` contract onto the REAL B004 session boundary
(`apps/web/src/auth/session.ts`) the same way the cockpit composition defaults its own probe:
the cookie is read through `next/headers`, validation goes THROUGH the boundary (never a client
claim), typed `AUTH_*` failures fail CLOSED to the unauthenticated outcome (auth-required
experience), and non-auth failures rethrow so the route renders its honest error state instead
of a silent downgrade. A tenant/workspace mismatch also fails closed. This closes the C014
harvest disclosure ("no app/ route mounts (outside owned surface)") at exactly the four paths
the module's own route compositions and views link to.

### S-03 — the developer-portal interactive write actions (`apps/web/src/developers`, C017, PR #135, register R-028)

**Disposition: RESOLVED with real API routes — five POST endpoints under `/developers/api/**` over the developer-platform service's own append-only key lifecycle (no domain surface invented).**

| Served route | Mount file | Action |
|---|---|---|
| `POST /developers/api/client-apps` | `apps/web/src/app/developers/api/client-apps/route.ts` | register a client app |
| `POST /developers/api/keys` | `apps/web/src/app/developers/api/keys/route.ts` | issue a scoped key (secret shown exactly once, never retrievable again) |
| `POST /developers/api/keys/rotate` | `apps/web/src/app/developers/api/keys/rotate/route.ts` | append-only active→rotated + successor secret |
| `POST /developers/api/keys/revoke` | `apps/web/src/app/developers/api/keys/revoke/route.ts` | terminal revoke, history retained |
| `POST /developers/api/sandbox/runs` | `apps/web/src/app/developers/api/sandbox/runs/route.ts` | console-triggered sandbox escalation authorized with a presented key secret (the same `sandbox:run` scope seam P003's transport binds) |

This is the posture PR #135 Q4 asked for (the R-028 disposition), delivered as the shared
composition `apps/web/src/app/developers/_lib/portal-writes.ts` (route files stay thin):

- **AUTH** — the session is resolved FIRST through the B004 boundary; an unauthenticated POST
  is a typed 401 and never writes; the tenant comes from the VALIDATED session, never the body.
- **DEMO** — the reserved demo tenant is READ-ONLY here (typed 403 `PORTAL_DEMO_READ_ONLY`);
  demo state is deterministic and never customer state (ADR-P001-02).
- **CSRF** — every portal write is POST-only and performs the house origin check
  (`apps/web/src/auth/csrf.ts`, the B004 posture) before any state is touched; strict
  same-origin (absent `Origin` rejected).
- **IDEMPOTENCY** — the C001 law at the portal boundary: a REQUIRED
  `x-arena-idempotency-key` header keyed per tenant + action; replay returns the RECORDED
  outcome verbatim with a replay marker; the same key with a DIFFERENT body is the typed
  `PORTAL_IDENTITY_CONFLICT` (409), never a silent overwrite.
- **ERRORS** — typed JSON envelopes end to end: the closed `PORTAL_*` boundary vocabulary,
  `AUTH_*`/`BOUNDARY_*` passthrough, and the developer-platform's own `DEVELOPER_*` codes with
  categories via a closed status map; no secret material in any envelope.

Host runtime: the process-singleton `DeveloperPlatformService` over the in-memory reference
fabric (local parity). The read views at `/developers/**` (page, keys, observability,
quickstart, sandbox) stay read-only — the C017 feature surface is frozen for P005; wiring the
console UI to these endpoints is a disclosed follow-up (see §6).

### Adjacent row R-084 — capability-learning conditional UI (C022, PR #149)

**Disposition: intentionally NON-UI for P-series v1.** The capability-learning compiler
(`services/capability-learning`) is a compiler, not a user surface; no web feature module was
ever built for it, so there are no routes to mount and none are invented here. It is recorded
in this inventory so the "three" count stays exact without omission (ADR-P001-09 constraints).

---

## 2. The `/tasks` finding (L-007) — disposition: FIXED

The finding: `/tasks` rendered the generic not-found/landing shell — a title identical to `/`
and no tasks-specific heading — because no `page.tsx` existed at `apps/web/src/app/tasks/`
(only `tasks/[taskId]/page.tsx` did), so the address fell through to `not-found.tsx`.

**The fix (M1, in-surface):** `apps/web/src/app/tasks/page.tsx` now renders a distinct, honest
tasks index:

- route marker `data-arena-route="tasks"` and distinct metadata title "Tasks" (no longer
  identical to the landing);
- the route matrix (UXM1.0 §Core routes) defines exactly ONE tasks surface — `/tasks/:id`, the
  task detail view opened from its case — and NO task list route; the index renders that truth
  honestly: a labelled signpost into `/cases` where tasks are created and entered, plus the
  standard design-system empty state;
- nothing is fabricated to fill the space (no invented task queue);
- `/tasks/[taskId]` is unchanged (the matrix route, a session-aware async server component
  where canonical TaskSpec records render as PROPOSALS — a proposal is not an execution).

Evidence: `apps/web/src/app/tasks/tasks-route.test.tsx` (5 tests: distinct marker/heading,
distinct metadata title, honest empty state, signpost into the case flow, detail mount
unchanged). `/tasks` compiles as static (○) in the build table.

---

## 3. Route matrix reconciliation (UXM1.0 §Core routes → served routes)

Every intended public feature of the core route matrix, and the route that serves it:

| Matrix route (UXM1.0) | Served route(s) | Rendering | Status |
|---|---|---|---|
| `/` (capability cockpit) | `/` | ƒ dynamic | served — role-aware Home/capability cockpit (B007); authenticated visitors get their role lens; unauthenticated get the first-run landing, never an anonymous cockpit |
| `/cases` | `/cases` | ƒ dynamic | served — the capability gate / case list (B008) |
| `/cases/:id` | `/cases/[recordId]` | ƒ dynamic | served — param segment named `recordId` (cosmetic divergence from the matrix's `:id`) |
| `/tasks/:id` | `/tasks/[taskId]` | ƒ dynamic | served — task detail (B008); expert-lens twin at `/expert/tasks/[id]`, demo twin at `/demo/tasks/[taskId]` |
| `/bodies` | `/bodies` | ƒ dynamic | served — body library/studio (B010) |
| `/bodies/:id` | `/bodies/[id]` | ƒ dynamic | served — body detail (adopt/inspect/build/improve) |
| `/runs/:id` | `/replay/[runKey]` | ƒ dynamic | **served under a divergent name** — see note below |
| `/research` | `/research` | ƒ dynamic | served — research queue/benchmark lab (B012) |
| `/marketplace` | `/marketplace` (+ nested `/marketplace/[family]/[id]`, `/marketplace/entitlements`) | ƒ dynamic | served — marketplace browse/offer/policy (B013) |
| `/operations` | `/operations` (+ nested `audit`, `capacity`, `jobs`, `jobs/[jobId]`) | ƒ dynamic | served — jobs/SLO/quota/audit (B014) |
| `/settings` | `/settings` | ○ static | served — profile/integrations/members |

**Matrix rows with no served route: none.** All eleven core capabilities are served. One is
served under a different name than the matrix spells it:

> **`/runs/:id` naming divergence (honest gap, recorded):** no `/runs/**` app-router route
> exists. The run-detail capability is served by the B011 replay run detail at
> `/replay/[runKey]` (and the run list at `/replay`, which itself has no matrix row). The
> served routes are session-aware (fail-closed probe, tenant-local run keys, honest not-found
> for unknown keys, explicit `?role=`/`?step=` query state). Updating the UXM1.0 matrix text
> (or adding `/runs/**` aliases) is outside P005's frozen write surfaces — the spec is
> TL-owned; recorded here as a follow-up for the TL so the matrix and the router agree on the
> name. No capability is missing.

**`/tasks` (index):** the matrix defines `/tasks/:id` only; P005 added a distinct honest index
at `/tasks` (§2) rather than leaving the address on the generic shell — an addition beyond the
matrix, recorded as such (the matrix has no `/tasks` row and none is needed for the fix).

---

## 4. Served routes present in the router but not in the route matrix

The build route table (83 rows incl. `/_not-found`) is the authoritative served census. Routes
beyond the core matrix, grouped by origin, all intentional (each is a C-series or B-series
delivered surface with its own tests — none is an accident, and none is dead):

| Group | Routes | Origin / notes |
|---|---|---|
| Case flow | `/cases/start`, `POST /cases/start/submit`, `POST /cases/[recordId]/continue` | the matrix's `/cases` capability includes starting/continuing cases; the POST endpoints are typed action routes |
| Expert lens | `/expert`, `/expert/cases`, `/expert/cases/[id]`, `/expert/tasks/[id]`, `POST /expert/tasks/[id]/evidence` | the assigned-work lens surfaces (the matrix routes select content by role; these are the expert-lens entry points behind the same session boundary) |
| Evaluation | `/evaluation`, `/evaluation/reports/[reportId]`, `/evaluation/certification/[certificationId]`, `/evaluation/verification/[verificationId]` | the evaluator surfaces (B012) |
| Replay | `/replay`, `/replay/[runKey]` | the matrix's `/runs/:id` capability (see §3 divergence note) |
| Developer portal (read) | `/developers`, `/developers/keys`, `/developers/observability`, `/developers/quickstart`, `/developers/sandbox` | C017 (PR #135), mounted read-only |
| Developer portal (writes) | `POST /developers/api/client-apps`, `POST /developers/api/keys`, `POST /developers/api/keys/rotate`, `POST /developers/api/keys/revoke`, `POST /developers/api/sandbox/runs` | **S-03 (this work order)** — §1 |
| Human data | `/human-data`, `/human-data/datasets`, `/human-data/production` | C012 (PR #145) |
| Competitions | `/competitions`, `/competitions/[id]` | **S-01 (this work order)** — §1 |
| Body marketplace | `/body-marketplace`, `/body-marketplace/listings/[listingId]`, `/body-marketplace/request-pretraining`, `/body-marketplace/my-listings` | **S-02 (this work order)** — §1 |
| Escalation ops | `/escalation-ops` | C021 (PR #150), page + honest loading |
| Tasks index | `/tasks` | **L-007 fix (this work order)** — §2 |
| Demo mirror | `/demo` + 30 nested routes (incl. `POST /demo/reset`) | the reserved demo tenant's deterministic, visibly labelled mirror of the product surfaces (ADR-P001-02); every demo page carries the demo banner |
| Quality gates | `/_not-found`, root `loading.tsx`, `error.tsx` | the standard empty/loading/error states |

**Counts:** 82 real served routes (+ `/_not-found`) — 12 static (○) and 70 dynamic (ƒ).
Of these, **14 are new in this work order** (2 competitions pages, 4 body-marketplace pages,
1 tasks index, 5 developer-portal POST routes) plus 2 `loading.tsx` files (not routes).

---

## 5. Served-route test coverage (every intended public feature)

P005 acceptance requires "served-route tests cover every intended public feature." The
coverage layers:

**New in this work order (42 tests):**

- `apps/web/src/app/competitions/competitions-mount.test.tsx` (8) — structural async mounts,
  honest loading, distinct metadata, fail-closed auth boundary (home + detail), DEMO truth lens
  visibly labelled, session-tenant honest empty state.
- `apps/web/src/app/body-marketplace/body-marketplace-mount.test.tsx` (14) — all four mounts
  as async server components, honest loading, distinct metadata, the session-probe unit suite
  (projection, label fallback, tenant/workspace mismatch fail-closed, `AUTH_*` →
  unauthenticated, non-auth rethrow) + real-boundary integration (real cookie validated through
  the real service; tampered cookie rejected), fail-closed browse, DEMO lens, honest empty
  states, `?lens=` role-lens query state.
- `apps/web/src/app/tasks/tasks-route.test.tsx` (5) — the L-007 fix record (§2).
- `apps/web/src/app/developers/api/portal-writes.test.ts` (15) — thin POST mounts, typed 401
  auth denial, demo 403, CSRF foreign/absent origin, idempotency required/replay/conflict/
  per-tenant scoping, the full register→issue→run→rotate→revoke lifecycle over the REAL
  developer-platform service, cross-tenant revoke denial (typed tenancy error), closed-scope
  rejection (a key can never mint a key), authorize-before-validate (no scenario oracle),
  tampered-secret fail-closed.

**Pre-existing layers that still hold (re-verified by the battery):**

- `apps/web/src/app/app.test.tsx` (36, 8 build-gated) — the product shell (all core nav links),
  first-run landing, every core route mounted as a session-aware async server component,
  loading/error/not-found quality gates, web runtime contract, and the `next build` output
  shape (dynamic vs prerendered per route).
- `tests/ux/route-reachability.test.ts` (7) — the composition layer (nav census — every shell
  affordance is a real route; quality-gate states) and the served layer (HTTP GET of every
  core/demo route answers 200 with its route marker under the runner; unknown routes answer 404
  with the standard empty state).
- The feature modules' own route suites (C013 `competitions-route.test.tsx`, C014
  `body-marketplace-route.test.tsx` (11), C017 `developers-route.test.tsx`, …) cover the
  composed experiences under the mounts.

---

## 6. Honest gaps, notes and disclosed limitations

1. **`/runs/:id` matrix naming divergence** (§3) — the capability is served at
   `/replay/[runKey]`; the UXM1.0 matrix text is TL-owned and not editable in P005's frozen
   surfaces. Recorded for the TL.
2. **Console UI not yet wired to the S-03 endpoints** — the `/developers/**` read views remain
   read-only (the C017 feature surface is frozen for P005: `apps/web/src/developers/**` may not
   be edited by this work order). The five POST endpoints are real, tested and documented; a
   follow-up work item should wire the console's buttons to them (fetch + typed envelope
   handling). Disclosed, not silently dropped.
3. **Idempotency memo is process-local** — replay/conflict semantics hold within the process;
   the durable idempotency store is P002's work order (work-items spec). Disclosed in the
   portal-writes source and here.
4. **Developer-platform host runtime is the in-memory reference fabric** (process singleton) —
   local parity only; the durable swap is P002. Read views and write routes share it.
5. **Demo mirror is read-only for writes** — the demo tenant is typed-403 on all portal writes
   by design (deterministic demo state, never customer state). The `/demo/reset` POST remains
   the only demo-state mutation (pre-existing, deterministic reset).
6. **Served-layer UX tests self-skip without the runner** — `tests/ux`'s served layer requires
   `ARENA_UX_BASE_URL` (the runner serves it); `apps/web`'s 8 build-output tests self-skip
   unless the build output exists (they pass 36/36 when it does — re-verified after `pnpm run
   build`). The canonical battery order (test before build) therefore reports them as skipped;
   this is orchestration, not coverage loss.
7. **The `/tasks` index is an addition beyond the matrix** (which defines `/tasks/:id` only) —
   a deliberate, honest signpost rather than a fabricated queue; recorded so the matrix
   reconciliation in §3 stays truthful.
8. **Two loading files are not routes** — `/competitions/loading.tsx` and
   `/body-marketplace/loading.tsx` (and the pre-existing `/developers`, `/escalation-ops`,
   root `loading.tsx`) render pending states for their segments; they are not counted in the
   82-route census.
9. **No lockfile, manifest or feature-module changes** — the code changes (M1+M2) touch only
   `apps/web/src/app/**` (mounts, mount-owned `_lib`, tests, one `globals.css` route-stub
   styling addition): 22 files, +1,991 lines, 0 deletions. The only further change on the
   branch is this evidence file.

---

## 7. Battery evidence (exact numbers, run from this worktree)

Battery: `pnpm run check:governance && pnpm run check:boundary && pnpm run typecheck &&
pnpm run lint && pnpm run test && pnpm run build` (pnpm 10.34.5, Node 22.22.0, turbo).
All six gates PASS; no re-runs needed; no flakes observed.

| Gate | Result |
|---|---|
| `check:governance` | PASS — `[governance] check: clean (diff base 75bb2b4…, 22 changed paths, 0 active work order(s))` |
| `check:boundary` | PASS — `[boundary] check: clean (layer rules B1-B4 hold across all workspaces)` |
| `typecheck` | PASS — 120/120 turbo tasks successful |
| `lint` | PASS — 120/120 turbo tasks successful |
| `test` | PASS — 120/120 turbo tasks successful; **726 test files passed; 8,039 tests passed, 78 skipped, 0 failed** (skips: 8 build-gated `@arena/web` — pass 36/36 post-build; 70 provider-credential-gated `@arena/hosted-adapters`, P004's domain, self-skip without provider credentials). `@arena/web`: 69 files / 671 passed / 8 skipped |
| `build` | PASS — 120/120 turbo tasks successful; `@arena/web` Next.js build emits the 83-row route table reconciled in §3–§4 |

---

## 8. Conclusion

- The route inventory is **reconciled**: every UXM1.0 core-route capability has a served route
  (one under a recorded divergent name), every served route is accounted for by group and
  origin, and no matrix row is unserved.
- The **three P001-named surfaces** each carry a recorded disposition: S-01 mounted at
  `/competitions` + `/competitions/[id]`; S-02 mounted at `/body-marketplace*` (4 routes); S-03
  resolved with real POST API routes under `/developers/api/*` with the CSRF + idempotency
  posture PR #135 Q4 specified.
- **R-084** is recorded as intentionally non-UI for P-series v1.
- **L-007 (`/tasks`) is fixed** with an honest signpost index and test evidence.
- Honest gaps are disclosed above rather than papered over; none blocks P006's dependency on
  P005 (the served route surface is complete and tested).
