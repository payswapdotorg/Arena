# @arena/expert-environment-adapters

Arena expert-environment **adapter** (Work Order C006; issue #113; `spec/expert-environment-session.md` **EES1.0**).

Materializes bounded `ExpertSessionCapsule`s against the **A009 environment protocol vocabulary** (`@arena/environment-protocol`) with a **deterministic in-memory reference implementation** for tests/demo:

- `executionCapsuleSourceFromDefinition` — builds the `ExecutionCapsuleSource` view of an `EnvironmentDefinition`:
  - **tool availability** ← the declared `actionSurface` (undeclared tools are unreachable by construction);
  - **files/data** ← the `filesystemPolicy` mounts, with read-only mounts becoming read-only capsule resources and mounts whose source addresses the host's **live world never replicating** (lock rule 28);
  - **secret/tool exclusion** ← injection points mounted under the `tools/` namespace bind a tool by id; those tools are excluded from the expert surface (EES1.0 secret/tool exclusion);
  - the A009 content digest travels as the capsule's environment provenance.
- `ExpertEnvironmentMaterializer` — implements the `services/expert-session` **CapsuleMaterializer port structurally** (duck-typed; zero imports of service internals — boundary rule B4's approved downward edge). Derives the EES1.0 privacy barrier from the escalation's declared policy fields (PII redaction, identity masking, deadline-bounded time-limited credentials, export restrictions ON) plus host-declared redactions/exclusions, then delegates to the pure domain derivation. **Deterministic**: same inputs ⇒ same capsule digest.

Hosts wire `new ExpertEnvironmentMaterializer(hostOptions)` into the `ExpertSessionService` config; the A010 environment-runner remains the execution authority — this adapter only derives the capsule view.

## Scripts

```
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run
pnpm build       # tsc -p tsconfig.build.json
```
