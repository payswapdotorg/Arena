# Incident & Rollback Runbook (A036)

Operational continuation of [README.md](./README.md). This runbook
integrates the A035 operations docs
(`docs/operations/runbook.md`, `docs/operations/slo-targets.md`,
`docs/operations/alert-catalog.md`) with the A036 rollback machinery
(`ops/src/rollback.ts`, tested fail-closed in
`ops/src/rollback.test.ts`).

## Trigger matrix (mechanical — the error budget is the release authority)

| Condition | Source | Action |
|---|---|---|
| SLO verdict `breached` | A035 evaluator | **Rollback required** (`evaluateRollbackTrigger`) |
| SLO verdict `no-data` | A035 evaluator | **Rollback required** — missing telemetry is an incident, not a pass |
| Error budget `exhausted` | A35 budget | **Rollback required** |
| Zero-budget SLO with ≥1 bad event | isolation / certification-determinism / audit-chain | **Rollback required** (freeze rule) |
| Zero-budget SLO with NO evaluation in window | fail-closed | **Rollback required** |

Anything else: hold and continue the watch.

## Procedure (OPS1.0 rollback steps, in order)

1. **Freeze promotion.** No deployment leaves staging. The OPS tier
   rule mechanically rejects any promotion attempt during an open
   incident (gate evaluations cannot pass with a breached/no-data
   SLO).
2. **Page the on-call operator.** A035 alert rules
   (`slo-burn-rate` fast-burn ≥ 50 % of a 1 h budget pages;
   `slo-no-data` trips on missing telemetry).
3. **Verify the window.** Pull the failing SLO's evaluation window
   with `stream(sourceService)`. NEVER widen a window to make a
   breach disappear — the A035 evaluator rejects it mechanically
   (`OBS_INVALID_WINDOW` / `OBS_SAMPLE_OUTSIDE_WINDOW`), and
   attempting it is a policy violation.
4. **Route workloads away** from the affected service class
   (environment-runner classes: stop dispatching new runs to the
   affected class — E1 freeze rule).
5. **Restore the pinned topology.** Roll back to
   `targetTopologyId` (the DEP1.0 manifest digest the release record
   cites) and re-run health-gate evaluation over the restore window.
6. **Append the incident record** to the release lineage: a REL1.0
   NO-GO record citing the rollback decision evidence (the same
   digest chain; history is append-only — the incident never
   disappears).
7. **Lift the freeze** only when the SLO verdict returns to `met`
   AND the postmortem action items land (A035 policy 5). The error
   budget, not a human, is the release authority.

## Post-incident review checklist

- [ ] The rollback trigger reasons are archived (they are part of the
      `RollbackDecision` reasons list — cite them in the NO-GO
      record's evidence note).
- [ ] The affected SLO's window discipline is audited (no widening).
- [ ] The reference checklist (`ops/src/reference.ts`) is re-evaluated;
      any new required item discovered during the incident is added
      as a new checklist version — checklists are versioned records,
      never edited in place.
- [ ] The PERF1.0 fault-injection shape is re-run to confirm the
      pipeline still rejects SLO-violating releases (the adversarial
      battery must stay green).
