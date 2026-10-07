# @arena/expert-calibration-service

Arena **expert-calibration reference service** — Work Order **C004** (issue #111). In-process orchestration over the [`@arena/expert-calibration`](../../packages/expert-calibration) domain: calibration program lifecycle (register / record-outcome / run-verdict), pre-training tracks derived from the C003 intake gap-list and dispatched to the A017 workbench surface, and scheduled requalification checks as durable idempotent jobs on the A015 job fabric (`@arena/job-protocol` JobRecords) — over an in-memory reference store (the A015-fabric house pattern for reference services).

## Injected ports (spec/service-boundaries.md)

- `IntakeGapSourcePort` — the **C003 seam**: the typed intake gap-list the pre-training track derives from;
- `WorkbenchAssignmentPort` — the **A017 seam**: pre-training assignments are executed through the workbench surface;
- `ExpertQualificationPort` — the **A007 seam**: qualification-update and requalification **PROPOSALS** (never direct writes) + the qualification-window read the requalification check and the routing read surface evaluate.

Submissions hand proposals to the public ports — **never direct writes into another surface's state**. There is deliberately **no access-granting operation**: calibration is measurement DATA, never an authorization (lock rules 9/35); `consumeAsAuthorization` fails closed for any calibration output.

## The C002 routing read surface

`getDemonstratedPerformance` is the demonstrated-performance/freshness input the C002 routing engine consumes — a frozen, content-addressed view carrying the **typed drift verdict** (never a bare score), fresh/total sample counts and the `inForce` flag. After the qualification validity window elapses the same read reports `inForce: false` — stale demonstrated performance cannot be laundered back into routing inputs (requalification bypass defense).

## Fail-closed discipline

- cross-tenant program/track/job access → `EXPERT_CALIBRATION_TENANT_MISMATCH` (lock rule 11);
- tampered store entries → `EXPERT_CALIBRATION_TAMPERED` (every program fetch re-verifies the digest);
- backdated outcomes → `EXPERT_CALIBRATION_BACKDATED_OUTCOME`; foreign program digests are rejected;
- port faults/rejections → `EXPERT_CALIBRATION_PORT_FAILURE` (no silent partial handoff);
- commands carry REQUIRED idempotency keys — same key + same tuple replays, same key + different tuple is `EXPERT_CALIBRATION_IDEMPOTENCY_CONFLICT`;
- completed requalification jobs are terminal — they cannot be re-run;
- all operation times are caller-injected (no hidden clock — lock rule 17).

## Scripts

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
