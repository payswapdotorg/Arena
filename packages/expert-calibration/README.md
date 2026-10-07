# @arena/expert-calibration

Arena **expert calibration** — Work Order **C004** (issue #111) — the quality flywheel of the expert network. Pure domain package; the reference service lives in [`services/expert-calibration`](../../services/expert-calibration).

## Surfaces

- **`CalibrationProgram`** — a versioned, content-addressed composition of calibration probes per capability (A004 vocabulary via the C003/A007 `CapabilityNodeRefView` seam). Each probe is PINNED to evaluator/verifier criteria (id + version + criteria digest) with a DECLARED minimum evidence requirement in the A007 evidence-kind vocabulary (EV1.0 Certification Suite discipline). Deterministic seeded probe ordering — reproducible given identical inputs.
- **`CalibrationRecord`** — predicted confidence/score vs **later-observed** outcome per LE1.0 Calibration, with the applicability context (capability, domain, pinned environment versions) **preserved**, never implied. Append-only (supersedes chains, lock rule 6), content-addressed; backdated outcome injection fails closed (`EXPERT_CALIBRATION_BACKDATED_OUTCOME`).
- **`DriftVerdict`** — TYPED verdicts: `calibrated / overconfident / underconfident / insufficient-sample / stale` — **never a bare score**. Pure derivation with deterministic seeded record ordering; plus a Brier-score diagnostic (audit view, never a capability claim).
- **`PreTrainingTrack`** — gap-filling assignments derived from the C003 typed intake gap-list for execution through the A017 workbench surface (workbench task descriptors are pure data). Explicit `not-yet` / `pre-trained` assignment states; completing pre-training **PROPOSES** a qualification update to A007 (`buildQualificationUpdateProposal` — the C003 claim-candidate input shape). It never writes A007 records directly.
- **`RequalificationPolicy` + `RequalificationProposal`** — freshness/validity windows + the closed trigger vocabulary (`time-window-elapsed`, `drift-verdict`, `domain-pack-change`, `dispute-raised`); expiry produces a typed status-transition proposal in the A007 vocabulary (`expired` / `stale` / `revoked`). Quality-model REVOKED law: revocation is a transition, history remains auditable. Enforcement belongs to the A007/routing consumers.
- **`DemonstratedPerformance`** — the calibration read surface the C002 routing engine consumes as its demonstrated-performance/freshness input (a port, not a write into routing). `inForce: false` after the validity window elapses (requalification bypass defense).

## Hard laws

- **Calibration is data, never authorization** (architecture-lock rules 9/35): `consumeCalibrationAsAuthorization` fails closed for ANY calibration output; authority-shaped field names are rejected at construction (`EXPERT_CALIBRATION_MASQUERADE_REJECTED`).
- **Tenant isolation** (lock rule 11): cross-tenant completion/read paths fail closed with `EXPERT_CALIBRATION_TENANT_MISMATCH`.
- **No hidden clocks** (lock rule 17): every evaluation/projection time is caller-injected.
- **Append-only** (lock rule 6): corrections/expiry append; history is never rewritten.

## Scripts

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
