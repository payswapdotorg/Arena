# Demo Mode — Reference Narrative & Contracts (B006)

Work Order B006 (issue #73). This document is the full reference
narrative for the guided first-run demo — the story the demo landing at
`/demo` tells — mapped step-by-step to corpus records and product-truth
labels, plus the reset / determinism / labelling contracts that govern
every demo surface.

**The governing product truth: demo state is NOT customer state.** It is
always visibly labelled, deterministic, resettable, zero-credential, and
read through the B005 canonical read path under a reserved demo tenant.

## Contracts

### Determinism

- No randomness and no wall-clock anywhere in the corpus or render
  paths. The single "time" of the demo story is the fixed narrative
  constant `DEMO_NARRATIVE_TIME_ISO = 2026-10-01T08:00:00.000Z`;
  record provenance is stamped at the fixed `DEMO_NARRATIVE_EPOCH_MS`.
- All record ids are derived deterministically:
  `demo.<kind>.<stable-slug>` (the B002 record-id charset forbids `:`).
- The corpus hash is computed over canonical JSON and exported
  (`computeDemoCorpusHash()` in `@arena/demo`); two constructions, two
  seeds, or a seed → reset → seed cycle all produce the identical hash.
- The demo landing renders byte-identically on every load for a given
  `?role=` lens (query-driven explicit state is the only variant
  selector).

### Reset

`POST /demo/reset` drops the demo corpus and reseeds it. The store
returns to the identical corpus hash — reset is deterministic, never a
re-roll. The reset affordance is part of the labelling contract so it
cannot drift.

### Labelling (the exported contract, `DEMO_LABELLING`)

| Constant | Text |
| --- | --- |
| `DEMO_BANNER_TITLE` | `Demo mode` |
| `DEMO_BANNER_TEXT` | `Demo state is not customer state. Everything here is a deterministic, resettable replay.` |
| `DEMO_BADGE_TEXT` / `DEMO_BADGE_NOTE` | `Demo data` / `deterministic seed` |
| `DEMO_RESET_LABEL` | `Reset demo` |
| `DEMO_RESET_HINT` | `Reset drops the demo workspace and reseeds it to the identical corpus hash.` |

Every demo-rendered datum displays BOTH its demo-data badge and its
product-truth badge, with distinct visual semantics per label
(`@arena/ui-platform` truth treatments — no two labels render alike).

### Scope

Every demo record lives under the reserved demo tenant `arena-demo`.
Demo reads go through the B005 canonical read path
(`ReadModelService` → `CanonicalReadModel` port); there is no parallel
demo-only API. Any demo-state request outside the demo tenant surface
fails with the typed `DEMO_SCOPE_VIOLATION` error.

### Zero credentials

The demo session is composed through the B004 local/fake wiring
(`createLocalAuthStack`) with ONE caller-registered demo credential and
a fixed demo-only session secret (never a customer secret). A fresh
browser enters `/demo` with no provider credentials of any kind.

## The corpus (5 canonical records)

| Record id | Kind | Derived from |
| --- | --- | --- |
| `demo.agent-body.software-engineer` | `agent-body` | A028 software-engineer reference body |
| `demo.agent-body.structural-engineer` | `agent-body` | A029 structural-engineer reference body |
| `demo.capability-case.payments-reliability` | `capability-case` | The narrative case (tasks, trajectory, evaluation, verification, epoch) |
| `demo.certification.software-engineer-v1-1-0` | `certification` | Body release certification |
| `demo.expert-qualification.structural-review` | `expert-qualification` | Expert judgment record |

## The narrative, step by step

Canonical order (owner lens). Each step lists its product-truth label and
the canonical read(s) it points at.

### 1. Welcome to a demo workspace — **verified fact**

> This is Arena in demo mode: a deterministic, resettable walkthrough of
> one workspace. Nothing here is customer state, no credentials were
> needed to enter, and every datum is labelled with the kind of truth it
> is.

Reads: `capability-case` / `demo.capability-case.payments-reliability`.

### 2. An Agent Body, as data — **verified fact**

> This is the software-engineer reference body: a versioned manifest of
> skills, knowledge, tools and procedures — not a person, and not a
> running process. Its possessions live on a substrate, and substrate
> access is composition-scoped.

Reads: `agent-body` / `demo.agent-body.software-engineer` (focus:
manifest summary) and `demo.agent-body.structural-engineer`.

### 3. A task run, replayed — **simulation replay**

> Here is one capability case and its task run: what the body observed,
> which tool it used, and what came back. The timeline distinguishes
> observation, action, tool and result. This is a replay of a recorded
> run — it is not a live mutation of anything.

Reads: `capability-case` / `demo.capability-case.payments-reliability`
(focus: trajectory — 5 events: observation → action → tool
(`repo-navigator`) → result → model output).

### 4. What the model proposed — **model output**

> The body proposed a change: jittered exponential backoff instead of a
> fixed retry interval. A proposal from a model is a model output — a
> draft to review, not a verified fact about the code.

Reads: `capability-case` / `demo.capability-case.payments-reliability`
(focus: trajectory, step 5).

### 5. Evaluation: did the body meet its suite? — **evaluation result**

> Evaluation checks the body against its declared evaluation suite. Here
> the suite passed and regression tests were added. Evaluation is its own
> concept — it is not verification, and it is not certification.

Reads: `capability-case` / `demo.capability-case.payments-reliability`
(focus: evaluation — suite pass, regression tests added).

### 6. Verification: independent checks — **evidence**

> Verification re-ran the regression tests in a clean environment and a
> second reviewer inspected the diff. These are the recorded checks —
> evidence, carried as evidence, not as a claim.

Reads: `capability-case` / `demo.capability-case.payments-reliability`
(focus: verification — 2 recorded checks).

### 7. The Epoch learning loop, in one breath — **suggestion**

> When a run produces something worth keeping, the Epoch loop suggests a
> skill draft — and admission requires experiment evidence. The
> suggestion below stays a suggestion until it earns its evidence.
> Nothing is silently learned.

Reads: `capability-case` / `demo.capability-case.payments-reliability`
(focus: epoch — skill draft `suggestion-jittered-backoff`, status
"suggested (not admitted)").

### 8. Certification: a distinct milestone — **certification**

> Because evaluation passed and independent verification passed, the
> body version was certified for release. Certification is a milestone
> with its own basis — never a side effect of a good evaluation alone.

Reads: `certification` / `demo.certification.software-engineer-v1-1-0`.

### 9. Explore by role — **expert judgment**

> Arena reads differently depending on who you are: an owner asks what
> is happening and what it costs; an agent-builder asks how bodies are
> put together; an expert asks where their judgment is needed. Pick a
> role lens above — the same labelled truth, from your angle.

Reads: `expert-qualification` /
`demo.expert-qualification.structural-review` and `capability-case` /
`demo.capability-case.payments-reliability`.

## Role lenses

The same nine steps, role-ordered, mapped onto B003 reference roles:

| Lens | B003 role | Intro |
| --- | --- | --- |
| Owner (default) | `owner` | As the workspace owner you want the honest state of one case, what was verified, and what it cost — with nothing presented as more certain than it is. |
| Agent-builder | `agent-builder` | As the agent-builder you care how the body is assembled, what it proposed, and how the Epoch loop turns runs into skill drafts. |
| Expert | `expert` | As the domain expert you care where your judgment is recorded, what evidence backs each claim, and which verification checks you could repeat. |

## Lifecycle

- `seed()` — idempotent; re-running produces the identical corpus.
- `reset()` — drops and reseeds; identical corpus hash.
- `isSeeded()` — true iff every corpus record is present.
- The `DemoStore` port is defined over the B002
  `ControlPlaneRepository`, so the in-memory fake shipped today can be
  replaced by a hosted adapter later (B015 wiring) without changing the
  demo surfaces.
