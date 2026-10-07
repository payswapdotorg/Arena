# @arena/expert-performance-service

Arena expert-performance **reference read/projection service** — Work Order
C005 / issue #112. In-process orchestration over `@arena/expert-performance`
(the A015-fabric house pattern for reference services: in-memory append-only
store, injected ports, fail-closed errors, envelope conventions).

## Ingestion (append-only, provenance-verified)

`appendEvidence` (COMMAND — idempotency key REQUIRED, lock rule 17) is the
ONLY write. The caller names the record, the tenant/expert, the dep source
family + the dep record's content digest, and the target dimension. The
service then:

1. resolves the source through the injected **public dep port** — a digest
   the owning C004/A007/A019/A020 surface does not confirm fails closed
   (`EXPERT_PERFORMANCE_PORT_FAILURE` — fabricated/tampered provenance never
   enters the profile);
2. derives the outcome/applicability/sample-size/evaluator-version/
   attribution through the pure closed domain mapping — the caller never
   chooses them;
3. threads the prior evaluator version: a changed evaluator version digest
   lands as `evaluator-change` (an evaluator version change can never be
   recorded as an expert performance change);
4. enforces the **evidence-replay defense** — the same source digest can
   never be booked twice into one dimension (`EXPERT_PERFORMANCE_DUPLICATE_EVIDENCE`);
5. appends ONE content-addressed record and emits `evidence-appended`.

## Read lenses (same canonical object, different lens)

| Operation | Lens |
|---|---|
| `getRoutingInput` | the C002 demonstrated-performance / historical-task-fit seam — all eight dimension summaries with read-time freshness |
| `getCapabilityHistory` | the expert-facing capability history — the chronological timeline with attribution |
| `getDimensionAggregate` | the typed, versioned SINGLE-dimension summary (cross-dimension aggregate queries have no code path) |
| `getEvidenceRecord` | the provenance-addressable record read (cross-tenant fails closed) |

Integrity: every store read re-verifies the content digest (tampered entries
fail closed with `EXPERT_PERFORMANCE_TAMPERED`). Tenant isolation: lens folds
are strictly per-tenant; cross-tenant record reads fail closed with
`EXPERT_PERFORMANCE_TENANT_MISMATCH`. Determinism: all times injected.

## Ports (the dep seams)

`CalibrationVerdictSourcePort` (C004) · `QualificationHistorySourcePort`
(A007 qualification records + match history) · `SkillExtractionSourcePort`
(A019) · `LearningAttributionSourcePort` (A020). Fakes in `test-support.ts`.

## Verification

```
pnpm --filter @arena/expert-performance-service typecheck
pnpm --filter @arena/expert-performance-service lint
pnpm --filter @arena/expert-performance-service test
pnpm --filter @arena/expert-performance-service build
```
