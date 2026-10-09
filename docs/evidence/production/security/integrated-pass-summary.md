# P007 integrated adversarial pass — evidence summary

- **Work order:** P007 integrated pass (issue #159; threat model `docs/security/post-roadmap/threat-model.md`)
- **Evidence class:** AUTOMATED-TEST-ONLY (embedded real Postgres — PGlite 17 WASM — through the REAL composition + REAL public transport listener; per release-gate §3 this class alone supports no live-provider claim)
- **Deployed source SHA:** recorded at run time by each battery (see transcripts below — fresh runs only; no historical evidence rewritten)
- **Batteries:** `node tests/security/production/run.mjs` (13 files / 66 tests) + `node tests/resilience/production/run.mjs` (1 file / 6 tests)

## Attack-class coverage (the threat model's 14 classes)

| Class | Suite | Result |
|---|---|---|
| AC-01 tenant isolation | ac01-tenant-isolation.test.ts | PASS — cross-tenant read/write/advance/listing fail closed typed at service boundaries (no existence oracle) |
| AC-02 capsule secrets/expiry | ac02-ac03 (combined) | PASS |
| AC-03 unauthorized tool/action use | ac02-ac03 (combined) | PASS |
| AC-04 webhook forgery/replay | ac04-webhook-forgery.test.ts | PASS |
| AC-05 API-key misuse | ac05-api-key-misuse.test.ts | PASS |
| AC-06 object-store cross-tenant | ac06-object-store.test.ts | PASS |
| AC-07 idempotency races | ac07-idempotency-races.test.ts | PASS — exactly-once invariant holds; loser distribution characterized (F-08) |
| AC-08 worker restart/partial-state | ac08-restart-partial-state.test.ts | PASS |
| AC-09 partial payment state + BLOCKED-COMMERCIAL | ac09-partial-payment-state.test.ts | PASS — commercial posture pinned; sequential replay correct; **F-09 reproduced** (concurrent same-key settlement double-applies on the in-process ledger fabric) |
| AC-10 learning rights/scope | ac10-learning-boundary.test.ts | PASS |
| AC-11 digest mismatch | ac11-digest-integrity.test.ts | PASS |
| AC-12 policy drift | ac12-policy-drift.test.ts | PASS |
| AC-13 live-world writeback | ac13-live-world-writeback.test.ts | PASS — `asLiveMutation` typed REPLAY_AS_LIVE for every kind; forged traces structurally rejected |
| AC-14 fail-closed bypass | ac14-fail-closed.test.ts | PASS |

Resilience: provider-outage-recovery.test.ts — outage windows, capacity-state transitions, retry/dead-letter posture, deterministic coordination sub-surfaces (lease/idempotency/rate-limit), zero-credential DISABLED before any network call.

## Findings filed by this pass (additive to the findings register — nothing closed)

- **F-08** (medium, OPEN): idempotency-race losers get the typed fail-closed conflict instead of the smooth C001 replay; exactly-once holds; remediation is a P002/P003-surface catch-and-replay conversion (TL-serialized).
- **F-09** (high, OPEN): the payments in-process ledger/outbox fabric double-applies concurrent same-key settlement operations (charge-succeeded/record-failed race — reproduced 6/6 applied); sequential replay correct; remediation is the durable payment ledger swap (P002/C010 surfaces, TL-serialized).

Both regressions are pinned in the suites themselves (ac07's loser-distribution characterization; ac09's F-09 reproduction block) and MUST flip when the remediations land.

## Honest limitations

1. All proofs are AUTOMATED-TEST-ONLY (embedded Postgres); no live-provider adversarial run was executed in this pass (the live-Neon evidence path is P002's; provider evidence classes are P004's).
2. F-04d (true cross-account object access) remains unexercised (single-account credentials — a release-owner decision recorded in the register).
3. The suites attack the FROZEN wave-1/wave-2 surfaces as merged at base `2ed2aa9`; any drift introduced after this pass is a re-run away.
