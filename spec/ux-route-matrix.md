# Arena UX Route Matrix UXM1.0

## Shared shell

Every authenticated route or demo route receives:
- workspace selector;
- active role switcher;
- global search/command;
- job/activity indicator;
- profile;
- contextual navigation.

The active role is a UI context. Permission checks remain server-side/policy-driven.

## Core routes

| Route | Owner | Builder | Expert | Evaluator | Researcher | Operator | Marketplace | Admin |
|---|---|---|---|---|---|---|---|---|
| / | capability cockpit | capability cockpit | assigned work | evaluation queue | research queue | health summary | discovery | admin summary |
| /cases | outcome/cases | capability gaps | assigned cases | evaluation implications | failure clusters | job health | — | audit scope |
| /cases/:id | outcome lens | capability lens | work lens | measurement lens | hypothesis lens | operations lens | — | policy lens |
| /tasks/:id | task outcome | task design | execute/review | rubric | benchmark | run health | — | policy |
| /bodies | used bodies | body library | expertise context | tested bodies | study population | runtime health | available releases | governance |
| /bodies/:id | adopt/inspect | build/improve | review | certify | compare | runtime | license/offer | policy |
| /replay | run history | debug stream | replayable work | evaluation history | analysis runs | job runs | — | audit index |
| /replay/[runKey] | outcome | debug | work replay | evaluation | analysis | incident | — | audit |
| /research | — | experiments | — | suites | benchmark lab | — | public research | — |
| /marketplace | browse | publish/use | sell expertise | publish evaluator | publish dataset | — | buy/sell | policy |
| /operations | — | — | — | — | — | jobs/SLO/quota | — | audit |
| /settings | profile | integrations | profile/rights | profile | profile | operations | billing | members/policy |

## Design rule

The route is a capability of the shell, not a role-specific application.

Role context selects:
- landing content;
- primary action;
- navigation emphasis;
- object projection;
- recommendations.

It does not create alternate domain contracts.

## Responsive rule

Desktop:
- left context rail;
- main work area;
- optional inspector.

Tablet:
- collapsible rail;
- main work area;
- inspector as sheet.

Mobile:
- top role/workspace bar;
- main content;
- bottom navigation or compact rail;
- inspector as bottom sheet;
- critical actions fixed near the work surface when safe.

## State semantics

Use shared visual vocabulary for:
- verified;
- evidence;
- expert judgment;
- model output;
- simulation;
- evaluation;
- certification;
- suggestion/hypothesis;
- demo.

The UI must not represent these as equivalent badges.

## Revision notes

- **UXM1.0-r1 (2026-10-09):** run-detail row reconciled with the served router —
  `/runs/:id` renamed to `/replay/[runKey]`, and the `/replay` run-list row added
  (it previously had no matrix row). Capability cells unchanged; no route was added,
  removed, or re-pointed. Closes findings-register F-06 (naming drift only — no
  missing capability; origin: P005 route-inventory §3 divergence note, run list
  served at `/replay`, detail at `/replay/[runKey]`).
