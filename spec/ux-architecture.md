# Arena UX Architecture UX1.0

## Design inspiration

ShareNet is used as a reference for a few product principles visible in its implementation:

- lightweight onboarding;
- a calm visual hierarchy;
- one primary action at a time;
- progressive disclosure;
- clear status communication;
- generous whitespace;
- compact secondary facts;
- accessible motion with reduced-motion handling.

Arena must not copy ShareNet's consumer semantics or visual identity. Arena's domain is substantially richer and needs a workspace-oriented interaction model.

## UX north star

> Make professional AI capability feel inspectable and playable without hiding the engineering underneath.

A new user should be able to explore an Agent Body, watch a task move through an environment, inspect a trajectory, see why evaluation/verification reached a result, and understand how that experience becomes a capability.

## Shell

### Level 0 — First run

A calm three-step introduction:

1. What Arena is.
2. What an Agent Body is.
3. Start with a guided scenario.

CTA:
```
Explore a capability
```

### Level 1 — Workspace shell

Persistent:

- Arena mark/name;
- workspace selector;
- role switcher;
- global search/command;
- notifications/jobs;
- user/profile;
- contextual navigation.

The shell is deliberately less dense than a conventional enterprise console.

### Level 2 — Work surface

Default composition:

```
┌─────────────────────────────────────────────────────────────┐
│ Workspace   Role   Search   Jobs   Profile                 │
├────────────┬───────────────────────────────────────┬────────┤
│ Context    │ Main stage                            │ Inspect│
│ navigation │                                       │ or     │
│            │ visual task/workflow                   │ next   │
│            │                                       │ action │
└────────────┴───────────────────────────────────────┴────────┘
```

On mobile the inspector becomes a bottom sheet / secondary tab.

## Home / capability cockpit

The home surface should answer:

- What am I working on?
- What changed?
- What needs my attention?
- What can Arena help me accomplish next?

Do not make a giant KPI wall the default.

Hero actions should be role-specific.

Example Owner:
```
Find what your agent can't do yet
```

Example Builder:
```
Improve an Agent Body
```

Example Expert:
```
Review assigned work
```

Example Researcher:
```
Run a capability experiment
```

## Visual workflow

Use a persistent “capability path” when appropriate:

```
Case → Task → Environment → Trajectory → Evaluation → Verification → Learning → Body → Certification → Release
```

Completed/available/blocked states are visualized, but the UI never implies completion before the backend evidence exists.

## Inspector

Every complex object has an inspector with:

- identity/version;
- status;
- owner/tenant;
- provenance;
- dependencies;
- evidence;
- next actions;
- limitations.

Advanced details live behind expandable sections.

## Guided work

Use task-oriented entry points rather than requiring users to understand the data model first.

Examples:

- “Teach this capability”
- “Review an expert result”
- “Test this Agent Body”
- “Compare substrates”
- “Publish a verified capability”
- “Investigate a failure”

The task model then maps to canonical contracts behind the scenes.

## Agent Body visualization

Show:

```
BODY
  Role
  Mission
  Skills
  Knowledge
  Tools
  Procedures
  Policies
  Verification
  Evaluation
  Environment requirements
       │
       ▼
POSSESSION
  Cognitive Substrate
  Runtime
  Environment
       │
       ▼
CERTIFICATION
```

The visualization must reinforce:

```
Body ≠ Model
```

## Capability graph

Do not expose a raw graph database view first.

Default view is an explorable capability map with:

- “You have”;
- “You are missing”;
- “Evidence”;
- “How to improve”.

Advanced users can open the full graph.

## Environment/workbench

The workbench should feel like an instrumented workspace rather than a dashboard.

Show:

- world/task state;
- current agent;
- human/agent ownership;
- tools;
- action history;
- timeline;
- evidence;
- evaluator/verifier state.

A user can replay a run like a game while retaining access to engineering evidence.

## Marketplace

Artifact listings should visually separate:

- what it is;
- what capability it supports;
- how it was created;
- verification;
- provenance;
- license/data rights;
- compatibility;
- price/usage entitlement.

Do not use star ratings as a substitute for certification/evidence.

## Motion

Motion communicates:

- transition;
- state change;
- cause/effect;
- replay.

Respect `prefers-reduced-motion`.

## Creative latitude

Workers may innovate on:

- composition;
- visualization;
- animation;
- micro-interactions;
- metaphor;
- progressive disclosure.

Workers may not change:

- canonical object meaning;
- lifecycle transitions;
- authority boundaries;
- role/permission semantics;
- provenance meaning;
- certification scope;
- tenancy rules.

## UX quality gates

Every major route must have:

- loading;
- empty;
- error;
- permission-denied;
- demo-data;
- success;
- stale-data states where applicable.

Every destructive/consequential action must expose the consequence and required authority.

## Demo mode

Demo data must be deterministic and visibly labeled.

The demo can be reset.

The demo must be able to walk a user through at least:

```
Capability Case
→ Software Engineer Body
→ Task
→ Environment
→ Trajectory
→ Evaluation
→ Verification
→ Compatibility
→ Certification
→ Release
```

## Measurement

Instrument:

- onboarding completion;
- time to first meaningful action;
- role-switch success;
- workflow abandonment;
- error rate;
- task completion;
- demo reset/use;
- key-screen load time.

Product analytics must respect tenant and privacy policy.
