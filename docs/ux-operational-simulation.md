# Arena UX <-> Operational Architecture Validation US1.0

## Purpose

Validate that the product experience remains a truthful projection of Arena's operational architecture.

This scenario simulation complements, but does not replace, automated E2E tests.

## Scenario 1 — Owner discovers a capability gap

UX:
Home -> Find what your agent cannot do -> Capability Case.

Operational truth:
The case is a canonical CapabilityCaseRef created from actual evidence or an explicitly labelled demo.

Pass:
No fabricated capability gap appears as verified fact.

## Scenario 2 — Owner switches to Expert

UX:
Persistent role switcher -> Expert.

Operational truth:
Role changes presentation/workflow context. Permission remains policy-controlled.

Pass:
Role switching cannot grant authority.

## Scenario 3 — Expert performs work

UX:
Assigned task -> instrumented workbench -> submit result/evidence.

Operational truth:
TaskSpec, EnvironmentRun, Trajectory, Evaluation and Verification remain separate objects.

Pass:
Timeline distinguishes human action, environment observation, evaluation result and verified evidence.

## Scenario 4 — Builder improves a Body

UX:
Agent Builder -> Body Studio -> inspect missing skill -> propose next Body version -> test possession.

Operational truth:
Body Versions are immutable. A material professional change creates a new version.

Pass:
The UI keeps Body, Substrate and Possession visibly distinct.

## Scenario 5 — Researcher compares substrates

UX:
Research -> body/substrate comparison matrix.

Operational truth:
Compatibility and certification records are composition-scoped.

Pass:
The UI never claims that a base model is itself the profession.

## Scenario 6 — Operator diagnoses failure

UX:
Operations -> incident -> job -> run -> trajectory/evidence.

Operational truth:
Jobs are asynchronous and telemetry is versioned.

Pass:
No pending state is presented as completed.

## Scenario 7 — Marketplace transaction

UX:
Artifact -> provenance/verification -> offer -> grant/entitlement -> usage.

Operational truth:
Publication, certification, rights, entitlement and usage are separate concerns.

Pass:
Purchased does not mean certified.

## Scenario 8 — Free-tier exhaustion

UX:
Visible capacity state -> blocked/degraded action -> explanation and reset/upgrade path.

Operational truth:
Provider adapter returns EXHAUSTED and does not cross the paid boundary.

Pass:
No silent billable fallback.

## Design changes required by the simulation

1. Replace the old diagnostics-first home with an action-oriented capability cockpit.
2. Make the role switcher persistent.
3. Render canonical objects through role-specific projections.
4. Use a visible evidence/state taxonomy: verified, pending, simulated, expert judgment, model output, unknown.
5. Make environment replay clearly distinct from committing real-world actions.
6. Keep marketplace and certification visually separate.
7. Surface free-tier capacity as product state.
8. Make deterministic Demo mode a first-class first-run path.
9. Preserve context on role switch without changing permissions.
10. Never use a score/badge as a substitute for evidence or authorization.

## Result

The UX architecture is operationally consistent after these changes and becomes normative for the B-series.
