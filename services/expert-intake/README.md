# @arena/expert-intake-service

Arena **expert-intake reference service** — Work Order **C003** (issue #110). In-process orchestration over the [`@arena/expert-intake`](../../packages/expert-intake) engine: the start / resume / abandon / timeout / submit / assess interview operations, durable through an in-memory session store (the reference-fabric house pattern — the A015-backed deployment fabric replaces it behind the same seams).

## Injected ports (spec/service-boundaries.md)

- `ExpertRegistryProposalPort` — the **A006 public port** intake submits registry-field proposals against;
- `QualificationClaimPort` — the **A007 public port** intake submits qualification claim candidates against;
- the interviewer **model adapter** (`InterviewerModelPort`, lock rule 10 — the scripted reference implementation by default).

Submissions hand the `IntakeProfile` to the public ports — **never direct writes into another surface's state**. There is deliberately **no access-granting operation**: claims are input to qualification, never an access grant (lock rules 9/35).

## Fail-closed discipline

- cross-tenant transcript/session access → `EXPERT_INTAKE_TENANT_MISMATCH`;
- tampered store entries → `EXPERT_INTAKE_TAMPERED` (every fetch re-verifies the session digest);
- port faults/rejections → `EXPERT_INTAKE_PORT_FAILURE` (no silent partial handoff);
- commands carry REQUIRED idempotency keys — same key + same tuple replays, same key + different tuple is `EXPERT_INTAKE_IDEMPOTENCY_CONFLICT`;
- all operation times are caller-injected (no hidden clock — lock rule 17).

## Demo

```
cd services/expert-intake && pnpm demo
```

Drives one deterministic end-to-end scenario against the real engine + port fakes: start command → adaptive ask/answer loop with inspectable selection rationales → submit → assess → IntakeProfile handoff → negative probes (cross-tenant, idempotency conflict) → observability dump.

## Scripts

```
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint .
pnpm run test        # vitest run
pnpm run build       # tsc -p tsconfig.build.json
```
