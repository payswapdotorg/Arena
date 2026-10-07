# @arena/expert-performance

Arena expert performance — **Work Order C005 / issue #112** — the long-term
memory of expert quality: the append-only, dimension-separated, longitudinal
evidence profile routing, requalification and (later) competition/adjudication
consume. Spec anchors: `spec/quality-model.md` (Expert quality dimensions +
attribution laws), `docs/architecture-lock.md` A2.0 rules 6/18/35, and the
C005 row of `spec/human-escalation-work-items.md`.

## The no-single-global-score law (structural)

spec/quality-model.md: *"Do not collapse expert quality into a single global
score."* Enforced in code, not convention:

| Boundary | Enforcement |
|---|---|
| Record/profile/lens types | no score field exists; exact-field validation rejects any smuggled score-shaped key (`globalScore`, `overallScore`, …) |
| Aggregates | the ONLY aggregate is `DimensionalSummaryAggregate` — typed, versioned, **single-dimension**, disclosing formula (`dimensional-outcome-frequency`), formula version, per-outcome sample sizes and MANDATORY limitation disclosures |
| No-happy-path markers | `consumeProfileAsGlobalScore`, `buildGlobalExpertScore`, `applyDimensionWeights` always throw `EXPERT_PERFORMANCE_GLOBAL_SCORE_REJECTED` |
| Wire | no score-shaped schema exists in `EXPERT_PERFORMANCE_SCHEMAS`; cross-dimension aggregate queries are rejected at envelope construction |

## Surface map

| Module | Responsibility |
|---|---|
| `dimensions.ts` | The closed Expert-quality dimension vocabulary (8 record families), per-dimension closed outcome vocabularies + applicability-context requirements, and the closed (source-family → dimension) ingestion mapping |
| `record.ts` | `PerformanceEvidenceRecord` — append-only, content-addressed, provenance-addressable (dep source family + ref digest); the ATTRIBUTION LAW (an evaluator version change can never be recorded as an expert performance change); `mutateEvidenceRecord` has no happy path |
| `freshness.ts` | `FreshnessPolicy` — explicit versioned per-dimension staleness windows; `evaluateFreshness` surfaces fresh / stale / no-evidence WITH reasons; records are never silently decayed |
| `profile.ts` | `assemblePerformanceProfile` — the deterministic dimensional fold + the two read LENSES over the SAME canonical object: `toRoutingLens` (the C002 demonstrated-performance / historical-task-fit seam) and `toCapabilityHistoryLens` (expert-facing) |
| `aggregate.ts` | `DimensionalSummaryAggregate` + the no-global-score markers above |
| `ingestion.ts` | `mapSourceEvidence` — the PURE closed mapping from the merged dep surfaces (C004 calibration verdicts, A007 qualification + match history, A019 skill-extraction outcomes, A020 attribution records) into evidence records; outcomes are DERIVED from source data, never caller-chosen |
| `envelopes.ts` | Command (append-evidence — idempotency REQUIRED), the two lens queries + responses, the dimension-aggregate query + response, provenance reads, events, errors |

## Attribution discipline (LE1.0 via A020)

Every record carries `attribution: { kind: expert-change | evaluator-change |
measurement-variance, evaluatorVersion }`. When the evaluator version digest
changed relative to the prior one, `classifyAttribution` forces
`evaluator-change`, and `createEvidenceRecord` REJECTS an expert-change claim
under a changed evaluator version
(`EXPERT_PERFORMANCE_ATTRIBUTION_VIOLATION`) — *a changed evaluator score is
not automatically a capability improvement*.

## Dependencies

`@arena/protocol-core` (canonical JSON + sha256, `Envelope<T>`) and
`@arena/expert-qualification` (the `CapabilityNodeRefView` vocabulary —
consumed, never redefined). Zero service imports. The reference service
lives in `services/expert-performance`
(`@arena/expert-performance-service`).

## Verification

```
pnpm --filter @arena/expert-performance typecheck
pnpm --filter @arena/expert-performance lint
pnpm --filter @arena/expert-performance test
pnpm --filter @arena/expert-performance build
```
