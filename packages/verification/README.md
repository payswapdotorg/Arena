# @arena/verification

The Arena **verification protocol** — evidence-backed establishment of
results (Work Order A013; requirements R13, R14, R27, R28; spec EV1.0;
spec/quality-model.md "verifier strength / verifier agreement / false
positive-negative evidence / reproducibility"; architecture-lock rules
6, 7, 16, 17, 18; docs/architecture.md §5, §18).

Verification establishes **whether required evidence exists and
supports required claims** — and **never** emits a numerical or graded
quality assessment. Quality assessment against criteria is a separate
protocol's responsibility (architecture-lock rule 7); this package
carries evidence outcomes ONLY (`pass` | `fail` | `unknown`), enforced
by construction (derived outcomes, strict shapes) and by the hygiene
suite (separation negatives over sources, contracts, README and the
canonical object forms).

## Objects

| Object | What it commits to |
| --- | --- |
| `VerifierDescriptor` | The **content-addressed, versioned** declaration of a verifier: id, version, method (the **closed EV1.0 enum**: `unit_integration_test \| deterministic_formal_check \| constraint_check \| simulation \| measurement \| inspection \| expert_review \| evidence_provenance_validation` — unknown methods rejected), the **required-evidence declaration** (one clause per requirement: evidence kind, claim, optional artifact pin, optional producer pin; unique ids; non-empty), the declared **pass/fail/unknown semantics** (all three mandatory), the **reproducibility policy** (`deterministic \| seeded-stochastic \| provider-dependent`, with the seed and parameters recorded when applicable — deterministic ⇒ no seed, seeded-stochastic ⇒ seed REQUIRED), input/output schema refs and provenance. Any change ⇒ a different digest; same id+version with different bytes is a registry conflict. |
| `EvidenceReference` | One item of a run's evidence bundle: the evidence kind the artifact claims to carry (open, charset-validated vocabulary), a **real A002 `ArtifactRef`** (namespace/name/version + sha256 content digest — validated by `@arena/artifact-protocol`'s own validators) and the evidence provenance (producedBy / producedAt / notes — requirement R14). |
| `RequirementSupport` | One declared requirement's status within a run, from the **closed vocabulary** `present-supported \| present-unsupported \| present-unverified \| present-indeterminate \| missing` — no quantitative members. Missing requirements cannot name evidence; present statuses must name the digest of the evidence they examined. |
| `VerificationRecord` | The **append-once** record of one verification run: verifier descriptor digest, the evidence bundle, the evidence-support summary (one entry per declared requirement, set-equal to the declaration), the **derived** outcome (`pass` = all required evidence present and supports; `fail` = required evidence present but contradicts; `unknown` = insufficient evidence/trust or an inconclusive method), the **derived structured unknown cause** (`missing-evidence \| unverifiable-provenance \| method-limitation` + the driving requirement ids — required iff the outcome is unknown), correlation id + idempotency key (lock rule 17), the **computed input digest** over {verifier, evidence} and timestamps + run provenance. Frozen on creation; pure replayable construction; identical inputs ⇒ identical record digest. |

## Evidence validation primitives

The checks that distinguish "evidence exists" from "evidence exists and
supports the claim" (all individually testable; composed by
`assessEvidenceForRequirements`):

1. **Evidence-kind matching** — `matchEvidenceForRequirement` /
   `selectEvidenceForRequirement`: pure, deterministic selection of the
   bundle entries that could satisfy a declared requirement (kind
   equality + exact artifact-pin equality when pinned; first match in
   bundle order for unpinned requirements).
2. **Reference resolution** — an A002 `ArtifactResolver` resolves each
   evidence ref. A declared-but-unresolvable reference establishes
   nothing: it maps to `missing` (a dangling claim is not evidence).
3. **Digest verification** — the resolved artifact must satisfy BOTH
   `verifyArtifact` (recomputed canonical digest === claimed digest —
   A002 fail-closed tamper detection) AND ref-digest equality (the
   bundle's address names the artifact that was actually resolved).
   Any mismatch ⇒ `present-unverified`, **never a silent pass**.
4. **Provenance-chain validation** — A002 `verifyArtifactTree` over the
   resolved artifact: every embedded lineage ref must resolve, match
   identity+digest and verify recursively (diamond-safe,
   cycle-fail-closed). A broken chain ⇒ `present-unverified`.

## Outcome semantics

`deriveVerificationOutcome` is the pure **total** heart of the
protocol: every possible support summary maps to exactly one of the
three closed outcome members —

- any requirement `missing` ⇒ `unknown` / `missing-evidence`;
- else any `present-unverified` ⇒ `unknown` / `unverifiable-provenance`;
- else any `present-indeterminate` ⇒ `unknown` / `method-limitation`;
- else any `present-unsupported` ⇒ `fail`;
- else (all `present-supported`) ⇒ `pass`.

There is no API through which a caller could supply an outcome, and no
input for which the derivation could produce a quantitative value —
the lock-rule-7 regression proof (see `src/property.test.ts` P6 and
`src/outcome.test.ts`).

## Envelope wiring

Wire shapes travel inside `@arena/protocol-core`'s `Envelope<T>`:
`run-verification-command` / `verification-recorded-event`. Commands
carry a **required non-null idempotency key** (lock rule 17); the
recorded event carries the fabric's authoritative, content-addressed
record and the run command's idempotency key when provided.

## Dependencies

Runtime dependencies are `@arena/protocol-core` (canonical JSON +
sha256 digests, envelopes, branded identifiers, correlation ids /
idempotency keys, SchemaRef, ProtocolError) and
`@arena/artifact-protocol` (the A002 artifact protocol whose
`MaterialArtifact` / `ArtifactRef` / `verifyArtifact` /
`verifyArtifactTree` primitives ARE the evidence-addressing and
provenance-validation substrate — consumed, never reimplemented). The
criteria-assessment protocol (lock rule 7's other half) is deliberately
NOT imported. Zero external runtime dependencies (frozen catalog).

## Contracts

Generated contracts live in `contracts/verification/` (repo root):
`verifier-descriptor`, `verification-record`, `verification-outcome`,
`verification-error`, `verification-recorded-event`,
`run-verification-command`, `verification-schema-registry` (all
`.v1.json`). Regenerate with `pnpm contracts:generate`; drift is
checked by `pnpm contracts:check`, the drift suite (`src/drift.test.ts`)
and governance G9 (which auto-discovers package-level generators).
Parity with this TS surface is asserted by `src/contracts.parity.test.ts`.

## Reference fabric

The in-process reference fabric — verifier registry, verification
runner (resolve → validate → hook → derive → record) and the two
reference verifier implementations (`constraint_check` — content-based;
`evidence_provenance_validation` — producer/lineage-based) — lives in
`services/verification` (`@arena/verification-fabric`). The other six
EV1.0 methods are declared descriptor types with pluggable hook
interfaces and no implementations (A013 scope).

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative + property + parity + drift + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
pnpm contracts:generate   # regenerate contracts/verification/*
pnpm contracts:check      # drift check against the committed copies
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).
