# @arena/replay-ui

The reusable view model for the Arena environment/trajectory **replay
viewer** (Work Order **B011**, issue #86).

Pure, deterministic, frozen-data-driven projections of canonical
trajectory / environment-runtime / evaluation / verification objects into
the shapes the replay surface renders. This package adds **no runtime
authority** and invents **no parallel domain model**: every payload is
validated through the sibling protocol packages' **public guards**
(`isTrajectoryRecord`, `isRuntimeEvent`, `isRunRecord`, `isRunResult`,
`isEvaluationRecord`, `isVerificationRecord`) and projected honestly.

## Product truths carried structurally

- **Replay is observational** — the viewer never issues world-changing
  actions; there is no "re-run against live" affordance anywhere in this
  model (`REPLAY_OBSERVATIONAL_NOTE`).
- **A replayed trajectory step is SIMULATION-REPLAY, never "result"**
  (`REPLAY_STEP_TRUTH_CLASS`); every linked artifact renders under its
  OWN truth class from the closed B003 taxonomy — evidence addresses as
  `evidence`, evaluation records as `evaluation-result`, decided
  verification outcomes as `verified-fact`, undecided ones as `unknown`.
- **Honest gaps are first-class**: missing sequence numbers render as
  `no-data` markers; unreadable entries render as `unknown` rows; a
  structurally consistent trajectory without a completion entry is
  `pending` (in flight — never guessed); malformed payloads degrade
  visibly and NEVER crash (`toReplayTimeline` is total and
  never-throwing).
- **Wall-clock vs logical ordering is explicit**: every step carries its
  `occurredAt` AND its chain sequence; same-timestamp steps are flagged
  and the LOGICAL order is authoritative.
- **Role context is a lens, never an authorization**: eight B003
  reference-role lenses (`REPLAY_ROLE_LENSES`) plus the truthful
  granted / not-granted active-role resolution.

## Surface map

| Module | Renders |
| --- | --- |
| `truth.ts` | Truth classes + the observational / not-a-result notes |
| `timeline.ts` | The trajectory timeline (steps, gaps, ordering, chain verification helper) |
| `event-stream.ts` | The A010 environment event stream (step linkage, stream states) |
| `linkage.ts` | Evidence addresses + evaluation/verification result linkage |
| `inspection.ts` | Step selection + per-step I/O + run record/result summaries |
| `run-list.ts` | The run list (deterministic order, bounded pages, continuation tokens) |
| `role-lens.ts` | The eight role lenses + active-role resolution |
| `fixtures.ts` | The deterministic demo corpus (real protocol objects) |

Zero app dependencies (enforced by the boundary checker: domain-package
posture — only sibling domain/protocol packages).
