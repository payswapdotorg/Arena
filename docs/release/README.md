# Arena Release Engineering Guide (A036)

This is the release engineering surface of Arena v1: how a built
system becomes a launched, monitored, rollback-able release. It
integrates the merged dependency surfaces — A034 security gates,
A035 SLOs/observability operations, A025 api/SDK — with the A036
operational artifacts:

| Surface | Record | What it owns |
|---|---|---|
| `deploy/` (DEP1.0) | `@arena/deploy` | Typed, versioned deployment topologies; health gates wired to the A035 SLO catalog; A034 security gates; the reference production manifest (18 services, 8 SLOs, 7 security-gated services) |
| `ops/` (OPS1.0) | `@arena/ops` | Release checklists as typed records; promotion workflows (one tier upward, fail-closed); rollback procedures driven by A035 error-budget policy |
| `release/` (REL1.0) | `@arena/release` | Launch-readiness verdicts as frozen digest-bearing records; append-only digest-chained release lineage; the fail-closed launch-readiness evaluator |
| `tests/performance/` (PERF1.0) | `@arena/performance` | Deterministic load-shape tests over the reference api fabric with SLO-based assertions and reproducible benchmark evidence |
| `docs/release/` | this guide | Versioning policy, release train process, launch-readiness review criteria, incident/rollback runbooks |

## Versioning policy

1. **Everything is a typed, versioned record.** DEP1.0 / OPS1.0 /
   REL1.0 / PERF1.0 each carry a wire `*Version` field; a record with
   an unknown version is structurally invalid (fail-closed) and is
   rejected before it can influence a decision.
2. **Release trains** are versioned `vMAJOR.MINOR.PATCH`
   (`releaseVersion` on REL1.0 records). The v1 train is
   `arena-v1-*`; its lineage lives in `release/src/records.ts`.
3. **Content addressing.** Manifests, checklists, evidence and
   records are cited by sha256 content digests over canonical JSON
   (`@arena/protocol-core` `digestCanonical`). A citation without a
   valid digest is *unsigned evidence* and is rejected
   (`REL_UNSIGNED_EVIDENCE`, `DEP` model validators).
4. **Append-only lineage.** Release history never mutates: each
   record cites its predecessor's digest; appending returns a new
   lineage value. Tampering, re-parenting, duplicates and digest
   mismatches are mechanically rejected
   (`REL_BROKEN_CHAIN`, `REL_DUPLICATE_RELEASE`,
   `REL_INVALID_RECORD`).
5. **SLO targets are frozen records** (the A035 catalog copy in
   `deploy/src/slo-catalog.ts`). Gates resolve ids against the
   catalog fail-closed: unknown ids and service mis-wiring are
   deployment errors (`DEP_UNKNOWN_SLO`,
   `DEP_SLO_SERVICE_MISMATCH`).

## Release train process

```
build (A030 benchmarks green)
→ DEP1.0 manifest built + digested (deploy/)
→ PERF1.0 suite runs (tests/performance/) — SLO-based assertions
→ OPS1.0 checklist evaluated (ops/) — required items evidenced
→ promotion dev → staging (one tier, approvals, gates)
→ staging burn-in: A035 SLOs evaluated over the live window
→ promotion staging → production (fail-closed gates)
→ REL1.0 launch-readiness decision (release/) → GO record appended
→ post-launch watch (24h) — rollback policy armed
```

Promotion rules (OPS1.0, all fail-closed):

- **One tier upward only** (`dev → staging → production`); skips and
  rollbacks-by-promotion are rejected (`OPS_TIER_SKIP`).
- Production promotion requires: checklist verdict `go`, every
  health-gate evaluation passing, security verdict `pass`, and at
  least one named approval. Missing input is never a pass.
- The launch-readiness GO requires evidence citations of every
  required kind: `health-gate-report`, `performance-evidence`,
  `security-audit`, `checklist-evaluation`, `manifest`.

## Launch readiness review criteria

A release is **GO** only when all of the following hold (see
`release/src/evaluate.ts` — the same rules run as tests):

1. **Health gates**: every wired A035 SLO evaluates `met` in the
   decision window. `at-risk` (budget burn), `breached`, and
   `no-data` all fail — missing telemetry is an incident, not a pass
   (A035 policy 3).
2. **Checklist**: every required OPS1.0 item carries digest-bearing
   evidence.
3. **Security**: A034 artifact-signature and audit-chain gates pass.
4. **Performance**: the PERF1.0 suite verdict is `pass` — the
   steady-baseline load shape meets both SLO-based assertions
   (availability ≥ 0.995 over ≥ 100 samples; latency ratio ≥ 0.95).
5. **Evidence completeness**: the GO record cites all required
   evidence kinds with valid digests.

Anything else is **NO-GO**, and the NO-GO record itself is retained
in the lineage as the audit trail (see `arena-v1-rc1`: the
fault-injection rehearsal deliberately fails the availability SLO —
proof the pipeline rejects SLO-violating releases rather than
green-lighting by default).

## Incident & rollback

See [incident-rollback-runbook.md](./incident-rollback-runbook.md).
The rollback triggers are mechanical (A035 error-budget policy):
`breached`, `no-data` and exhausted budgets force rollback; the
zero-budget SLOs (isolation, certification determinism, audit chain)
trigger on ANY bad event, and a missing evaluation for them is
itself a trigger.

## Verification battery

Per-project (each self-contained, exact pins, own lockfile):

```bash
cd deploy && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build   # 23 tests
cd ops && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build      # 24 tests
cd release && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build  # 17 tests
cd tests/performance && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build  # 12 tests
```

Root battery (governance/boundary/typecheck/lint/test/build over the
workspace) must remain green; `pnpm run contracts:generate` must
leave the tree clean.

## Known limitations

- The PERF1.0 suite asserts the **console read path** (the A025 api
  fabric serving the console edge). The remaining SLOs' gate reports
  are produced by the live A035 observability service at train time;
  the frozen reference GO record cites the two wired console SLO
  evaluations (documented in `release/src/records.ts`).
- Latency thresholds mirror A035's 300,000 ms bar: the ratio
  semantics are real, but the threshold is deliberately generous so
  verdicts are deterministic in CI. Wall-clock p50/p95 are recorded
  as evidence, never asserted.
- The A035 doc expresses three "perfect 1.00" targets; `SloDefinition`
  requires strictly-in-(0,1) ratios, so the zero-budget intent is
  encoded as 0.9999 + zero-tolerance rollback semantics (see
  `deploy/src/slo-catalog.ts`).
- Root CI (A001's workflow) runs the root battery only; the four
  A036 projects are verified per-project (commands above) — wiring
  them into CI is a Tech Lead decision (`.github/*` is A001 surface).
- Deployment descriptors are typed records + reference manifests;
  no live infrastructure provider is driven by them (v1 is the
  contract + evidence layer; provider adapters are out of scope).
