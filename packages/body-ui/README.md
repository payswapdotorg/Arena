# @arena/body-ui

The reusable view model for Arena body surfaces (Work Order **B010**, issue #82).

Pure, deterministic, frozen-data-driven projections of canonical reads into
the shapes the Body Studio renders. This package adds **no runtime authority**
and invents **no second domain model**: it projects `agent-body` /
`certification` reads through the `@arena/read-model` contract types,
honestly — unknown stays unknown, never guessed.

## Product truths carried structurally (architecture-lock A2.0 rules 1–5)

- **Body ≠ model; Substrate ≠ Body.** The identity card never carries a
  substrate; the possession row carries the substrate strictly as a
  component of the binding.
- **Possession = a versioned composition binding** (Body Version ×
  Cognitive Substrate × Runtime × Environment × Policy) — never “the body
  runs model X”.
- **Certification claims apply to the tested composition**, never the bare
  model; claims match bodies exactly by bodyId@version.
- **Body Versions are immutable and content-addressed** — the identity card
  carries the immutability note as data; improvement creates a NEW version.
- **Substrate comparisons are composition-scoped or typed-rejected.** A
  bare substrate/model ranking request is the typed rejection
  `BODY_UI_BARE_SUBSTRATE_COMPARISON`; the successful output is a
  per-composition table, never a ranking, never a winner.

## Modules

| Module | Exports |
|---|---|
| `identity-card.ts` | `buildBodyVersionIdentityCard`, `bodyIdentityLabel` |
| `composition.ts` | `buildCompositionListing` (skills/knowledge/tools/procedures counts + named tools) |
| `possession-matrix.ts` | `buildPossessionMatrix`, `possessionRowLabel`, `parseGrantedTo` |
| `certification.ts` | `buildCertificationClaimCard`, `certificationAppliesToBody`, `certificationScopeLabel` |
| `comparison.ts` | `buildSubstrateComparison`, `possessionRowsToComparisonArms`, `COMPARISON_SCOPE_CONTRACT` |
| `studio.ts` | `buildBodyStudioCard` (identity + composition + possession matrix) |
| `shared.ts` / `errors.ts` | honest payload readers, product-truth notes, `BodyUiError` (`BODY_UI_KIND_MISMATCH`, `BODY_UI_INVALID_INPUT`) |

## Contract

- Deterministic and pure: no randomness, no wall-clock, no environment
  access, no framework imports; outputs are deep-frozen.
- Typed rejections: a canonical read of the wrong kind is never coerced
  into a view (`BODY_UI_KIND_MISMATCH`).
- Zero new external dependencies (workspace contract types only).
