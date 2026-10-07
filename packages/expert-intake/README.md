# @arena/expert-intake

Arena **AI expert intake / adaptive capability interview agent** — Work Order **C003** (issue #110). The front door of the expert network: a prospective human expert is profiled through an adaptive, versioned, seed-deterministic interview, and the output becomes structured claims + evidence pointers for the A006/A007 expert surfaces — **never an access grant**.

## What it provides

- **Typed interview items** (`items.ts`) — capability probe, experience probe, evidence request, scenario item (closed vocabulary), each with an expected answer schema. Catalogs seed deterministically from the C002 `DemandProfileView` (`catalogFromDemandProfile`) or an explicit seed.
- **Adaptive selection** (`selection.ts`) — next-item selection by **expected information value** with a fully inspectable per-component rationale (novelty, routing criticality, coverage gap, stage order, answer entropy, bounded seed jitter). Deterministic given identical seeds; stable tie-break (highest score, then item id). The capability-case active-learning law, machine-auditable.
- **Session lifecycle + transcript** (`session.ts`) — CREATED → IN_PROGRESS → SUBMITTED → ASSESSED with explicit ABANDONED / TIMED_OUT terminal states; an append-only, digest-chained transcript of questions + DECLARED answers (never hidden model reasoning); fail-closed answer validation against the expected schema; minimal-PII lexical screen on free text.
- **Typed outcomes** (`outcome.ts`) — complete-with-claims / incomplete-with-gap-list / rejected-with-reasons (closed reason vocabularies; never a bare boolean).
- **Output contract** (`profile.ts`) — the structured `IntakeProfile` proposal for the A006 registry field groups + qualification claim candidates with evidence pointers for A007 (`toRegistryProposal`, `toQualificationClaimInputs`). An evidence-free claim is structurally not a claim. A recursive field-name screen rejects authority-shaped / PII-shaped fields at any depth — intake output can never masquerade as an access grant (lock rules 9/35).
- **Model-adapter law** (`model-adapter.ts`) — the interviewer model sits behind `InterviewerModelPort`; `ScriptedInterviewerModel` is the deterministic reference implementation (lock rule 10).
- **Engine facade** (`engine.ts`) + **envelope wiring** (`envelopes.ts`) — commands with REQUIRED idempotency keys (start/submit/abandon/timeout/assess), events, and the pure transcript query, inside `@arena/protocol-core` `Envelope<T>`.

## Determinism contract

Given an identical (catalog seed, selection seed, injected timestamps, scripted adapter) tuple, two runs produce byte-identical transcripts and session digests — the interview is replayable evidence. No clock reads; all times are injected (lock rule 17).

## Dependencies (all merged on main)

- `@arena/protocol-core` — canonical JSON + sha256 digests, `Envelope<T>`, branded ids.
- `@arena/expert-qualification` (A007) — the shared proficiency / competency-node / evidence-kind / availability / jurisdiction vocabulary (consumed, never redefined).
- `@arena/escalation-routing` (C002) — the `DemandProfileView` type the catalog is seeded from.

The reference service (in-memory store + injected model/registry/qualification ports) lives in `services/expert-intake` (`@arena/expert-intake-service`).

## Scripts

```
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint .
pnpm run test        # vitest run
pnpm run build       # tsc -p tsconfig.build.json
```
